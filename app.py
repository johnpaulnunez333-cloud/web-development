import os
import re
import json
import base64
import random
import time
from datetime import datetime, timedelta, timezone
from functools import wraps

import requests
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, abort, Response
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, emit
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import generate_password_hash, check_password_hash

from avatars import AVATAR_KEYS, AVATAR_LABELS, render_avatar
from quiz_data import QUESTIONS, QUIZ_PLAN


def database_url():
    url = os.environ.get('DATABASE_URL', '').strip()
    if not url:
        return 'sqlite:///mdw.db'
    if url.startswith('postgres://'):
        url = 'postgresql://' + url[len('postgres://'):]
    return url


app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.secret_key = os.environ.get('SECRET_KEY') or os.urandom(32).hex()

app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = bool(os.environ.get('RENDER')) or os.environ.get('FLASK_ENV') == 'production'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=12)
app.config['SQLALCHEMY_DATABASE_URI'] = database_url()
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {'pool_pre_ping': True, 'pool_recycle': 280}
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 512 * 1024

db = SQLAlchemy(app)
socketio = SocketIO(app, async_mode='threading', ping_interval=20, ping_timeout=60)


def user_rate_key():
    return str(session.get('user_id') or get_remote_address())


limiter = Limiter(get_remote_address, app=app, default_limits=[], storage_uri='memory://')

ADMIN_PATH = '/' + os.environ.get('ADMIN_PATH', 'mdw-hq-7x2k').strip('/')
MAX_HISTORY = 100
LOCKOUT_THRESHOLD = 5
LOCKOUT_DURATION_SECONDS = 300
EMAIL_REGEX = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
DATA_URL_REGEX = re.compile(r'^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$')
MAX_AVATAR_BYTES = 150 * 1024
CATEGORIES = list(QUIZ_PLAN.keys())

failed_login_attempts = {}
online = {}
site_visitors = {}
last_sent = {}


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(value):
    return value.isoformat() + 'Z' if value else None


class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(80), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    avatar = db.Column(db.Text, nullable=True)
    avatar_version = db.Column(db.Integer, default=0, nullable=False)
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class Message(db.Model):
    __tablename__ = 'messages'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    text = db.Column(db.String(500), nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False, index=True)
    user = db.relationship('User')


class Question(db.Model):
    __tablename__ = 'questions'
    id = db.Column(db.Integer, primary_key=True)
    category = db.Column(db.String(40), nullable=False, index=True)
    question = db.Column(db.Text, nullable=False)
    options = db.Column(db.Text, nullable=False)
    answer = db.Column(db.Integer, nullable=False)
    active = db.Column(db.Boolean, default=True, nullable=False)


class QuizAttempt(db.Model):
    __tablename__ = 'quiz_attempts'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    score = db.Column(db.Integer, nullable=False)
    total = db.Column(db.Integer, nullable=False)
    percent = db.Column(db.Integer, nullable=False)
    level = db.Column(db.String(20), nullable=False)
    breakdown = db.Column(db.Text, nullable=False, default='{}')
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    user = db.relationship('User')


def seed_questions():
    if Question.query.count() > 0:
        return
    for category, text, options, answer in QUESTIONS:
        db.session.add(Question(category=category, question=text, options=json.dumps(options), answer=answer))
    db.session.commit()


def ensure_admin():
    email = os.environ.get('ADMIN_EMAIL', '').strip().lower()
    password = os.environ.get('ADMIN_PASSWORD', '')
    if not email or not password:
        return
    user = User.query.filter_by(email=email).first()
    if user:
        if not user.is_admin:
            user.is_admin = True
            db.session.commit()
        return
    db.session.add(User(
        full_name='MDW Admin',
        email=email,
        password_hash=generate_password_hash(password),
        is_admin=True
    ))
    db.session.commit()


def current_user():
    raw = session.get('user_id')
    if raw is None:
        return None
    try:
        user_id = int(raw)
    except (TypeError, ValueError):
        return None
    return db.session.get(User, user_id)


def login_user(user):
    session.clear()
    session.permanent = True
    session['user_id'] = user.id


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user():
            return redirect(url_for('login'))
        return fn(*args, **kwargs)
    return wrapper


def api_login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user():
            return jsonify({'success': False, 'message': 'Please log in first.'}), 401
        return fn(*args, **kwargs)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user or not user.is_admin:
            abort(404)
        return fn(*args, **kwargs)
    return wrapper


def avatar_url(user):
    return f'/avatar/{user.id}?v={user.avatar_version}'


def is_strong_password(password):
    return len(password) >= 8 and re.search(r'[A-Za-z]', password) and re.search(r'[0-9]', password)


def lockout_key(email):
    return f'{get_remote_address()}|{email}'


def is_account_locked(email):
    key = lockout_key(email)
    record = failed_login_attempts.get(key)
    if not record:
        return False
    attempts, locked_until = record
    if locked_until and datetime.utcnow() < locked_until:
        return True
    if locked_until:
        failed_login_attempts.pop(key, None)
    return False


def register_failed_attempt(email):
    key = lockout_key(email)
    attempts, locked_until = failed_login_attempts.get(key, (0, None))
    attempts += 1
    if attempts >= LOCKOUT_THRESHOLD:
        locked_until = datetime.utcnow() + timedelta(seconds=LOCKOUT_DURATION_SECONDS)
    failed_login_attempts[key] = (attempts, locked_until)


def level_for(percent):
    if percent >= 90:
        return 'Expert'
    if percent >= 70:
        return 'Advanced'
    if percent >= 40:
        return 'Intermediate'
    return 'Beginner'


def attempt_dict(attempt):
    return {
        'id': attempt.id,
        'score': attempt.score,
        'total': attempt.total,
        'percent': attempt.percent,
        'level': attempt.level,
        'breakdown': json.loads(attempt.breakdown or '{}'),
        'created_at': iso(attempt.created_at)
    }


def message_dict(message):
    return {
        'id': message.id,
        'user_id': message.user_id,
        'sender': message.user.full_name,
        'avatar': avatar_url(message.user),
        'text': message.text,
        'timestamp': iso(message.created_at)
    }


def online_payload():
    ids = []
    for user_id in online.values():
        if user_id not in ids:
            ids.append(user_id)
    if not ids:
        return []
    users = User.query.filter(User.id.in_(ids)).all()
    by_id = {u.id: u for u in users}
    return [
        {'id': uid, 'name': by_id[uid].full_name, 'avatar': avatar_url(by_id[uid])}
        for uid in ids if uid in by_id
    ]


@app.after_request
def set_secure_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response


AI_PROVIDERS = {
    'openrouter': {
        'base_url': 'https://openrouter.ai/api/v1',
        'model': 'qwen/qwen3-coder:free',
    },
    'openai': {
        'base_url': 'https://api.openai.com/v1',
        'model': 'gpt-4-turbo-preview',
    }
}

AI_PROVIDER = os.environ.get('AI_PROVIDER', 'openrouter')
AI_API_KEY = os.environ.get('AI_API_KEY', '')

AI_SYSTEM_PROMPT = (
    "You are the MDW IT Assistant, a helpful support assistant for Manantan Digital Works. "
    "You only answer questions about networking (Cisco, IP addressing, topologies, switches, routers), "
    "programming and web development (Python, Flask, JavaScript, HTML, CSS, databases, general "
    "software engineering), general IT support, and defensive cybersecurity concepts (how attacks work "
    "at a conceptual level, how to protect systems, secure coding, password and account hygiene). "
    "If a user asks about anything outside of those topics, politely decline and explain what you can help with. "
    "Never provide working instructions for hacking, malware, exploits, or any illegal or harmful activity, "
    "even if the user claims it is for educational or authorized purposes. "
    "Keep answers clear, concise, and beginner-friendly when possible. "
    "Use markdown: short paragraphs, bullet lists, and fenced code blocks with a language name for code."
)


@app.route('/')
def index():
    if not current_user():
        return redirect(url_for('login'))
    return render_template('index.html')

@app.route('/signup')
def signup():
    return render_template('signup.html')


@app.route('/choose-avatar')
@login_required
def choose_avatar():
    user = current_user()
    next_url = url_for('quiz') if request.args.get('from') == 'signup' else url_for('dashboard')
    avatars = [{'key': key, 'label': AVATAR_LABELS[key]} for key in AVATAR_KEYS]
    current_key = user.avatar if user.avatar in AVATAR_KEYS else ''
    return render_template('choose-avatar.html', user=user, avatars=avatars, current_key=current_key,
                           avatar=avatar_url(user), next_url=next_url)


@app.route('/quiz')
@login_required
def quiz():
    return render_template('quiz.html', user=current_user())


@app.route('/dashboard')
@login_required
def dashboard():
    return render_template('dashboard.html', user=current_user())


@app.route('/portfolio')
def portfolio():
    return render_template('portfolio.html')


@app.route('/packet-tracer')
def packet_tracer():
    return render_template('packet-tracer.html')


@app.route('/networking')
def networking_home():
    return render_template('networking-home.html')


@app.route('/networking/about')
def networking_about():
    return render_template('networking-about.html')


@app.route('/networking/topology')
def networking_topology():
    return render_template('networking-topology.html')


@app.route('/networking/devices')
def networking_devices():
    return render_template('networking-devices.html')


@app.route('/networking/ip-addressing')
def networking_ip_addressing():
    return render_template('networking-ip-addressing.html')


@app.route('/networking/switch-config')
def networking_switch_config():
    return render_template('networking-switch-config.html')


@app.route('/networking/simulation')
def networking_simulation():
    return render_template('networking-simulation.html')


@app.route('/networking/gallery')
def networking_gallery():
    return render_template('networking-gallery.html')


@app.route('/networking/download')
def networking_download():
    return render_template('networking-download.html')


@app.route('/networking/contact')
def networking_contact():
    return render_template('networking-contact.html')


@app.route('/chat')
@login_required
def chat():
    return render_template('chat.html', user=current_user())


@app.route('/assistant')
@login_required
def ai_assistant():
    return render_template('ai-assistant.html', user=current_user())


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))


@app.route('/avatars/<key>.svg')
def avatar_preset(key):
    if key not in AVATAR_KEYS:
        abort(404)
    response = Response(render_avatar(key), mimetype='image/svg+xml')
    response.headers['Cache-Control'] = 'public, max-age=604800'
    return response


@app.route('/avatar/<int:user_id>')
def avatar_image(user_id):
    user = db.session.get(User, user_id)
    value = user.avatar if user else None
    if user and not value:
        value = AVATAR_KEYS[user.id % len(AVATAR_KEYS)]
    if not value:
        value = AVATAR_KEYS[0]
    if value in AVATAR_KEYS:
        response = Response(render_avatar(value), mimetype='image/svg+xml')
    else:
        match = DATA_URL_REGEX.match(value)
        if not match:
            response = Response(render_avatar(AVATAR_KEYS[0]), mimetype='image/svg+xml')
        else:
            response = Response(base64.b64decode(match.group(2)), mimetype='image/' + match.group(1))
    response.headers['Cache-Control'] = 'public, max-age=86400'
    response.headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'"
    return response


@app.route('/api/register', methods=['POST'])
@limiter.limit('10 per hour')
def api_register():
    data = request.get_json(silent=True) or {}
    full_name = ' '.join((data.get('full_name') or '').split())
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    if not full_name or not email or not password:
        return jsonify({'success': False, 'message': 'All fields are required.'}), 400
    if len(full_name) < 2 or len(full_name) > 80:
        return jsonify({'success': False, 'message': 'Name must be between 2 and 80 characters.'}), 400
    if len(email) > 120 or not EMAIL_REGEX.match(email):
        return jsonify({'success': False, 'message': 'Please enter a valid email address.'}), 400
    if not is_strong_password(password):
        return jsonify({
            'success': False,
            'message': 'Password must be at least 8 characters and include a letter and a number.'
        }), 400
    if User.query.filter_by(email=email).first():
        return jsonify({'success': False, 'message': 'An account with this email already exists.'}), 409

    user = User(full_name=full_name, email=email, password_hash=generate_password_hash(password))
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'success': False, 'message': 'An account with this email already exists.'}), 409

    login_user(user)
    return jsonify({'success': True, 'message': 'Account created.', 'next': url_for('choose_avatar', **{'from': 'signup'})})


@app.route('/api/login', methods=['POST'])
@limiter.limit('8 per minute')
def api_login():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    if is_account_locked(email):
        return jsonify({
            'success': False,
            'message': 'Too many failed attempts. Please try again in a few minutes.'
        }), 429

    user = User.query.filter_by(email=email).first()
    if not user or not check_password_hash(user.password_hash, password):
        register_failed_attempt(email)
        return jsonify({'success': False, 'message': 'Invalid email or password.'}), 401

    failed_login_attempts.pop(lockout_key(email), None)
    login_user(user)
    return jsonify({'success': True, 'message': 'Logged in.', 'next': url_for('dashboard')})


@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'success': True})


@app.route('/api/session')
def api_session():
    user = current_user()
    if user:
        return jsonify({
            'authenticated': True,
            'full_name': user.full_name,
            'email': user.email,
            'avatar': avatar_url(user)
        })
    return jsonify({'authenticated': False})


@app.route('/api/profile/avatar', methods=['POST'])
@api_login_required
def api_set_avatar():
    user = current_user()
    data = request.get_json(silent=True) or {}
    value = data.get('avatar') or ''

    if value in AVATAR_KEYS:
        user.avatar = value
    else:
        match = DATA_URL_REGEX.match(value)
        if not match:
            return jsonify({'success': False, 'message': 'Choose an avatar or upload a PNG, JPEG, or WebP image.'}), 400
        try:
            raw = base64.b64decode(match.group(2), validate=True)
        except ValueError:
            return jsonify({'success': False, 'message': 'The image could not be read.'}), 400
        if len(raw) > MAX_AVATAR_BYTES:
            return jsonify({'success': False, 'message': 'The image is too large.'}), 400
        kind = match.group(1)
        valid = (
            (kind == 'png' and raw.startswith(b'\x89PNG\r\n\x1a\n')) or
            (kind == 'jpeg' and raw.startswith(b'\xff\xd8\xff')) or
            (kind == 'webp' and raw[:4] == b'RIFF' and raw[8:12] == b'WEBP')
        )
        if not valid:
            return jsonify({'success': False, 'message': 'The image format is not valid.'}), 400
        user.avatar = value

    user.avatar_version = (user.avatar_version or 0) + 1
    db.session.commit()
    return jsonify({'success': True, 'avatar': avatar_url(user)})


@app.route('/api/quiz/start', methods=['POST'])
@api_login_required
def api_quiz_start():
    picked = []
    for category, count in QUIZ_PLAN.items():
        pool = Question.query.filter_by(category=category, active=True).all()
        picked.extend(random.sample(pool, min(count, len(pool))))
    if not picked:
        return jsonify({'success': False, 'message': 'The quiz is not available yet.'}), 503
    random.shuffle(picked)
    session['quiz'] = {'ids': [q.id for q in picked], 'started': int(time.time())}
    return jsonify({
        'success': True,
        'questions': [
            {'id': q.id, 'category': q.category, 'question': q.question, 'options': json.loads(q.options)}
            for q in picked
        ]
    })


@app.route('/api/quiz/submit', methods=['POST'])
@api_login_required
def api_quiz_submit():
    user = current_user()
    state = session.get('quiz') or {}
    ids = state.get('ids') or []
    if not ids:
        return jsonify({'success': False, 'message': 'Start the quiz before submitting.'}), 400

    data = request.get_json(silent=True) or {}
    answers = data.get('answers') or {}
    if not isinstance(answers, dict):
        return jsonify({'success': False, 'message': 'Invalid answers.'}), 400

    questions = Question.query.filter(Question.id.in_(ids)).all()
    if not questions:
        return jsonify({'success': False, 'message': 'The quiz is no longer available.'}), 400

    score = 0
    breakdown = {}
    review = []
    for q in questions:
        options = json.loads(q.options)
        chosen = answers.get(str(q.id))
        chosen = chosen if isinstance(chosen, int) and 0 <= chosen < len(options) else None
        correct = chosen == q.answer
        entry = breakdown.setdefault(q.category, {'correct': 0, 'total': 0})
        entry['total'] += 1
        if correct:
            entry['correct'] += 1
            score += 1
        else:
            review.append({
                'question': q.question,
                'your_answer': options[chosen] if chosen is not None else None,
                'correct_answer': options[q.answer]
            })

    total = len(questions)
    percent = round(score / total * 100)
    attempt = QuizAttempt(
        user_id=user.id,
        score=score,
        total=total,
        percent=percent,
        level=level_for(percent),
        breakdown=json.dumps(breakdown)
    )
    db.session.add(attempt)
    db.session.commit()
    session.pop('quiz', None)
    return jsonify({'success': True, 'result': attempt_dict(attempt), 'review': review})


@app.route('/api/dashboard')
@api_login_required
def api_dashboard():
    user = current_user()
    attempts = (QuizAttempt.query.filter_by(user_id=user.id)
                .order_by(QuizAttempt.created_at.desc()).limit(10).all())
    count = QuizAttempt.query.filter_by(user_id=user.id).count()
    best = (QuizAttempt.query.filter_by(user_id=user.id)
            .order_by(QuizAttempt.percent.desc(), QuizAttempt.created_at.desc()).first())
    return jsonify({
        'success': True,
        'user': {
            'name': user.full_name,
            'email': user.email,
            'avatar': avatar_url(user),
            'joined': iso(user.created_at)
        },
        'latest': attempt_dict(attempts[0]) if attempts else None,
        'best': attempt_dict(best) if best else None,
        'history': [attempt_dict(a) for a in attempts],
        'attempt_count': count,
        'stats': {
            'members': User.query.count(),
            'online': len(set(online.values())),
            'messages': Message.query.count()
        }
    })


@app.route('/api/assistant', methods=['POST'])
@api_login_required
@limiter.limit('20 per minute', key_func=user_rate_key)
def api_assistant():
    if not AI_API_KEY:
        return jsonify({'success': False, 'message': 'AI assistant is not configured yet.'}), 503

    data = request.get_json(silent=True) or {}
    message = (data.get('message') or '').strip()
    if not message:
        return jsonify({'success': False, 'message': 'Message cannot be empty.'}), 400

    history = []
    raw_history = data.get('history')
    if isinstance(raw_history, list):
        for item in raw_history[-10:]:
            if not isinstance(item, dict):
                continue
            role = item.get('role')
            content = item.get('content')
            if role in ('user', 'assistant') and isinstance(content, str) and content.strip():
                history.append({'role': role, 'content': content[:1500]})

    provider = AI_PROVIDERS.get(AI_PROVIDER, AI_PROVIDERS['openrouter'])
    messages = [{'role': 'system', 'content': AI_SYSTEM_PROMPT}] + history + [{'role': 'user', 'content': message[:1000]}]

    try:
        response = requests.post(
            f"{provider['base_url']}/chat/completions",
            headers={'Authorization': f'Bearer {AI_API_KEY}', 'Content-Type': 'application/json'},
            json={'model': provider['model'], 'messages': messages, 'max_tokens': 900, 'temperature': 0.5},
            timeout=45
        )
        response.raise_for_status()
        reply = response.json()['choices'][0]['message']['content']
        return jsonify({'success': True, 'reply': reply})
    except (requests.exceptions.RequestException, KeyError, IndexError, ValueError) as error:
        body = ''
        if getattr(error, 'response', None) is not None:
            body = error.response.text[:500]
        print(f'[AI Assistant Error] {error} | {body}')
        return jsonify({'success': False, 'message': 'The assistant is temporarily unavailable. Please try again.'}), 502


@socketio.on('connect')
def handle_connect():
    user = current_user()
    if not user:
        return False

    first_connection = user.id not in online.values()
    online[request.sid] = user.id

    recent = (Message.query.options(joinedload(Message.user))
              .order_by(Message.id.desc()).limit(MAX_HISTORY).all())
    recent.reverse()
    emit('chat_history', [message_dict(m) for m in recent])
    emit('online_users', online_payload(), broadcast=True)
    if first_connection:
        emit('user_joined', {'name': user.full_name}, broadcast=True, include_self=False)


@socketio.on('disconnect')
def handle_disconnect():
    user_id = online.pop(request.sid, None)
    if user_id is None:
        return
    emit('online_users', online_payload(), broadcast=True)
    if user_id not in online.values():
        user = db.session.get(User, user_id)
        if user:
            emit('user_left', {'name': user.full_name}, broadcast=True)


@socketio.on('chat_message')
def handle_chat_message(data):
    user = current_user()
    if not user or not isinstance(data, dict):
        return

    text = (data.get('text') or '').strip() if isinstance(data.get('text'), str) else ''
    if not text:
        return

    now = time.time()
    if now - last_sent.get(user.id, 0) < 0.5:
        emit('chat_error', {'message': 'You are sending messages too fast.'})
        return
    last_sent[user.id] = now

    message = Message(user_id=user.id, text=text[:500])
    db.session.add(message)
    db.session.commit()
    emit('chat_message', message_dict(message), broadcast=True)


@socketio.on('typing')
def handle_typing():
    user = current_user()
    if user:
        emit('typing', {'id': user.id, 'name': user.full_name}, broadcast=True, include_self=False)


@socketio.on('connect', namespace='/site')
def handle_site_connect():
    site_visitors[request.sid] = True
    emit('visitor_count', len(site_visitors), broadcast=True, namespace='/site')


@socketio.on('disconnect', namespace='/site')
def handle_site_disconnect():
    site_visitors.pop(request.sid, None)
    emit('visitor_count', len(site_visitors), broadcast=True, namespace='/site')


@app.route(ADMIN_PATH)
@admin_required
def admin_panel():
    return render_template('admin.html', base=ADMIN_PATH, user=current_user())


def latest_attempts_by_user():
    latest = {}
    counts = {}
    for attempt in QuizAttempt.query.order_by(QuizAttempt.created_at.asc()).all():
        latest[attempt.user_id] = attempt
        counts[attempt.user_id] = counts.get(attempt.user_id, 0) + 1
    return latest, counts


@app.route(ADMIN_PATH + '/api/stats')
@admin_required
def admin_stats():
    latest, _ = latest_attempts_by_user()
    levels = {'Beginner': 0, 'Intermediate': 0, 'Advanced': 0, 'Expert': 0}
    for attempt in latest.values():
        levels[attempt.level] = levels.get(attempt.level, 0) + 1
    average = db.session.query(func.avg(QuizAttempt.percent)).scalar() or 0
    recent = User.query.order_by(User.created_at.desc()).limit(6).all()
    return jsonify({
        'members': User.query.count(),
        'online': len(set(online.values())),
        'messages': Message.query.count(),
        'attempts': QuizAttempt.query.count(),
        'quizzed_members': len(latest),
        'average_percent': round(float(average)),
        'levels': levels,
        'questions': Question.query.filter_by(active=True).count(),
        'recent_members': [
            {'id': u.id, 'name': u.full_name, 'email': u.email, 'avatar': avatar_url(u), 'joined': iso(u.created_at)}
            for u in recent
        ]
    })


@app.route(ADMIN_PATH + '/api/users')
@admin_required
def admin_users():
    latest, counts = latest_attempts_by_user()
    online_ids = set(online.values())
    rows = []
    for u in User.query.order_by(User.created_at.desc()).all():
        attempt = latest.get(u.id)
        rows.append({
            'id': u.id,
            'name': u.full_name,
            'email': u.email,
            'avatar': avatar_url(u),
            'is_admin': u.is_admin,
            'online': u.id in online_ids,
            'joined': iso(u.created_at),
            'attempts': counts.get(u.id, 0),
            'level': attempt.level if attempt else None,
            'percent': attempt.percent if attempt else None
        })
    return jsonify({'users': rows})


@app.route(ADMIN_PATH + '/api/users/<int:user_id>/admin', methods=['POST'])
@admin_required
def admin_toggle_admin(user_id):
    me = current_user()
    target = db.session.get(User, user_id)
    if not target:
        return jsonify({'success': False, 'message': 'Member not found.'}), 404
    if target.id == me.id:
        return jsonify({'success': False, 'message': 'You cannot change your own role.'}), 400
    data = request.get_json(silent=True) or {}
    target.is_admin = bool(data.get('is_admin'))
    db.session.commit()
    return jsonify({'success': True})


@app.route(ADMIN_PATH + '/api/users/<int:user_id>', methods=['DELETE'])
@admin_required
def admin_delete_user(user_id):
    me = current_user()
    target = db.session.get(User, user_id)
    if not target:
        return jsonify({'success': False, 'message': 'Member not found.'}), 404
    if target.id == me.id:
        return jsonify({'success': False, 'message': 'You cannot delete your own account.'}), 400
    removed = [m.id for m in Message.query.filter_by(user_id=target.id).all()]
    Message.query.filter_by(user_id=target.id).delete()
    QuizAttempt.query.filter_by(user_id=target.id).delete()
    db.session.delete(target)
    db.session.commit()
    for message_id in removed:
        socketio.emit('message_deleted', {'id': message_id})
    return jsonify({'success': True})


@app.route(ADMIN_PATH + '/api/attempts')
@admin_required
def admin_attempts():
    attempts = (QuizAttempt.query.options(joinedload(QuizAttempt.user))
                .order_by(QuizAttempt.created_at.desc()).limit(200).all())
    rows = []
    for a in attempts:
        row = attempt_dict(a)
        row['name'] = a.user.full_name
        row['email'] = a.user.email
        row['avatar'] = avatar_url(a.user)
        rows.append(row)
    return jsonify({'attempts': rows})


def question_dict(q):
    return {
        'id': q.id,
        'category': q.category,
        'question': q.question,
        'options': json.loads(q.options),
        'answer': q.answer,
        'active': q.active
    }


@app.route(ADMIN_PATH + '/api/questions')
@admin_required
def admin_questions():
    rows = Question.query.order_by(Question.category.asc(), Question.id.asc()).all()
    return jsonify({'questions': [question_dict(q) for q in rows], 'categories': CATEGORIES})


@app.route(ADMIN_PATH + '/api/questions', methods=['POST'])
@admin_required
def admin_add_question():
    data = request.get_json(silent=True) or {}
    category = data.get('category')
    text = (data.get('question') or '').strip()
    options = data.get('options')
    answer = data.get('answer')

    if category not in CATEGORIES:
        return jsonify({'success': False, 'message': 'Choose a valid category.'}), 400
    if len(text) < 5 or len(text) > 300:
        return jsonify({'success': False, 'message': 'The question must be 5 to 300 characters.'}), 400
    if not isinstance(options, list) or len(options) != 4:
        return jsonify({'success': False, 'message': 'Provide exactly 4 options.'}), 400
    options = [str(o).strip() for o in options]
    if any(not o or len(o) > 120 for o in options) or len(set(options)) != 4:
        return jsonify({'success': False, 'message': 'Options must be unique, non-empty, and under 120 characters.'}), 400
    if not isinstance(answer, int) or not 0 <= answer < 4:
        return jsonify({'success': False, 'message': 'Choose the correct answer.'}), 400

    q = Question(category=category, question=text, options=json.dumps(options), answer=answer)
    db.session.add(q)
    db.session.commit()
    return jsonify({'success': True, 'question': question_dict(q)})


@app.route(ADMIN_PATH + '/api/questions/<int:question_id>/toggle', methods=['POST'])
@admin_required
def admin_toggle_question(question_id):
    q = db.session.get(Question, question_id)
    if not q:
        return jsonify({'success': False, 'message': 'Question not found.'}), 404
    q.active = not q.active
    db.session.commit()
    return jsonify({'success': True, 'active': q.active})


@app.route(ADMIN_PATH + '/api/questions/<int:question_id>', methods=['DELETE'])
@admin_required
def admin_delete_question(question_id):
    q = db.session.get(Question, question_id)
    if not q:
        return jsonify({'success': False, 'message': 'Question not found.'}), 404
    db.session.delete(q)
    db.session.commit()
    return jsonify({'success': True})


@app.route(ADMIN_PATH + '/api/messages')
@admin_required
def admin_messages():
    rows = (Message.query.options(joinedload(Message.user))
            .order_by(Message.id.desc()).limit(200).all())
    return jsonify({'messages': [message_dict(m) for m in rows]})


@app.route(ADMIN_PATH + '/api/messages/<int:message_id>', methods=['DELETE'])
@admin_required
def admin_delete_message(message_id):
    message = db.session.get(Message, message_id)
    if not message:
        return jsonify({'success': False, 'message': 'Message not found.'}), 404
    db.session.delete(message)
    db.session.commit()
    socketio.emit('message_deleted', {'id': message_id})
    return jsonify({'success': True})


@app.route(ADMIN_PATH + '/api/messages', methods=['DELETE'])
@admin_required
def admin_clear_messages():
    ids = [m.id for m in Message.query.all()]
    Message.query.delete()
    db.session.commit()
    for message_id in ids:
        socketio.emit('message_deleted', {'id': message_id})
    return jsonify({'success': True})


with app.app_context():
    db.create_all()
    seed_questions()
    ensure_admin()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)

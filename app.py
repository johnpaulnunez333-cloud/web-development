import os
import re
import json
import statistics
import hmac
import hashlib
import secrets
import threading
import base64
import random
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from functools import wraps

import requests
from urllib.parse import urlparse
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, abort, Response
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import func, inspect, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import deferred, joinedload
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import generate_password_hash, check_password_hash

from avatars import AVATAR_KEYS, AVATAR_LABELS, render_avatar
from quiz_data import QUESTIONS, QUIZ_PLAN


def build_database_config():
    raw = os.environ.get('DATABASE_URL', '').strip()
    host = os.environ.get('DB_HOST', '').strip()

    if raw:
        url = make_url(raw)
    elif host:
        url = URL.create(
            'postgresql+psycopg2',
            username=os.environ.get('DB_USER', 'postgres'),
            password=os.environ.get('DB_PASSWORD', ''),
            host=host,
            port=int(os.environ.get('DB_PORT', '5432') or 5432),
            database=os.environ.get('DB_NAME', 'postgres')
        )
    else:
        return 'sqlite:///mdw.db', {'pool_pre_ping': True}

    options = {'pool_pre_ping': True, 'pool_recycle': 280}

    if url.drivername.split('+')[0] in ('postgres', 'postgresql'):
        url = url.set(drivername='postgresql+psycopg2')
        query = dict(url.query)
        query.setdefault('sslmode', 'require')
        url = url.set(query=query)
        options['pool_size'] = 3
        options['max_overflow'] = 2
        options['connect_args'] = {'connect_timeout': 15}

    return url.render_as_string(hide_password=False), options


DATABASE_URI, ENGINE_OPTIONS = build_database_config()

MAX_UPLOAD_BYTES = 32 * 1024 * 1024


app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.secret_key = os.environ.get('SECRET_KEY') or os.urandom(32).hex()

app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = bool(os.environ.get('RENDER')) or os.environ.get('FLASK_ENV') == 'production'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=12)
app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URI
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = ENGINE_OPTIONS
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = MAX_UPLOAD_BYTES

db = SQLAlchemy(app)
socketio = SocketIO(app, async_mode='threading', ping_interval=20, ping_timeout=60)


def user_rate_key():
    return str(session.get('user_id') or get_remote_address())


limiter = Limiter(get_remote_address, app=app, default_limits=[], storage_uri='memory://')

ADMIN_PATH = '/' + (os.environ.get('ADMIN_PATH', 'admin').strip('/') or 'admin')
MAX_HISTORY = 100
LOCKOUT_THRESHOLD = 5
LOCKOUT_DURATION_SECONDS = 300
EMAIL_REGEX = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
DATA_URL_REGEX = re.compile(r'^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$')
MAX_AVATAR_BYTES = 150 * 1024
MAX_PDF_BYTES = 25 * 1024 * 1024
MAX_COVER_BYTES = 3 * 1024 * 1024
DEFAULT_REQUEST_LIMIT = 1024 * 1024
RESET_CODE_MINUTES = 10
RESET_MAX_ATTEMPTS = 5
RESET_COOLDOWN_SECONDS = 60
MAIL_RELAY_URL = os.environ.get('MAIL_RELAY_URL', '').strip()
MAIL_RELAY_SECRET = os.environ.get('MAIL_RELAY_SECRET', '').strip()
START_TIME = time.time()
MEMORY_LIMIT_MB = int(os.environ.get('MEMORY_LIMIT_MB', '512') or 512)
DB_LIMIT_MB = int(os.environ.get('DB_LIMIT_MB', '500') or 500)
BUSINESS_URLS = [u.strip() for u in os.environ.get('BUSINESS_URL', '').split(',') if u.strip()][:3]
MAX_PRODUCT_IMAGE_BYTES = 3 * 1024 * 1024
SHOP_CATEGORIES = [
    'Circuits & Modules', 'Microcontrollers', 'Sensors', 'Resistors & Capacitors',
    'Cables & Connectors', 'Tools & Equipment', 'Other'
]
ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'completed', 'cancelled']
GLOBAL_CONVERSATION = {'id': None}
ai_state = {'last_ok': None, 'last_fail': None, 'last_status': None}
mail_state = {'last_ok': None, 'last_fail': None, 'last_error': ''}
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
    __tablename__ = 'mdw_users'
    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(80), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    avatar = db.Column(db.Text, nullable=True)
    avatar_version = db.Column(db.Integer, default=0, nullable=False)
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class Message(db.Model):
    __tablename__ = 'mdw_messages'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('mdw_users.id'), nullable=False, index=True)
    conversation_id = db.Column(db.Integer, db.ForeignKey('mdw_conversations.id'), nullable=True, index=True)
    text = db.Column(db.String(500), nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False, index=True)
    user = db.relationship('User')


class Question(db.Model):
    __tablename__ = 'mdw_questions'
    id = db.Column(db.Integer, primary_key=True)
    category = db.Column(db.String(40), nullable=False, index=True)
    question = db.Column(db.Text, nullable=False)
    options = db.Column(db.Text, nullable=False)
    answer = db.Column(db.Integer, nullable=False)
    active = db.Column(db.Boolean, default=True, nullable=False)


class QuizAttempt(db.Model):
    __tablename__ = 'mdw_quiz_attempts'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('mdw_users.id'), nullable=False, index=True)
    score = db.Column(db.Integer, nullable=False)
    total = db.Column(db.Integer, nullable=False)
    percent = db.Column(db.Integer, nullable=False)
    level = db.Column(db.String(20), nullable=False)
    breakdown = db.Column(db.Text, nullable=False, default='{}')
    duration_seconds = db.Column(db.Integer, nullable=True)
    risk_score = db.Column(db.Integer, nullable=True)
    risk_level = db.Column(db.String(10), nullable=True)
    risk_notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    user = db.relationship('User')


class Conversation(db.Model):
    __tablename__ = 'mdw_conversations'
    id = db.Column(db.Integer, primary_key=True)
    kind = db.Column(db.String(10), nullable=False, index=True)
    name = db.Column(db.String(80), nullable=True)
    dm_key = db.Column(db.String(40), unique=True, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('mdw_users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class ConversationMember(db.Model):
    __tablename__ = 'mdw_conversation_members'
    __table_args__ = (db.UniqueConstraint('conversation_id', 'user_id', name='uq_mdw_conversation_member'),)
    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(db.Integer, db.ForeignKey('mdw_conversations.id'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('mdw_users.id'), nullable=False, index=True)
    is_owner = db.Column(db.Boolean, default=False, nullable=False)
    last_read_id = db.Column(db.Integer, default=0, nullable=False)
    joined_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class Product(db.Model):
    __tablename__ = 'mdw_products'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    category = db.Column(db.String(40), nullable=False, index=True)
    description = db.Column(db.Text, nullable=False, default='')
    price_cents = db.Column(db.Integer, nullable=False)
    stock = db.Column(db.Integer, nullable=False, default=0)
    active = db.Column(db.Boolean, nullable=False, default=True)
    image_type = db.Column(db.String(10), nullable=False)
    image_size = db.Column(db.Integer, nullable=False)
    image_data = deferred(db.Column(db.LargeBinary, nullable=False))
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False, index=True)


class Order(db.Model):
    __tablename__ = 'mdw_orders'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('mdw_users.id'), nullable=True, index=True)
    customer_name = db.Column(db.String(80), nullable=False)
    phone = db.Column(db.String(30), nullable=False)
    address = db.Column(db.String(300), nullable=False)
    notes = db.Column(db.String(300), nullable=False, default='')
    total_cents = db.Column(db.Integer, nullable=False)
    status = db.Column(db.String(12), nullable=False, default='pending', index=True)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False, index=True)
    items = db.relationship('OrderItem', backref='order', cascade='all, delete-orphan')


class OrderItem(db.Model):
    __tablename__ = 'mdw_order_items'
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey('mdw_orders.id'), nullable=False, index=True)
    product_id = db.Column(db.Integer, nullable=True)
    name = db.Column(db.String(120), nullable=False)
    price_cents = db.Column(db.Integer, nullable=False)
    quantity = db.Column(db.Integer, nullable=False)


def ensure_columns():
    plan = {
        'mdw_messages': {'conversation_id': 'INTEGER'},
        'mdw_quiz_attempts': {
            'duration_seconds': 'INTEGER',
            'risk_score': 'INTEGER',
            'risk_level': 'VARCHAR(10)',
            'risk_notes': 'TEXT'
        }
    }
    try:
        inspector = inspect(db.engine)
        for table, columns in plan.items():
            if not inspector.has_table(table):
                continue
            existing = {c['name'] for c in inspector.get_columns(table)}
            for name, ddl in columns.items():
                if name not in existing:
                    db.session.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{name}" {ddl}'))
        db.session.execute(text('CREATE INDEX IF NOT EXISTS ix_mdw_messages_conversation_id ON mdw_messages (conversation_id)'))
        db.session.commit()
    except Exception as error:
        db.session.rollback()
        print(f'[MDW] WARNING: schema update failed: {type(error).__name__}: {error}', flush=True)


def ensure_global_conversation():
    conversation = Conversation.query.filter_by(kind='global').first()
    if not conversation:
        conversation = Conversation(kind='global', name='Manantan Network')
        db.session.add(conversation)
        db.session.commit()
    Message.query.filter(Message.conversation_id.is_(None)).update(
        {'conversation_id': conversation.id}, synchronize_session=False)
    db.session.commit()
    GLOBAL_CONVERSATION['id'] = conversation.id


class PasswordReset(db.Model):
    __tablename__ = 'mdw_password_resets'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('mdw_users.id'), nullable=False, index=True)
    code_hash = db.Column(db.String(64), nullable=False)
    attempts = db.Column(db.Integer, default=0, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class Book(db.Model):
    __tablename__ = 'mdw_books'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(150), nullable=False)
    cover_type = db.Column(db.String(10), nullable=False)
    cover_size = db.Column(db.Integer, nullable=False)
    cover_data = deferred(db.Column(db.LargeBinary, nullable=False))
    pdf_name = db.Column(db.String(200), nullable=False, default='')
    pdf_size = db.Column(db.Integer, nullable=False)
    pdf_data = deferred(db.Column(db.LargeBinary, nullable=False))
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False, index=True)


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


@app.before_request
def limit_request_size():
    is_upload = request.method == 'POST' and request.path in (ADMIN_PATH + '/api/books', ADMIN_PATH + '/api/products')
    limit = MAX_UPLOAD_BYTES if is_upload else DEFAULT_REQUEST_LIMIT
    if request.content_length and request.content_length > limit:
        return jsonify({'success': False, 'message': 'The request is too large.'}), 413


def admin_session_ok(user):
    return bool(user and user.is_admin and session.get('admin_ok') == user.id)


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        is_api = request.path.startswith(ADMIN_PATH + '/api/')
        if not admin_session_ok(current_user()):
            if is_api:
                return jsonify({'success': False, 'message': 'Admin login required.'}), 401
            return redirect(url_for('admin_panel'))
        return fn(*args, **kwargs)
    return wrapper


def send_email(to, subject, body):
    if not MAIL_RELAY_URL:
        print('[MDW] Email not sent: MAIL_RELAY_URL is not set.', flush=True)
        return False
    try:
        response = requests.post(
            MAIL_RELAY_URL,
            json={'secret': MAIL_RELAY_SECRET, 'to': to, 'subject': subject, 'body': body},
            timeout=30
        )
        response.raise_for_status()
        result = response.json()
    except (requests.exceptions.RequestException, ValueError) as error:
        print(f'[MDW] Email relay error: {type(error).__name__}: {error}', flush=True)
        mail_state['last_fail'] = utcnow()
        mail_state['last_error'] = type(error).__name__
        return False
    if not result.get('ok'):
        print(f"[MDW] Email relay refused the message: {result.get('error')}", flush=True)
        mail_state['last_fail'] = utcnow()
        mail_state['last_error'] = str(result.get('error'))[:80]
        return False
    mail_state['last_ok'] = utcnow()
    return True


def send_email_async(to, subject, body):
    threading.Thread(target=send_email, args=(to, subject, body), daemon=True).start()


def hash_reset_code(user_id, code):
    key = app.secret_key.encode('utf-8')
    return hmac.new(key, f'{user_id}:{code}'.encode('utf-8'), hashlib.sha256).hexdigest()


def detect_image_type(raw):
    if raw.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
    if raw.startswith(b'\xff\xd8\xff'):
        return 'jpeg'
    if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP':
        return 'webp'
    return None


def safe_filename(title):
    cleaned = re.sub(r'[^A-Za-z0-9 _-]+', '', title).strip()
    return (cleaned or 'book')[:80] + '.pdf'


def book_dict(book):
    return {
        'id': book.id,
        'title': book.title,
        'cover': f'/books/{book.id}/cover',
        'read': f'/books/{book.id}/read',
        'download': f'/books/{book.id}/download',
        'size': book.pdf_size,
        'created_at': iso(book.created_at)
    }


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


def attempt_dict(attempt, admin=False):
    data = {
        'id': attempt.id,
        'score': attempt.score,
        'total': attempt.total,
        'percent': attempt.percent,
        'level': attempt.level,
        'breakdown': json.loads(attempt.breakdown or '{}'),
        'created_at': iso(attempt.created_at)
    }
    if admin:
        try:
            notes = json.loads(attempt.risk_notes or '{}')
        except ValueError:
            notes = {}
        data.update({
            'risk_score': attempt.risk_score,
            'risk_level': attempt.risk_level,
            'risk_reasons': notes.get('reasons', []),
            'metrics': notes.get('metrics', {}),
            'duration_seconds': attempt.duration_seconds
        })
    return data


def clamp_number(value, low, high, default=0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number != number:
        return default
    return max(low, min(high, number))


def assess_integrity(metrics, total, percent, duration):
    tab_switches = int(clamp_number(metrics.get('tab_switches'), 0, 500))
    copies = int(clamp_number(metrics.get('copy_events'), 0, 500))
    away = int(clamp_number(metrics.get('away_seconds'), 0, 86400))
    raw_times = metrics.get('question_seconds')
    times = [clamp_number(v, 0, 3600) for v in raw_times[:60]] if isinstance(raw_times, list) else []

    score = 0
    reasons = []
    average = duration / total if total else 0

    if duration > 0 and total:
        if average < 4:
            score += 40
            reasons.append(f'Finished extremely fast: {duration}s total, {average:.1f}s per question.')
        elif average < 8:
            score += 20
            reasons.append(f'Finished very fast: {duration}s total, {average:.1f}s per question.')
        if percent >= 90 and average < 10:
            score += 20
            reasons.append('High score combined with very fast answers.')

    if tab_switches >= 3:
        score += 25
        reasons.append(f'Left the quiz tab {tab_switches} times.')
    elif tab_switches >= 1:
        score += 10
        reasons.append(f'Left the quiz tab {tab_switches} time(s).')

    if away >= 60:
        score += 15
        reasons.append(f'Spent {away}s away from the quiz tab.')

    if copies >= 1:
        score += 25
        reasons.append(f'Copied text from the quiz {copies} time(s).')

    if len(times) >= 8:
        mean = statistics.fmean(times)
        if mean >= 1.5 and statistics.pstdev(times) / mean < 0.12:
            score += 15
            reasons.append('Almost the same time spent on every question.')

    score = min(score, 100)
    level = 'High' if score >= 60 else 'Medium' if score >= 30 else 'Low'
    clean = {
        'tab_switches': tab_switches,
        'copy_events': copies,
        'away_seconds': away,
        'average_seconds': round(average, 1)
    }
    return score, level, reasons, clean


def message_dict(message):
    return {
        'id': message.id,
        'conversation_id': message.conversation_id,
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


AI_PRESETS = {
    'gemini': ('https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-3.8-flash'),
    'deepseek': ('https://api.deepseek.com', 'deepseek-chat'),
    'openrouter': ('https://openrouter.ai/api/v1', 'qwen/qwen3-coder:free'),
    'openai': ('https://api.openai.com/v1', 'gpt-4o-mini'),
}


def load_ai_config():
    deepseek_key = os.environ.get('DEEPSEEK_API_KEY', '').strip()
    gemini_key = os.environ.get('GEMINI_API_KEY', '').strip()
    generic_key = os.environ.get('AI_API_KEY', '').strip()
    provider = os.environ.get('AI_PROVIDER', '').strip().lower()

    if provider not in AI_PRESETS:
        if gemini_key:
            provider = 'gemini'
        elif deepseek_key:
            provider = 'deepseek'
        elif generic_key.startswith('AIza'):
            provider = 'gemini'
        elif generic_key.startswith('sk-or-'):
            provider = 'openrouter'
        else:
            provider = 'deepseek'

    if provider == 'gemini':
        key = gemini_key or generic_key or deepseek_key
    elif provider == 'deepseek':
        key = deepseek_key or generic_key or gemini_key
    else:
        key = generic_key or gemini_key or deepseek_key

    base_url, model = AI_PRESETS[provider]
    base_url = os.environ.get('AI_BASE_URL') or (os.environ.get('DEEPSEEK_BASE_URL') if provider == 'deepseek' else None) or base_url
    model = os.environ.get('AI_MODEL') or (os.environ.get('DEEPSEEK_MODEL') if provider == 'deepseek' else None) or model
    return key, provider, base_url.strip(), model.strip()


AI_API_KEY, AI_PROVIDER_NAME, AI_BASE_URL, AI_MODEL = load_ai_config()

AI_FAILURE_HINTS = {
    400: 'The AI provider rejected the request. Check the model name and the key type.',
    401: 'The AI API key is invalid.',
    402: 'The AI account has no balance left.',
    403: 'The AI API key is not allowed to use this model or region.',
    404: 'The AI model name or base URL is wrong, or the model was retired.',
    429: 'The AI quota is used up or there are too many requests.',
}


def ai_failure_message(user, status=None, detail=''):
    if status == 429:
        return 'The assistant is busy right now. Please try again in a minute.'
    if user and user.is_admin:
        hint = AI_FAILURE_HINTS.get(status, detail or 'The AI provider returned an unexpected error.')
        label = f'HTTP {status}' if status else 'no response'
        return f'{hint} [{label} | {AI_PROVIDER_NAME} | {AI_MODEL}]'
    return 'The assistant is temporarily unavailable. Please try again.'


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
def root():
    if current_user():
        return redirect(url_for('dashboard'))
    return redirect(url_for('login'))


@app.route('/home')
@login_required
def index():
    return render_template('index.html')


@app.route('/login')
def login():
    if current_user():
        return redirect(url_for('dashboard'))
    return render_template('login.html')


@app.route('/signup')
def signup():
    if current_user():
        return redirect(url_for('dashboard'))
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
    return redirect(url_for('login'))


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
    metrics = data.get('metrics') if isinstance(data.get('metrics'), dict) else {}
    started = int(state.get('started') or time.time())
    duration = max(0, int(time.time()) - started)
    risk_score, risk_level, risk_reasons, risk_metrics = assess_integrity(metrics, total, percent, duration)
    attempt = QuizAttempt(
        user_id=user.id,
        score=score,
        total=total,
        percent=percent,
        level=level_for(percent),
        breakdown=json.dumps(breakdown),
        duration_seconds=duration,
        risk_score=risk_score,
        risk_level=risk_level,
        risk_notes=json.dumps({'reasons': risk_reasons, 'metrics': risk_metrics})
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
    user = current_user()
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

    messages = [{'role': 'system', 'content': AI_SYSTEM_PROMPT}] + history + [{'role': 'user', 'content': message[:1000]}]

    try:
        response = requests.post(
            f"{AI_BASE_URL.rstrip('/')}/chat/completions",
            headers={'Authorization': f'Bearer {AI_API_KEY}', 'Content-Type': 'application/json'},
            json={'model': AI_MODEL, 'messages': messages, 'max_tokens': 900, 'temperature': 0.5},
            timeout=45
        )
        response.raise_for_status()
        reply = response.json()['choices'][0]['message']['content']
        if not reply or not str(reply).strip():
            return jsonify({'success': False, 'message': 'The assistant returned an empty answer. Try rephrasing your question.'}), 502
        ai_state['last_ok'] = utcnow()
        return jsonify({'success': True, 'reply': reply})
    except requests.exceptions.HTTPError as error:
        status = error.response.status_code if error.response is not None else None
        body = error.response.text[:500] if error.response is not None else ''
        print(f'[AI Assistant Error] HTTP {status} | {AI_PROVIDER_NAME} | {AI_MODEL} | {body}', flush=True)
        ai_state['last_fail'] = utcnow()
        ai_state['last_status'] = status
        return jsonify({'success': False, 'message': ai_failure_message(user, status)}), 502
    except (requests.exceptions.RequestException, KeyError, IndexError, ValueError, TypeError) as error:
        print(f'[AI Assistant Error] {type(error).__name__}: {error}', flush=True)
        ai_state['last_fail'] = utcnow()
        ai_state['last_status'] = None
        return jsonify({'success': False, 'message': ai_failure_message(user, None, f'{type(error).__name__}: {str(error)[:120]}')}), 502


@app.route('/books')
@login_required
def books():
    return render_template('books.html', user=current_user())


@app.route('/api/books')
@api_login_required
def api_books():
    rows = Book.query.order_by(Book.created_at.desc()).all()
    return jsonify({'books': [book_dict(b) for b in rows]})


@app.route('/books/<int:book_id>/cover')
def book_cover(book_id):
    if not current_user():
        abort(401)
    book = db.session.get(Book, book_id)
    if not book:
        abort(404)
    response = Response(bytes(book.cover_data), mimetype='image/' + book.cover_type)
    response.headers['Cache-Control'] = 'private, max-age=86400'
    return response


def pdf_response(book_id, disposition):
    if not current_user():
        abort(401)
    book = db.session.get(Book, book_id)
    if not book:
        abort(404)
    data = bytes(book.pdf_data)
    response = Response(data, mimetype='application/pdf')
    response.headers['Content-Disposition'] = f'{disposition}; filename="{safe_filename(book.title)}"'
    response.headers['Content-Length'] = str(len(data))
    response.headers['Cache-Control'] = 'private, max-age=3600'
    return response


@app.route('/books/<int:book_id>/read')
def book_read(book_id):
    return pdf_response(book_id, 'inline')


@app.route('/books/<int:book_id>/download')
def book_download(book_id):
    return pdf_response(book_id, 'attachment')


@app.route('/api/password/forgot', methods=['POST'])
@limiter.limit('5 per hour')
def api_password_forgot():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()

    if len(email) > 120 or not EMAIL_REGEX.match(email):
        return jsonify({'success': False, 'message': 'Enter a valid email address.'}), 400
    if not MAIL_RELAY_URL:
        return jsonify({'success': False, 'message': 'Password reset email is not set up yet. Please contact the administrator.'}), 503

    user = User.query.filter_by(email=email).first()
    if user:
        latest = (PasswordReset.query.filter_by(user_id=user.id)
                  .order_by(PasswordReset.created_at.desc()).first())
        waited = (utcnow() - latest.created_at).total_seconds() if latest else RESET_COOLDOWN_SECONDS
        if waited >= RESET_COOLDOWN_SECONDS:
            code = f'{secrets.randbelow(1000000):06d}'
            PasswordReset.query.filter_by(user_id=user.id).delete()
            db.session.add(PasswordReset(
                user_id=user.id,
                code_hash=hash_reset_code(user.id, code),
                expires_at=utcnow() + timedelta(minutes=RESET_CODE_MINUTES)
            ))
            db.session.commit()
            send_email_async(
                user.email,
                'Your Manantan Digital Works password reset code',
                f'Hello {user.full_name},\n\n'
                f'Your password reset code is: {code}\n\n'
                f'It expires in {RESET_CODE_MINUTES} minutes. If you did not request this, you can ignore this email.\n\n'
                'Manantan Digital Works'
            )

    return jsonify({
        'success': True,
        'message': 'If an account exists for that email, a 6-digit code was sent. Check your inbox and spam folder.'
    })


@app.route('/api/password/reset', methods=['POST'])
@limiter.limit('15 per hour')
def api_password_reset():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    code = str(data.get('code') or '').strip()
    password = data.get('password') or ''
    failure = jsonify({'success': False, 'message': 'The code is invalid or has expired.'}), 400

    if not re.fullmatch(r'\d{6}', code):
        return jsonify({'success': False, 'message': 'Enter the 6-digit code from your email.'}), 400
    if not is_strong_password(password):
        return jsonify({
            'success': False,
            'message': 'Password must be at least 8 characters and include a letter and a number.'
        }), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        return failure

    record = (PasswordReset.query.filter_by(user_id=user.id)
              .order_by(PasswordReset.created_at.desc()).first())
    if not record or record.expires_at < utcnow() or record.attempts >= RESET_MAX_ATTEMPTS:
        return failure

    if not hmac.compare_digest(record.code_hash, hash_reset_code(user.id, code)):
        record.attempts += 1
        db.session.commit()
        return failure

    user.password_hash = generate_password_hash(password)
    PasswordReset.query.filter_by(user_id=user.id).delete()
    db.session.commit()
    failed_login_attempts.pop(lockout_key(email), None)
    return jsonify({'success': True, 'message': 'Password updated. You can sign in now.'})


def to_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def dm_key(first_id, second_id):
    low, high = sorted((first_id, second_id))
    return f'{low}-{high}'


def get_membership(user_id, conversation_id):
    return ConversationMember.query.filter_by(user_id=user_id, conversation_id=conversation_id).first()


def ensure_global_membership(user):
    conversation_id = GLOBAL_CONVERSATION['id']
    membership = get_membership(user.id, conversation_id)
    if not membership:
        db.session.add(ConversationMember(conversation_id=conversation_id, user_id=user.id))
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
        membership = get_membership(user.id, conversation_id)
    return membership


def accessible_conversation(user, conversation_id):
    if conversation_id is None:
        return None, None
    conversation = db.session.get(Conversation, conversation_id)
    if not conversation:
        return None, None
    if conversation.kind == 'global':
        return conversation, ensure_global_membership(user)
    membership = get_membership(user.id, conversation.id)
    if not membership:
        return None, None
    return conversation, membership


def add_online_to_room(user_ids, room):
    for sid, user_id in list(online.items()):
        if user_id in user_ids:
            join_room(room, sid=sid, namespace='/')


def remove_online_from_room(user_id, room):
    for sid, uid in list(online.items()):
        if uid == user_id:
            leave_room(room, sid=sid, namespace='/')


def notify_users(user_ids, event, payload):
    for user_id in user_ids:
        socketio.emit(event, payload, to=f'u{user_id}')


def conversation_summary(conversation, membership, user):
    last = (Message.query.options(joinedload(Message.user))
            .filter_by(conversation_id=conversation.id).order_by(Message.id.desc()).first())
    unread = Message.query.filter(
        Message.conversation_id == conversation.id,
        Message.id > (membership.last_read_id or 0),
        Message.user_id != user.id
    ).count()
    summary = {
        'id': conversation.id,
        'kind': conversation.kind,
        'unread': unread,
        'last_message': {
            'text': last.text[:80],
            'sender': last.user.full_name,
            'timestamp': iso(last.created_at)
        } if last else None,
        'last_activity': iso(last.created_at if last else conversation.created_at)
    }
    if conversation.kind == 'global':
        summary['name'] = 'Manantan Network'
    elif conversation.kind == 'group':
        summary['name'] = conversation.name
        summary['member_count'] = ConversationMember.query.filter_by(conversation_id=conversation.id).count()
        summary['is_owner'] = membership.is_owner
    else:
        other_member = ConversationMember.query.filter(
            ConversationMember.conversation_id == conversation.id,
            ConversationMember.user_id != user.id
        ).first()
        other = db.session.get(User, other_member.user_id) if other_member else None
        summary['name'] = other.full_name if other else 'Deleted member'
        summary['avatar'] = avatar_url(other) if other else None
        summary['peer_id'] = other.id if other else None
        summary['online'] = bool(other and other.id in set(online.values()))
    return summary


def member_dict(user, owner_ids):
    return {
        'id': user.id,
        'name': user.full_name,
        'avatar': avatar_url(user),
        'online': user.id in set(online.values()),
        'is_owner': user.id in owner_ids
    }


@app.route('/api/chat/conversations')
@api_login_required
def api_chat_conversations():
    user = current_user()
    ensure_global_membership(user)
    rows = []
    for membership in ConversationMember.query.filter_by(user_id=user.id).all():
        conversation = db.session.get(Conversation, membership.conversation_id)
        if not conversation:
            continue
        summary = conversation_summary(conversation, membership, user)
        if conversation.kind == 'dm' and not summary['last_message'] and conversation.created_by != user.id:
            continue
        rows.append(summary)
    rows.sort(key=lambda r: r['last_activity'] or '', reverse=True)
    rows.sort(key=lambda r: r['kind'] != 'global')
    return jsonify({'conversations': rows})


@app.route('/api/chat/conversations/<int:conversation_id>')
@api_login_required
def api_chat_conversation(conversation_id):
    user = current_user()
    conversation, membership = accessible_conversation(user, conversation_id)
    if not conversation:
        return jsonify({'success': False, 'message': 'Conversation not found.'}), 404
    members = []
    if conversation.kind != 'global':
        memberships = ConversationMember.query.filter_by(conversation_id=conversation.id).all()
        owner_ids = {m.user_id for m in memberships if m.is_owner}
        users = User.query.filter(User.id.in_([m.user_id for m in memberships])).all()
        members = [member_dict(u, owner_ids) for u in users]
    return jsonify({
        'success': True,
        'conversation': conversation_summary(conversation, membership, user),
        'members': members
    })


@app.route('/api/chat/users')
@api_login_required
def api_chat_users():
    user = current_user()
    term = (request.args.get('q') or '').strip()[:60]
    query = User.query.filter(User.id != user.id)
    if term:
        query = query.filter(User.full_name.ilike(f'%{term}%'))
    rows = query.order_by(User.full_name.asc()).limit(150).all()
    online_ids = set(online.values())
    return jsonify({'users': [
        {'id': u.id, 'name': u.full_name, 'avatar': avatar_url(u), 'online': u.id in online_ids}
        for u in rows
    ]})


@app.route('/api/chat/dm', methods=['POST'])
@api_login_required
@limiter.limit('120 per hour')
def api_chat_dm():
    user = current_user()
    data = request.get_json(silent=True) or {}
    target_id = to_int(data.get('user_id'))
    target = db.session.get(User, target_id) if target_id is not None else None
    if not target or target.id == user.id:
        return jsonify({'success': False, 'message': 'Choose another member to message.'}), 400

    key = dm_key(user.id, target.id)
    conversation = Conversation.query.filter_by(kind='dm', dm_key=key).first()
    if not conversation:
        conversation = Conversation(kind='dm', dm_key=key, created_by=user.id)
        db.session.add(conversation)
        try:
            db.session.flush()
            db.session.add(ConversationMember(conversation_id=conversation.id, user_id=user.id))
            db.session.add(ConversationMember(conversation_id=conversation.id, user_id=target.id))
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            conversation = Conversation.query.filter_by(kind='dm', dm_key=key).first()
        if conversation:
            add_online_to_room({user.id, target.id}, f'c{conversation.id}')
            notify_users([target.id], 'conversation_update', {'conversation_id': conversation.id})
    if not conversation:
        return jsonify({'success': False, 'message': 'Could not open the conversation.'}), 500
    membership = get_membership(user.id, conversation.id)
    return jsonify({'success': True, 'conversation': conversation_summary(conversation, membership, user)})


@app.route('/api/chat/groups', methods=['POST'])
@api_login_required
@limiter.limit('10 per hour')
def api_chat_group_create():
    user = current_user()
    data = request.get_json(silent=True) or {}
    name = ' '.join((data.get('name') or '').split())
    raw_ids = data.get('member_ids')

    if len(name) < 2 or len(name) > 40:
        return jsonify({'success': False, 'message': 'The group name must be 2 to 40 characters.'}), 400
    if not isinstance(raw_ids, list):
        return jsonify({'success': False, 'message': 'Pick at least one member.'}), 400
    member_ids = {to_int(v) for v in raw_ids} - {None, user.id}
    if not member_ids or len(member_ids) > 49:
        return jsonify({'success': False, 'message': 'Pick between 1 and 49 members.'}), 400
    if User.query.filter(User.id.in_(member_ids)).count() != len(member_ids):
        return jsonify({'success': False, 'message': 'One of the selected members was not found.'}), 400

    conversation = Conversation(kind='group', name=name, created_by=user.id)
    db.session.add(conversation)
    db.session.flush()
    db.session.add(ConversationMember(conversation_id=conversation.id, user_id=user.id, is_owner=True))
    for member_id in member_ids:
        db.session.add(ConversationMember(conversation_id=conversation.id, user_id=member_id))
    db.session.commit()

    add_online_to_room(member_ids | {user.id}, f'c{conversation.id}')
    notify_users(member_ids, 'conversation_update', {'conversation_id': conversation.id})
    membership = get_membership(user.id, conversation.id)
    return jsonify({'success': True, 'conversation': conversation_summary(conversation, membership, user)})


@app.route('/api/chat/groups/<int:conversation_id>/members', methods=['POST'])
@api_login_required
@limiter.limit('30 per hour')
def api_chat_group_add(conversation_id):
    user = current_user()
    conversation, membership = accessible_conversation(user, conversation_id)
    if not conversation or conversation.kind != 'group':
        return jsonify({'success': False, 'message': 'Group not found.'}), 404
    if not membership.is_owner:
        return jsonify({'success': False, 'message': 'Only the group owner can add members.'}), 403

    data = request.get_json(silent=True) or {}
    raw_ids = data.get('member_ids')
    if not isinstance(raw_ids, list):
        return jsonify({'success': False, 'message': 'Pick at least one member.'}), 400
    existing = {m.user_id for m in ConversationMember.query.filter_by(conversation_id=conversation.id).all()}
    new_ids = {to_int(v) for v in raw_ids} - {None} - existing
    if not new_ids:
        return jsonify({'success': False, 'message': 'Those members are already in the group.'}), 400
    if len(existing) + len(new_ids) > 50:
        return jsonify({'success': False, 'message': 'A group can have at most 50 members.'}), 400
    if User.query.filter(User.id.in_(new_ids)).count() != len(new_ids):
        return jsonify({'success': False, 'message': 'One of the selected members was not found.'}), 400

    for member_id in new_ids:
        db.session.add(ConversationMember(conversation_id=conversation.id, user_id=member_id))
    db.session.commit()
    add_online_to_room(new_ids, f'c{conversation.id}')
    notify_users(new_ids | existing, 'conversation_update', {'conversation_id': conversation.id})
    return jsonify({'success': True})


@app.route('/api/chat/groups/<int:conversation_id>/leave', methods=['POST'])
@api_login_required
def api_chat_group_leave(conversation_id):
    user = current_user()
    conversation, membership = accessible_conversation(user, conversation_id)
    if not conversation or conversation.kind != 'group':
        return jsonify({'success': False, 'message': 'Group not found.'}), 404

    was_owner = membership.is_owner
    db.session.delete(membership)
    db.session.commit()
    remove_online_from_room(user.id, f'c{conversation.id}')

    remaining = (ConversationMember.query.filter_by(conversation_id=conversation.id)
                 .order_by(ConversationMember.joined_at.asc()).all())
    if not remaining:
        Message.query.filter_by(conversation_id=conversation.id).delete()
        db.session.delete(conversation)
    elif was_owner:
        remaining[0].is_owner = True
    db.session.commit()
    notify_users([m.user_id for m in remaining], 'conversation_update', {'conversation_id': conversation_id})
    return jsonify({'success': True})


@socketio.on('connect')
def handle_connect():
    user = current_user()
    if not user:
        return False

    ensure_global_membership(user)
    first_connection = user.id not in online.values()
    online[request.sid] = user.id

    join_room(f'u{user.id}')
    for membership in ConversationMember.query.filter_by(user_id=user.id).all():
        join_room(f'c{membership.conversation_id}')

    emit('online_users', online_payload(), broadcast=True)
    if first_connection:
        emit('user_joined', {'name': user.full_name, 'conversation_id': GLOBAL_CONVERSATION['id']},
             to=f"c{GLOBAL_CONVERSATION['id']}", include_self=False)


@socketio.on('disconnect')
def handle_disconnect():
    user_id = online.pop(request.sid, None)
    if user_id is None:
        return
    emit('online_users', online_payload(), broadcast=True)
    if user_id not in online.values():
        user = db.session.get(User, user_id)
        if user:
            emit('user_left', {'name': user.full_name, 'conversation_id': GLOBAL_CONVERSATION['id']},
                 to=f"c{GLOBAL_CONVERSATION['id']}")


@socketio.on('open_conversation')
def handle_open_conversation(data):
    user = current_user()
    if not user or not isinstance(data, dict):
        return
    conversation, membership = accessible_conversation(user, to_int(data.get('conversation_id')))
    if not conversation:
        emit('chat_error', {'message': 'You cannot open this conversation.'})
        return

    join_room(f'c{conversation.id}')
    recent = (Message.query.options(joinedload(Message.user))
              .filter_by(conversation_id=conversation.id)
              .order_by(Message.id.desc()).limit(MAX_HISTORY).all())
    recent.reverse()
    emit('chat_history', {'conversation_id': conversation.id, 'messages': [message_dict(m) for m in recent]})
    if recent:
        membership.last_read_id = recent[-1].id
        db.session.commit()


@socketio.on('chat_message')
def handle_chat_message(data):
    user = current_user()
    if not user or not isinstance(data, dict):
        return

    conversation, membership = accessible_conversation(user, to_int(data.get('conversation_id')))
    if not conversation:
        emit('chat_error', {'message': 'You cannot send messages to this conversation.'})
        return

    text = (data.get('text') or '').strip() if isinstance(data.get('text'), str) else ''
    if not text:
        return

    now = time.time()
    if now - last_sent.get(user.id, 0) < 0.5:
        emit('chat_error', {'message': 'You are sending messages too fast.'})
        return
    last_sent[user.id] = now

    message = Message(conversation_id=conversation.id, user_id=user.id, text=text[:500])
    db.session.add(message)
    db.session.commit()
    membership.last_read_id = message.id
    db.session.commit()
    emit('chat_message', message_dict(message), to=f'c{conversation.id}')


@socketio.on('mark_read')
def handle_mark_read(data):
    user = current_user()
    if not user or not isinstance(data, dict):
        return
    conversation, membership = accessible_conversation(user, to_int(data.get('conversation_id')))
    if not conversation:
        return
    latest = db.session.query(func.max(Message.id)).filter(Message.conversation_id == conversation.id).scalar() or 0
    if latest > (membership.last_read_id or 0):
        membership.last_read_id = latest
        db.session.commit()


@socketio.on('typing')
def handle_typing(data):
    user = current_user()
    if not user or not isinstance(data, dict):
        return
    conversation, membership = accessible_conversation(user, to_int(data.get('conversation_id')))
    if conversation:
        emit('typing', {'id': user.id, 'name': user.full_name, 'conversation_id': conversation.id},
             to=f'c{conversation.id}', include_self=False)


@socketio.on('connect', namespace='/site')
def handle_site_connect():
    site_visitors[request.sid] = True
    emit('visitor_count', len(site_visitors), broadcast=True, namespace='/site')


@socketio.on('disconnect', namespace='/site')
def handle_site_disconnect():
    site_visitors.pop(request.sid, None)
    emit('visitor_count', len(site_visitors), broadcast=True, namespace='/site')


@app.route(ADMIN_PATH)
def admin_panel():
    user = current_user()
    if admin_session_ok(user):
        return render_template('admin.html', base=ADMIN_PATH, user=user)
    return render_template('admin-login.html', base=ADMIN_PATH)


@app.route(ADMIN_PATH + '/api/login', methods=['POST'])
@limiter.limit('8 per minute')
def admin_login():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    if is_account_locked(email):
        return jsonify({'success': False, 'message': 'Too many failed attempts. Please try again in a few minutes.'}), 429

    user = User.query.filter_by(email=email).first()
    if not user or not user.is_admin or not check_password_hash(user.password_hash, password):
        register_failed_attempt(email)
        return jsonify({'success': False, 'message': 'Invalid admin email or password.'}), 401

    failed_login_attempts.pop(lockout_key(email), None)
    login_user(user)
    session['admin_ok'] = user.id
    return jsonify({'success': True})


@app.route(ADMIN_PATH + '/logout')
def admin_logout():
    session.pop('admin_ok', None)
    return redirect(url_for('admin_panel'))


@app.route(ADMIN_PATH + '/books')
@admin_required
def admin_books_page():
    return render_template('admin-books.html', base=ADMIN_PATH, user=current_user())


def latest_attempts_by_user():
    latest = {}
    counts = {}
    for attempt in QuizAttempt.query.order_by(QuizAttempt.created_at.asc()).all():
        latest[attempt.user_id] = attempt
        counts[attempt.user_id] = counts.get(attempt.user_id, 0) + 1
    return latest, counts


def integrity_counts():
    rows = (db.session.query(QuizAttempt.risk_level, func.count(QuizAttempt.id))
            .filter(QuizAttempt.risk_level.isnot(None)).group_by(QuizAttempt.risk_level).all())
    counts = {'Low': 0, 'Medium': 0, 'High': 0}
    for level, count in rows:
        counts[level] = count
    counts['total'] = counts['Low'] + counts['Medium'] + counts['High']
    return counts


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
        'books': Book.query.count(),
        'integrity': integrity_counts(),
        'products': Product.query.filter_by(active=True).count(),
        'orders_pending': Order.query.filter_by(status='pending').count(),
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
    dm_ids = [c.id for c in Conversation.query.filter_by(kind='dm').all()
              if ConversationMember.query.filter_by(conversation_id=c.id, user_id=target.id).first()]
    for conversation_id in dm_ids:
        Message.query.filter_by(conversation_id=conversation_id).delete()
        ConversationMember.query.filter_by(conversation_id=conversation_id).delete()
        Conversation.query.filter_by(id=conversation_id).delete()
    Message.query.filter_by(user_id=target.id).delete()
    ConversationMember.query.filter_by(user_id=target.id).delete()
    QuizAttempt.query.filter_by(user_id=target.id).delete()
    PasswordReset.query.filter_by(user_id=target.id).delete()
    Order.query.filter_by(user_id=target.id).update({'user_id': None})
    Conversation.query.filter_by(created_by=target.id).update({'created_by': None})
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
        row = attempt_dict(a, True)
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
            .filter(Message.conversation_id == GLOBAL_CONVERSATION['id'])
            .order_by(Message.id.desc()).limit(200).all())
    return jsonify({'messages': [message_dict(m) for m in rows]})


@app.route(ADMIN_PATH + '/api/messages/<int:message_id>', methods=['DELETE'])
@admin_required
def admin_delete_message(message_id):
    message = db.session.get(Message, message_id)
    if not message or message.conversation_id != GLOBAL_CONVERSATION['id']:
        return jsonify({'success': False, 'message': 'Message not found.'}), 404
    db.session.delete(message)
    db.session.commit()
    socketio.emit('message_deleted', {'id': message_id})
    return jsonify({'success': True})


@app.route(ADMIN_PATH + '/api/messages', methods=['DELETE'])
@admin_required
def admin_clear_messages():
    ids = [m.id for m in Message.query.filter_by(conversation_id=GLOBAL_CONVERSATION['id']).all()]
    Message.query.filter_by(conversation_id=GLOBAL_CONVERSATION['id']).delete()
    db.session.commit()
    for message_id in ids:
        socketio.emit('message_deleted', {'id': message_id})
    return jsonify({'success': True})


@app.route(ADMIN_PATH + '/api/books')
@admin_required
def admin_books_list():
    rows = Book.query.order_by(Book.created_at.desc()).all()
    used = db.session.query(func.coalesce(func.sum(Book.pdf_size + Book.cover_size), 0)).scalar() or 0
    return jsonify({'books': [book_dict(b) for b in rows], 'used_bytes': int(used), 'max_pdf_bytes': MAX_PDF_BYTES})


@app.route(ADMIN_PATH + '/api/books', methods=['POST'])
@admin_required
def admin_books_add():
    title = ' '.join((request.form.get('title') or '').split())
    cover = request.files.get('cover')
    pdf = request.files.get('pdf')

    if len(title) < 2 or len(title) > 150:
        return jsonify({'success': False, 'message': 'The title must be 2 to 150 characters.'}), 400
    if not cover or not pdf:
        return jsonify({'success': False, 'message': 'Choose a cover picture and a PDF file.'}), 400

    cover_raw = cover.read(MAX_COVER_BYTES + 1)
    if len(cover_raw) > MAX_COVER_BYTES:
        return jsonify({'success': False, 'message': 'The cover picture is too large (3 MB maximum).'}), 400
    kind = detect_image_type(cover_raw)
    if not kind:
        return jsonify({'success': False, 'message': 'The cover must be a PNG, JPEG, or WebP image.'}), 400

    pdf_raw = pdf.read(MAX_PDF_BYTES + 1)
    if len(pdf_raw) > MAX_PDF_BYTES:
        return jsonify({'success': False, 'message': 'The PDF is too large (25 MB maximum).'}), 400
    if not pdf_raw.startswith(b'%PDF-'):
        return jsonify({'success': False, 'message': 'The book file must be a valid PDF.'}), 400

    book = Book(
        title=title,
        cover_type=kind,
        cover_size=len(cover_raw),
        cover_data=cover_raw,
        pdf_name=(pdf.filename or '')[:200],
        pdf_size=len(pdf_raw),
        pdf_data=pdf_raw
    )
    db.session.add(book)
    try:
        db.session.commit()
    except SQLAlchemyError as error:
        db.session.rollback()
        print(f'[MDW] Book upload failed: {type(error).__name__}: {error}', flush=True)
        return jsonify({'success': False, 'message': 'The database could not store this file. It may be full.'}), 500
    return jsonify({'success': True, 'book': book_dict(book)})


@app.route(ADMIN_PATH + '/api/books/<int:book_id>', methods=['DELETE'])
@admin_required
def admin_books_delete(book_id):
    book = db.session.get(Book, book_id)
    if not book:
        return jsonify({'success': False, 'message': 'Book not found.'}), 404
    db.session.delete(book)
    db.session.commit()
    return jsonify({'success': True})


def read_memory_mb():
    try:
        with open('/proc/self/status') as handle:
            for line in handle:
                if line.startswith('VmRSS:'):
                    return int(line.split()[1]) / 1024
    except (OSError, ValueError, IndexError):
        return None
    return None


def format_uptime(seconds):
    seconds = int(seconds)
    days, rest = divmod(seconds, 86400)
    hours, rest = divmod(rest, 3600)
    minutes = rest // 60
    if days:
        return f'{days}d {hours}h'
    if hours:
        return f'{hours}h {minutes}m'
    return f'{minutes}m'


def make_check(key, label, status, score, detail, latency=None):
    return {'key': key, 'label': label, 'status': status, 'score': score, 'detail': detail, 'latency_ms': latency}


def normalize_url(url):
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    return url


def http_probe(url, timeout):
    started = time.time()
    try:
        response = requests.get(url, timeout=timeout, allow_redirects=True, headers={'User-Agent': 'MDW-HealthCheck'})
        return {'code': response.status_code, 'ms': int((time.time() - started) * 1000), 'error': ''}
    except requests.exceptions.Timeout:
        return {'code': None, 'ms': int((time.time() - started) * 1000), 'error': 'timeout'}
    except requests.exceptions.RequestException as error:
        return {'code': None, 'ms': int((time.time() - started) * 1000), 'error': type(error).__name__}


def ai_live_probe():
    started = time.time()
    try:
        response = requests.post(
            f"{AI_BASE_URL.rstrip('/')}/chat/completions",
            headers={'Authorization': f'Bearer {AI_API_KEY}', 'Content-Type': 'application/json'},
            json={'model': AI_MODEL, 'messages': [{'role': 'user', 'content': 'Reply with the single word OK.'}], 'max_tokens': 8},
            timeout=25
        )
        return {'code': response.status_code, 'ms': int((time.time() - started) * 1000), 'error': ''}
    except requests.exceptions.RequestException as error:
        return {'code': None, 'ms': int((time.time() - started) * 1000), 'error': type(error).__name__}


def check_database():
    started = time.time()
    try:
        db.session.execute(text('SELECT 1'))
    except Exception as error:
        db.session.rollback()
        return make_check('database', 'Database', 'fail', 0, f'Cannot reach the database ({type(error).__name__}).')
    ms = int((time.time() - started) * 1000)
    if ms < 400:
        return make_check('database', 'Database', 'ok', 100, f'Connected to {db.engine.dialect.name}.', ms)
    if ms < 1500:
        return make_check('database', 'Database', 'warn', 70, 'Connected, but responding slowly.', ms)
    return make_check('database', 'Database', 'warn', 40, 'Connected, but very slow.', ms)


def check_storage():
    if db.engine.dialect.name != 'postgresql':
        return make_check('storage', 'Database storage', 'info', None, 'Storage size is only measured on PostgreSQL.')
    try:
        used = db.session.execute(text('SELECT pg_database_size(current_database())')).scalar() or 0
    except Exception as error:
        db.session.rollback()
        return make_check('storage', 'Database storage', 'warn', 60, f'Could not measure size ({type(error).__name__}).')
    limit = DB_LIMIT_MB * 1024 * 1024
    percent = used / limit * 100
    detail = f'{used / 1024 / 1024:.0f} MB of {DB_LIMIT_MB} MB used ({percent:.0f}%).'
    if percent < 70:
        return make_check('storage', 'Database storage', 'ok', 100, detail)
    if percent < 90:
        return make_check('storage', 'Database storage', 'warn', 60, detail)
    return make_check('storage', 'Database storage', 'fail', 20, detail)


def check_server():
    memory = read_memory_mb()
    uptime = format_uptime(time.time() - START_TIME)
    if memory is None:
        return make_check('server', 'Web server', 'ok', 100, f'Running for {uptime}.')
    percent = memory / MEMORY_LIMIT_MB * 100
    detail = f'Running for {uptime}. Memory {memory:.0f} MB of {MEMORY_LIMIT_MB} MB ({percent:.0f}%).'
    if percent < 70:
        return make_check('server', 'Web server', 'ok', 100, detail)
    if percent < 90:
        return make_check('server', 'Web server', 'warn', 60, detail)
    return make_check('server', 'Web server', 'fail', 20, detail)


def check_ai(live):
    label = 'AI assistant'
    where = f'{AI_PROVIDER_NAME} / {AI_MODEL}'
    if not AI_API_KEY:
        return make_check('ai', label, 'fail', 0, 'No AI API key is set.')
    if live:
        code = live['code']
        if code is not None and 200 <= code < 300:
            ai_state['last_ok'] = utcnow()
            return make_check('ai', label, 'ok', 100, f'Live test passed ({where}).', live['ms'])
        ai_state['last_fail'] = utcnow()
        ai_state['last_status'] = code
        if code == 429:
            return make_check('ai', label, 'warn', 50, f'Quota used up or rate limited ({where}).', live['ms'])
        reason = f'HTTP {code}' if code else live['error']
        return make_check('ai', label, 'fail', 0, f'Live test failed: {reason} ({where}).', live['ms'])
    last_ok, last_fail = ai_state['last_ok'], ai_state['last_fail']
    if last_fail and (not last_ok or last_fail > last_ok):
        reason = f"HTTP {ai_state['last_status']}" if ai_state['last_status'] else 'no response'
        return make_check('ai', label, 'fail', 20, f'The last answer failed: {reason} ({where}).')
    if last_ok:
        return make_check('ai', label, 'ok', 100, f'Last successful answer {last_ok.strftime("%H:%M")} UTC ({where}).')
    return make_check('ai', label, 'warn', 70, f'Key is set ({where}) but not tested yet. Press "Test AI now".')


def check_mail(probe):
    label = 'Email (password reset)'
    if not MAIL_RELAY_URL:
        return make_check('mail', label, 'info', None, 'Not set up. Password reset emails are off.')
    if probe is None or (probe['code'] is None):
        reason = probe['error'] if probe else 'no response'
        return make_check('mail', label, 'fail', 0, f'The Gmail relay is unreachable ({reason}).', probe['ms'] if probe else None)
    if probe['code'] >= 500:
        return make_check('mail', label, 'fail', 20, f"The Gmail relay returned HTTP {probe['code']}.", probe['ms'])
    last_ok, last_fail = mail_state['last_ok'], mail_state['last_fail']
    if last_fail and (not last_ok or last_fail > last_ok):
        return make_check('mail', label, 'warn', 50, f"Relay is reachable, but the last email failed ({mail_state['last_error'] or 'error'}).", probe['ms'])
    return make_check('mail', label, 'ok', 100, 'The Gmail relay is reachable.', probe['ms'])


def check_business(url, probe):
    host = urlparse(url).netloc or url
    label = f'Business site ({host})'
    code = probe['code']
    if code is not None and code < 400:
        if probe['ms'] > 4000:
            return make_check('business', label, 'warn', 70, f'Online, but slow ({probe["ms"] / 1000:.1f}s). It may have just woken up.', probe['ms'])
        return make_check('business', label, 'ok', 100, f'Online (HTTP {code}).', probe['ms'])
    if code is not None and code < 500:
        return make_check('business', label, 'warn', 60, f'Responded with HTTP {code}.', probe['ms'])
    if code is not None:
        return make_check('business', label, 'fail', 0, f'The site returned HTTP {code}.', probe['ms'])
    if probe['error'] == 'timeout':
        return make_check('business', label, 'warn', 50, 'No answer in 20s. A free instance may be asleep and is waking up now.', probe['ms'])
    return make_check('business', label, 'fail', 0, f"Cannot reach the site ({probe['error']}).", probe['ms'])


def check_chat():
    try:
        conversations = Conversation.query.count()
        messages = Message.query.count()
    except Exception as error:
        db.session.rollback()
        return make_check('chat', 'Chat system', 'fail', 0, f'Chat tables are not readable ({type(error).__name__}).')
    connected = len(set(online.values()))
    return make_check('chat', 'Chat system', 'ok', 100, f'{connected} online, {conversations} conversations, {messages} messages.')


def check_quiz():
    problems = []
    for category, needed in QUIZ_PLAN.items():
        available = Question.query.filter_by(category=category, active=True).count()
        if available < needed:
            problems.append(f'{category} has {available} of {needed}')
    if problems:
        return make_check('quiz', 'Skills quiz', 'warn', 60, 'Not enough active questions: ' + ', '.join(problems) + '.')
    total = Question.query.filter_by(active=True).count()
    return make_check('quiz', 'Skills quiz', 'ok', 100, f'{total} active questions across {len(QUIZ_PLAN)} topics.')


def check_shop():
    active = Product.query.filter_by(active=True).count()
    low = Product.query.filter(Product.active.is_(True), Product.stock <= 3).count()
    pending = Order.query.filter_by(status='pending').count()
    if active == 0:
        return make_check('shop', 'Electronics shop', 'info', None, 'No products yet.')
    detail = f'{active} products, {low} low on stock, {pending} pending orders.'
    if low:
        return make_check('shop', 'Electronics shop', 'warn', 85, detail)
    return make_check('shop', 'Electronics shop', 'ok', 100, detail)


def check_accounts():
    problems = []
    admins = User.query.filter_by(is_admin=True).count()
    if admins == 0:
        problems.append('no administrator account')
    if not os.environ.get('SECRET_KEY'):
        problems.append('SECRET_KEY is not set')
    if db.engine.dialect.name == 'sqlite':
        problems.append('using SQLite (data is erased on restart)')
    if problems:
        return make_check('accounts', 'Accounts and security', 'fail' if admins == 0 else 'warn', 0 if admins == 0 else 60, 'Problem: ' + ', '.join(problems) + '.')
    return make_check('accounts', 'Accounts and security', 'ok', 100, f'{admins} admin(s), {User.query.count()} members, sessions are stable.')


@app.route(ADMIN_PATH + '/api/health')
@admin_required
@limiter.limit('40 per minute')
def admin_health():
    run_ai_test = request.args.get('ai') == '1' and bool(AI_API_KEY)
    business_urls = [normalize_url(u) for u in BUSINESS_URLS]

    with ThreadPoolExecutor(max_workers=6) as pool:
        mail_future = pool.submit(http_probe, MAIL_RELAY_URL, 10) if MAIL_RELAY_URL else None
        ai_future = pool.submit(ai_live_probe) if run_ai_test else None
        business_futures = [pool.submit(http_probe, url, 20) for url in business_urls]

        checks = [check_database(), check_storage(), check_server(), check_accounts(), check_chat(), check_quiz(), check_shop()]

        checks.append(check_ai(ai_future.result() if ai_future else None))
        checks.append(check_mail(mail_future.result() if mail_future else None))
        for url, future in zip(business_urls, business_futures):
            checks.append(check_business(url, future.result()))

    if not business_urls:
        checks.append(make_check('business', 'Business site', 'info', None, 'Not set up. Add BUSINESS_URL in Render to monitor it.'))

    scored = [c['score'] for c in checks if c['score'] is not None]
    overall = round(sum(scored) / len(scored)) if scored else 0
    all_ok = all(c['status'] in ('ok', 'info') for c in checks)
    if overall == 100 and all_ok:
        label = 'Perfect'
    elif overall >= 85:
        label = 'Healthy'
    elif overall >= 65:
        label = 'Needs attention'
    else:
        label = 'Critical'
    return jsonify({'overall': {'score': overall, 'label': label}, 'checks': checks, 'checked_at': iso(utcnow())})


def parse_price_cents(value):
    try:
        amount = Decimal(str(value).replace(',', '').strip())
    except (InvalidOperation, ValueError):
        return None
    if amount <= 0 or amount > Decimal('1000000'):
        return None
    return int((amount * 100).to_integral_value())


def product_dict(product):
    return {
        'id': product.id,
        'name': product.name,
        'category': product.category,
        'description': product.description,
        'price': product.price_cents / 100,
        'price_cents': product.price_cents,
        'stock': product.stock,
        'active': product.active,
        'image': f'/shop/image/{product.id}',
        'created_at': iso(product.created_at)
    }


def order_dict(order, admin=False):
    data = {
        'id': order.id,
        'status': order.status,
        'total': order.total_cents / 100,
        'created_at': iso(order.created_at),
        'items': [
            {'name': i.name, 'price': i.price_cents / 100, 'quantity': i.quantity}
            for i in order.items
        ]
    }
    if admin:
        owner = db.session.get(User, order.user_id) if order.user_id else None
        data.update({
            'customer_name': order.customer_name,
            'phone': order.phone,
            'address': order.address,
            'notes': order.notes,
            'account': owner.email if owner else 'Deleted account'
        })
    return data


@app.route('/shop')
@login_required
def shop():
    return render_template('shop.html', user=current_user())


@app.route('/api/shop/products')
@api_login_required
def api_shop_products():
    rows = Product.query.filter_by(active=True).order_by(Product.created_at.desc()).all()
    return jsonify({'products': [product_dict(p) for p in rows], 'categories': SHOP_CATEGORIES})


@app.route('/shop/image/<int:product_id>')
def shop_image(product_id):
    if not current_user():
        abort(401)
    product = db.session.get(Product, product_id)
    if not product:
        abort(404)
    response = Response(bytes(product.image_data), mimetype='image/' + product.image_type)
    response.headers['Cache-Control'] = 'private, max-age=86400'
    return response


@app.route('/api/shop/orders', methods=['POST'])
@api_login_required
@limiter.limit('10 per hour')
def api_shop_order_create():
    user = current_user()
    data = request.get_json(silent=True) or {}
    name = ' '.join((data.get('customer_name') or '').split())
    phone = (data.get('phone') or '').strip()
    address = ' '.join((data.get('address') or '').split())
    notes = ' '.join((data.get('notes') or '').split())[:300]
    raw_items = data.get('items')

    if len(name) < 2 or len(name) > 80:
        return jsonify({'success': False, 'message': 'Enter your full name.'}), 400
    if not re.fullmatch(r'[0-9+()\- ]{7,30}', phone):
        return jsonify({'success': False, 'message': 'Enter a valid phone number.'}), 400
    if len(address) < 5 or len(address) > 300:
        return jsonify({'success': False, 'message': 'Enter your complete delivery address.'}), 400
    if not isinstance(raw_items, list) or not raw_items or len(raw_items) > 30:
        return jsonify({'success': False, 'message': 'Your cart is empty.'}), 400

    quantities = {}
    for item in raw_items:
        if not isinstance(item, dict):
            return jsonify({'success': False, 'message': 'Invalid cart.'}), 400
        product_id = to_int(item.get('id'))
        quantity = to_int(item.get('qty'))
        if product_id is None or quantity is None or quantity < 1 or quantity > 99:
            return jsonify({'success': False, 'message': 'Invalid cart.'}), 400
        quantities[product_id] = quantities.get(product_id, 0) + quantity

    products = Product.query.filter(Product.id.in_(list(quantities)), Product.active.is_(True)).all()
    if len(products) != len(quantities):
        return jsonify({'success': False, 'message': 'One of the items is no longer available.'}), 400

    total = 0
    for product in products:
        quantity = quantities[product.id]
        if quantity > product.stock:
            return jsonify({'success': False, 'message': f'Not enough stock for {product.name}. Only {product.stock} left.'}), 409
        total += product.price_cents * quantity

    order = Order(user_id=user.id, customer_name=name, phone=phone, address=address, notes=notes, total_cents=total)
    for product in products:
        quantity = quantities[product.id]
        updated = (Product.query.filter(Product.id == product.id, Product.stock >= quantity)
                   .update({Product.stock: Product.stock - quantity}, synchronize_session=False))
        if updated != 1:
            db.session.rollback()
            return jsonify({'success': False, 'message': 'Stock changed while you were ordering. Please review your cart.'}), 409
        order.items.append(OrderItem(product_id=product.id, name=product.name, price_cents=product.price_cents, quantity=quantity))
    db.session.add(order)
    db.session.commit()
    return jsonify({'success': True, 'order': order_dict(order)})


@app.route('/api/shop/orders')
@api_login_required
def api_shop_my_orders():
    user = current_user()
    rows = (Order.query.options(joinedload(Order.items)).filter_by(user_id=user.id)
            .order_by(Order.created_at.desc()).limit(50).all())
    return jsonify({'orders': [order_dict(o) for o in rows]})


@app.route(ADMIN_PATH + '/shop')
@admin_required
def admin_shop_page():
    return render_template('admin-shop.html', base=ADMIN_PATH, user=current_user(), categories=SHOP_CATEGORIES)


@app.route(ADMIN_PATH + '/api/products')
@admin_required
def admin_products_list():
    rows = Product.query.order_by(Product.created_at.desc()).all()
    return jsonify({'products': [product_dict(p) for p in rows], 'categories': SHOP_CATEGORIES})


@app.route(ADMIN_PATH + '/api/products', methods=['POST'])
@admin_required
def admin_products_add():
    name = ' '.join((request.form.get('name') or '').split())
    category = request.form.get('category') or ''
    description = (request.form.get('description') or '').strip()[:1000]
    price_cents = parse_price_cents(request.form.get('price'))
    stock = to_int(request.form.get('stock'))
    image = request.files.get('image')

    if len(name) < 2 or len(name) > 120:
        return jsonify({'success': False, 'message': 'The product name must be 2 to 120 characters.'}), 400
    if category not in SHOP_CATEGORIES:
        return jsonify({'success': False, 'message': 'Choose a valid category.'}), 400
    if price_cents is None:
        return jsonify({'success': False, 'message': 'Enter a valid price.'}), 400
    if stock is None or stock < 0 or stock > 100000:
        return jsonify({'success': False, 'message': 'Enter a valid stock quantity.'}), 400
    if not image:
        return jsonify({'success': False, 'message': 'Choose a product picture.'}), 400

    raw = image.read(MAX_PRODUCT_IMAGE_BYTES + 1)
    if len(raw) > MAX_PRODUCT_IMAGE_BYTES:
        return jsonify({'success': False, 'message': 'The picture is too large (3 MB maximum).'}), 400
    kind = detect_image_type(raw)
    if not kind:
        return jsonify({'success': False, 'message': 'The picture must be a PNG, JPEG, or WebP image.'}), 400

    product = Product(
        name=name, category=category, description=description, price_cents=price_cents, stock=stock,
        image_type=kind, image_size=len(raw), image_data=raw
    )
    db.session.add(product)
    try:
        db.session.commit()
    except SQLAlchemyError as error:
        db.session.rollback()
        print(f'[MDW] Product upload failed: {type(error).__name__}: {error}', flush=True)
        return jsonify({'success': False, 'message': 'The database could not store this product.'}), 500
    return jsonify({'success': True, 'product': product_dict(product)})


@app.route(ADMIN_PATH + '/api/products/<int:product_id>', methods=['POST'])
@admin_required
def admin_products_update(product_id):
    product = db.session.get(Product, product_id)
    if not product:
        return jsonify({'success': False, 'message': 'Product not found.'}), 404
    data = request.get_json(silent=True) or {}

    if 'name' in data:
        name = ' '.join(str(data['name']).split())
        if len(name) < 2 or len(name) > 120:
            return jsonify({'success': False, 'message': 'The product name must be 2 to 120 characters.'}), 400
        product.name = name
    if 'category' in data:
        if data['category'] not in SHOP_CATEGORIES:
            return jsonify({'success': False, 'message': 'Choose a valid category.'}), 400
        product.category = data['category']
    if 'description' in data:
        product.description = str(data['description']).strip()[:1000]
    if 'price' in data:
        cents = parse_price_cents(data['price'])
        if cents is None:
            return jsonify({'success': False, 'message': 'Enter a valid price.'}), 400
        product.price_cents = cents
    if 'stock' in data:
        stock = to_int(data['stock'])
        if stock is None or stock < 0 or stock > 100000:
            return jsonify({'success': False, 'message': 'Enter a valid stock quantity.'}), 400
        product.stock = stock
    if 'active' in data:
        product.active = bool(data['active'])
    db.session.commit()
    return jsonify({'success': True, 'product': product_dict(product)})


@app.route(ADMIN_PATH + '/api/products/<int:product_id>', methods=['DELETE'])
@admin_required
def admin_products_delete(product_id):
    product = db.session.get(Product, product_id)
    if not product:
        return jsonify({'success': False, 'message': 'Product not found.'}), 404
    db.session.delete(product)
    db.session.commit()
    return jsonify({'success': True})


@app.route(ADMIN_PATH + '/api/orders')
@admin_required
def admin_orders_list():
    rows = (Order.query.options(joinedload(Order.items))
            .order_by(Order.created_at.desc()).limit(200).all())
    return jsonify({'orders': [order_dict(o, True) for o in rows], 'statuses': ORDER_STATUSES})


@app.route(ADMIN_PATH + '/api/orders/<int:order_id>/status', methods=['POST'])
@admin_required
def admin_order_status(order_id):
    order = db.session.get(Order, order_id)
    if not order:
        return jsonify({'success': False, 'message': 'Order not found.'}), 404
    data = request.get_json(silent=True) or {}
    status = data.get('status')
    if status not in ORDER_STATUSES:
        return jsonify({'success': False, 'message': 'Choose a valid status.'}), 400
    if order.status == 'cancelled':
        return jsonify({'success': False, 'message': 'A cancelled order cannot be changed.'}), 400
    if status == 'cancelled':
        for item in order.items:
            if item.product_id:
                Product.query.filter_by(id=item.product_id).update(
                    {Product.stock: Product.stock + item.quantity}, synchronize_session=False)
    order.status = status
    db.session.commit()
    return jsonify({'success': True})


def secure_tables():
    if db.engine.dialect.name != 'postgresql':
        return
    try:
        for table in db.metadata.tables:
            db.session.execute(text(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY'))
        db.session.commit()
    except Exception as error:
        db.session.rollback()
        print(f'[MDW] WARNING: could not enable row level security: {error}', flush=True)


def print_startup_report():
    target = make_url(DATABASE_URI)
    if target.host and target.host.startswith('db.') and target.host.endswith('.supabase.co'):
        print('[MDW] WARNING: this is the Supabase direct connection, which is IPv6 only and fails on Render. Use the Session pooler connection string.', flush=True)
    print(f"[MDW] Database: {target.drivername} | host={target.host or 'local file'} | name={target.database}", flush=True)
    if target.get_backend_name() == 'sqlite':
        print('[MDW] WARNING: SQLite is erased on every Render restart. Set DATABASE_URL to your Supabase database.', flush=True)
    admin_email = os.environ.get('ADMIN_EMAIL', '').strip().lower()
    print(f"[MDW] Admin email configured: {bool(admin_email)} | admins in database: {User.query.filter_by(is_admin=True).count()}", flush=True)
    print(f"[MDW] Admin panel path: {ADMIN_PATH}", flush=True)
    print(f"[MDW] Password reset email relay configured: {bool(MAIL_RELAY_URL)}", flush=True)
    print(f"[MDW] AI: provider={AI_PROVIDER_NAME} | model={AI_MODEL} | key set={bool(AI_API_KEY)} | key starts with={AI_API_KEY[:4]} | key length={len(AI_API_KEY)}", flush=True)
    if not os.environ.get('SECRET_KEY'):
        print('[MDW] WARNING: SECRET_KEY is not set. Everyone is logged out on every restart.', flush=True)


with app.app_context():
    db.create_all()
    ensure_columns()
    ensure_global_conversation()
    secure_tables()
    seed_questions()
    ensure_admin()
    print_startup_report()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)

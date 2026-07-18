import os
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO, emit
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import uuid

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'change-this-to-a-random-secret-key')
socketio = SocketIO(app, async_mode='threading')

users = {}
chat_history = []
online_users = {}

MAX_HISTORY = 100


@app.route('/')
def index():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('index.html')


@app.route('/login')
def login():
    return render_template('login.html')


@app.route('/signup')
def signup():
    return render_template('signup.html')


@app.route('/dashboard')
def dashboard():
    return render_template('dashboard.html')


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
def chat():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('chat.html', username=session.get('full_name'))


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))


@app.route('/api/register', methods=['POST'])
def api_register():
    data = request.get_json(silent=True) or {}
    full_name = (data.get('full_name') or '').strip()
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    if not full_name or not email or not password:
        return jsonify({'success': False, 'message': 'All fields are required.'}), 400

    if len(password) < 8:
        return jsonify({'success': False, 'message': 'Password must be at least 8 characters.'}), 400

    if email in users:
        return jsonify({'success': False, 'message': 'An account with this email already exists.'}), 409

    users[email] = {
        'id': str(uuid.uuid4()),
        'full_name': full_name,
        'email': email,
        'password_hash': generate_password_hash(password)
    }

    return jsonify({'success': True, 'message': 'Account created successfully.'})


@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    user = users.get(email)

    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'success': False, 'message': 'Invalid email or password.'}), 401

    session['user_id'] = user['id']
    session['email'] = user['email']
    session['full_name'] = user['full_name']

    return jsonify({'success': True, 'message': 'Logged in successfully.'})


@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'success': True})


@app.route('/api/session')
def api_session():
    if 'user_id' in session:
        return jsonify({
            'authenticated': True,
            'full_name': session.get('full_name'),
            'email': session.get('email')
        })
    return jsonify({'authenticated': False})


@socketio.on('connect')
def handle_connect():
    if 'user_id' not in session:
        return False

    online_users[request.sid] = session.get('full_name')
    emit('chat_history', chat_history)
    emit('online_users', list(online_users.values()), broadcast=True)
    emit('user_joined', session.get('full_name'), broadcast=True, include_self=False)


@socketio.on('disconnect')
def handle_disconnect():
    username = online_users.pop(request.sid, None)
    if username:
        emit('online_users', list(online_users.values()), broadcast=True)
        emit('user_left', username, broadcast=True)


@socketio.on('chat_message')
def handle_chat_message(data):
    if 'user_id' not in session:
        return

    text = (data.get('text') or '').strip()
    if not text:
        return

    message = {
        'sender': session.get('full_name'),
        'text': text[:500],
        'timestamp': datetime.utcnow().isoformat()
    }

    chat_history.append(message)
    if len(chat_history) > MAX_HISTORY:
        chat_history.pop(0)

    emit('chat_message', message, broadcast=True)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port)

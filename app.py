import os
import re
import requests
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO, emit
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.security import generate_password_hash, check_password_hash
import uuid

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "change-this-to-a-random-secret-key")

app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("FLASK_ENV") == "production"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=12)

socketio = SocketIO(app, async_mode="threading")

limiter = Limiter(get_remote_address, app=app, default_limits=[])

users = {}
chat_history = []
online_users = {}
failed_login_attempts = {}

MAX_HISTORY = 100
LOCKOUT_THRESHOLD = 5
LOCKOUT_DURATION_SECONDS = 300

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def is_strong_password(password):
    if len(password) < 8:
        return False
    if not re.search(r"[A-Za-z]", password):
        return False
    if not re.search(r"[0-9]", password):
        return False
    return True


def is_account_locked(email):
    record = failed_login_attempts.get(email)
    if not record:
        return False
    attempts, locked_until = record
    if locked_until and datetime.utcnow() < locked_until:
        return True
    if locked_until and datetime.utcnow() >= locked_until:
        failed_login_attempts.pop(email, None)
    return False


def register_failed_attempt(email):
    attempts, locked_until = failed_login_attempts.get(email, (0, None))
    attempts += 1
    if attempts >= LOCKOUT_THRESHOLD:
        locked_until = datetime.utcnow() + timedelta(seconds=LOCKOUT_DURATION_SECONDS)
    failed_login_attempts[email] = (attempts, locked_until)


def clear_failed_attempts(email):
    failed_login_attempts.pop(email, None)


@app.after_request
def set_secure_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


AI_PROVIDERS = {
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "model": "qwen/qwen3-coder:free",
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4-turbo-preview",
    },
}

AI_PROVIDER = os.environ.get("AI_PROVIDER", "openrouter")
AI_API_KEY = os.environ.get("AI_API_KEY", "")

AI_SYSTEM_PROMPT = (
    "You are the MDW IT Assistant, a helpful support assistant for Manantan Digital Works. "
    "You only answer questions about networking (Cisco, IP addressing, topologies, switches, routers), "
    "programming and web development (Python, Flask, JavaScript, HTML, CSS, databases, general "
    "software engineering), and general IT support topics. "
    "If a user asks about anything outside of networking, programming, or IT support, politely decline "
    "and explain that you can only help with those topics. "
    "Never provide instructions for hacking, malware, exploits, or any illegal or harmful activity, even "
    "if the user claims it is for educational or authorized purposes. "
    "Keep answers clear, concise, and beginner-friendly when possible."
)


@app.route("/")
def index():
    if "user_id" not in session:
        return redirect(url_for("login"))
    return render_template("index.html")


@app.route("/login")
def login():
    return render_template("login.html")


@app.route("/signup")
def signup():
    return render_template("signup.html")


@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html")


@app.route("/portfolio")
def portfolio():
    return render_template("portfolio.html")


@app.route("/packet-tracer")
def packet_tracer():
    return render_template("packet-tracer.html")


@app.route("/networking")
def networking_home():
    return render_template("networking-home.html")


@app.route("/networking/about")
def networking_about():
    return render_template("networking-about.html")


@app.route("/networking/topology")
def networking_topology():
    return render_template("networking-topology.html")


@app.route("/networking/devices")
def networking_devices():
    return render_template("networking-devices.html")


@app.route("/networking/ip-addressing")
def networking_ip_addressing():
    return render_template("networking-ip-addressing.html")


@app.route("/networking/switch-config")
def networking_switch_config():
    return render_template("networking-switch-config.html")


@app.route("/networking/simulation")
def networking_simulation():
    return render_template("networking-simulation.html")


@app.route("/networking/gallery")
def networking_gallery():
    return render_template("networking-gallery.html")


@app.route("/networking/download")
def networking_download():
    return render_template("networking-download.html")


@app.route("/networking/contact")
def networking_contact():
    return render_template("networking-contact.html")


@app.route("/chat")
def chat():
    if "user_id" not in session:
        return redirect(url_for("login"))
    return render_template("chat.html", username=session.get("full_name"))


@app.route("/assistant")
def ai_assistant():
    if "user_id" not in session:
        return redirect(url_for("login"))
    return render_template("ai-assistant.html")


@app.route("/api/assistant", methods=["POST"])
def api_assistant():
    if "user_id" not in session:
        return jsonify({"success": False, "message": "Please log in first."}), 401

    if not AI_API_KEY:
        return jsonify(
            {"success": False, "message": "AI assistant is not configured yet."}
        ), 503

    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()

    if not message:
        return jsonify({"success": False, "message": "Message cannot be empty."}), 400

    provider = AI_PROVIDERS.get(AI_PROVIDER, AI_PROVIDERS["openrouter"])

    try:
        response = requests.post(
            f"{provider['base_url']}/chat/completions",
            headers={
                "Authorization": f"Bearer {AI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": provider["model"],
                "messages": [
                    {"role": "system", "content": AI_SYSTEM_PROMPT},
                    {"role": "user", "content": message[:1000]},
                ],
                "max_tokens": 600,
                "temperature": 0.5,
            },
            timeout=30,
        )
        response.raise_for_status()
        reply = response.json()["choices"][0]["message"]["content"]
        return jsonify({"success": True, "reply": reply})
    except requests.exceptions.RequestException:
        return jsonify(
            {
                "success": False,
                "message": "The assistant is temporarily unavailable. Please try again.",
            }
        ), 502


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))


@app.route("/api/register", methods=["POST"])
@limiter.limit("10 per hour")
def api_register():
    data = request.get_json(silent=True) or {}
    full_name = (data.get("full_name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not full_name or not email or not password:
        return jsonify({"success": False, "message": "All fields are required."}), 400

    if not EMAIL_REGEX.match(email):
        return jsonify(
            {"success": False, "message": "Please enter a valid email address."}
        ), 400

    if not is_strong_password(password):
        return jsonify(
            {
                "success": False,
                "message": "Password must be at least 8 characters and include a letter and a number.",
            }
        ), 400

    if email in users:
        return jsonify(
            {"success": False, "message": "An account with this email already exists."}
        ), 409

    users[email] = {
        "id": str(uuid.uuid4()),
        "full_name": full_name,
        "email": email,
        "password_hash": generate_password_hash(password),
    }

    return jsonify({"success": True, "message": "Account created successfully."})


@app.route("/api/login", methods=["POST"])
@limiter.limit("8 per minute")
def api_login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if is_account_locked(email):
        return jsonify(
            {
                "success": False,
                "message": "Too many failed attempts. Please try again in a few minutes.",
            }
        ), 429

    user = users.get(email)

    if not user or not check_password_hash(user["password_hash"], password):
        register_failed_attempt(email)
        return jsonify({"success": False, "message": "Invalid email or password."}), 401

    clear_failed_attempts(email)
    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]
    session["email"] = user["email"]
    session["full_name"] = user["full_name"]

    return jsonify({"success": True, "message": "Logged in successfully."})


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"success": True})


@app.route("/api/session")
def api_session():
    if "user_id" in session:
        return jsonify(
            {
                "authenticated": True,
                "full_name": session.get("full_name"),
                "email": session.get("email"),
            }
        )
    return jsonify({"authenticated": False})


@socketio.on("connect")
def handle_connect():
    if "user_id" not in session:
        return False

    online_users[request.sid] = session.get("full_name")
    emit("chat_history", chat_history)
    emit("online_users", list(online_users.values()), broadcast=True)
    emit("user_joined", session.get("full_name"), broadcast=True, include_self=False)


@socketio.on("disconnect")
def handle_disconnect():
    username = online_users.pop(request.sid, None)
    if username:
        emit("online_users", list(online_users.values()), broadcast=True)
        emit("user_left", username, broadcast=True)


@socketio.on("chat_message")
def handle_chat_message(data):
    if "user_id" not in session:
        return

    text = (data.get("text") or "").strip()
    if not text:
        return

    message = {
        "sender": session.get("full_name"),
        "text": text[:500],
        "timestamp": datetime.utcnow().isoformat(),
    }

    chat_history.append(message)
    if len(chat_history) > MAX_HISTORY:
        chat_history.pop(0)

    emit("chat_message", message, broadcast=True)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port, allow_unsafe_werkzeug=True)

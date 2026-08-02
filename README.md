# Manantan Digital Works

Official website of **Manantan Digital Works (MDW)** — a student-led web development
and IT services group. Built with Flask, featuring a public marketing site, a
real-time team chat, an AI IT assistant, an admin dashboard, a project
portfolio, and a Cisco Packet Tracer networking showcase.

**Live site:** [web-development.onrender.com](https://web-development-olh6.onrender.com/login)

---

## Features

- **Authentication** — email/password signup and login with hashed passwords
  (Werkzeug) and server-side sessions
- **Gated main site** — visitors are redirected to `/login` until they sign in
- **Real-time group chat** — powered by Flask-SocketIO, with online user list
  and message history
- **AI IT Assistant** — a chat assistant scoped to networking, programming,
  and IT support topics, powered by an external AI provider (OpenRouter)
- **Admin dashboard** — metrics overview, project status, and team member
  directory
- **Portfolio page** — links to each team member's GitHub and live projects
- **Cisco Packet Tracer showcase** — network topology, device breakdown, IP
  addressing plan, switch configuration commands, and a project gallery
- **Responsive design** — mobile-friendly navigation across every page
- **Security hardening** — rate limiting, account lockout after repeated
  failed logins, secure session cookies, and security response headers

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python, Flask, Flask-SocketIO (`threading` async mode), Flask-Limiter |
| Frontend | HTML, CSS, vanilla JavaScript |
| Networking pages | Bootstrap 5, Bootstrap Icons |
| Real-time | Socket.IO |
| AI Assistant | OpenRouter API (configurable provider/model) |
| Hosting | Render |

---

## Project Structure

```
web-development/
├── app.py                     # Flask app, routes, API, Socket.IO events
├── requirements.txt
├── templates/
│   ├── index.html             # Main site (gated behind login)
│   ├── login.html
│   ├── signup.html
│   ├── dashboard.html         # Admin panel
│   ├── chat.html              # Real-time group chat
│   ├── ai-assistant.html      # AI IT assistant chat
│   ├── portfolio.html         # Team project links
│   ├── packet-tracer.html     # Team diagram gallery
│   └── networking-*.html      # Cisco Packet Tracer showcase (10 pages)
└── static/
    ├── css/
    ├── js/
    └── images/
```

---

## Getting Started

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Run the app
```bash
python app.py
```
The site runs at `http://localhost:5000` by default (or the port set in the
`PORT` environment variable).

### 3. Environment variables
| Variable | Purpose | Default |
|---|---|---|
| `SECRET_KEY` | Flask session signing key | fallback dev key (change in production) |
| `PORT` | Port to bind to | `5000` |
| `FLASK_ENV` | Set to `production` to enable secure cookies | unset |
| `AI_API_KEY` | API key for the AI Assistant provider | none (assistant disabled without it) |
| `AI_PROVIDER` | Which provider config to use (`openrouter` or `openai`) | `openrouter` |

---

## Routes

### Pages
| Route | Description |
|---|---|
| `/` | Main site (requires login) |
| `/login` | Sign in |
| `/signup` | Create an account |
| `/dashboard` | Admin panel |
| `/chat` | Real-time group chat (requires login) |
| `/assistant` | AI IT assistant (requires login) |
| `/portfolio` | Team project links |
| `/packet-tracer` | Team network diagram gallery |
| `/networking` | Cisco Packet Tracer project home |
| `/networking/about`, `/topology`, `/devices`, `/ip-addressing`, `/switch-config`, `/simulation`, `/gallery`, `/download`, `/contact` | Networking sub-pages |
| `/logout` | Clears session |

### API
| Method | Route | Purpose |
|---|---|---|
| POST | `/api/register` | Create an account |
| POST | `/api/login` | Authenticate (rate-limited, account lockout after repeated failures) |
| POST | `/api/logout` | End session |
| GET | `/api/session` | Check auth status |
| POST | `/api/assistant` | Send a message to the AI IT assistant |

### Socket.IO Events
| Event | Direction | Purpose |
|---|---|---|
| `connect` / `disconnect` | — | Track online users |
| `chat_message` | client → server → broadcast | Send/receive chat messages |
| `chat_history` | server → client | Load past messages on join |
| `online_users` | server → client | Update the online users list |
| `user_joined` / `user_left` | server → client | System notifications |

---

## Security

- Passwords are hashed with Werkzeug's `generate_password_hash` — never
  stored in plain text
- Login attempts are rate-limited (8 per minute per IP), with accounts
  temporarily locked after 5 consecutive failed attempts
- Registration is rate-limited (10 per hour per IP)
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production
- Sessions expire automatically after 12 hours
- Security response headers (`X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`) are set on every response

---

## Team

**Manantan Digital Works**

| Name | Role |
|---|---|
| Kyle Kristan M. Manantan | Founder & Web Development |
| James Pascual | IT Support |
| Mark EJ Delos Angeles | Hardware and Networking |
| Jessie Kris Dagdag | Hardware |
| John Paul O. Nuñez | Front-End Development |
| Justin P. Imbag | App Development |
| Louie Nhelson Puno | Basic Programming (C#) & Networking |
| John Kirby Aguilar | Back-End & Ethical Hacking |

---

## Deployment

Deployed on [Render](https://render.com). Render reads the `PORT`
environment variable it assigns and the app binds to `0.0.0.0`. Push changes
to the connected GitHub repository to trigger an automatic redeploy.

> Note: the current user store is in-memory, so registered accounts reset
> whenever the app restarts (e.g. after a redeploy or after the free-tier
> service spins back up from idle). A persistent database is planned for a
> future update.

---

## License

This project is for educational and portfolio purposes.

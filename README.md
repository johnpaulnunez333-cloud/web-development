# Manantan Digital Works

A full-stack web platform for **Manantan Digital Works**: a team site with member accounts, a portfolio, a browser-based network simulator (Packet Tracer labs), an electronics shop, a books library, chat, an AI IT assistant, a skills quiz, and a full admin panel.

**Live site:** https://web-development-olh6.onrender.com

## Features

| Area | What it does |
|------|--------------|
| Home | Team and leader section, services, contact cards |
| Accounts | Sign up, login, avatars, settings, password reset by email |
| Dashboard | Member dashboard, announcements, notification bell |
| Portfolio | Public project gallery, managed from the admin panel (images, links, categories) |
| Packet Tracer | Downloadable `.pkt` labs plus a built-in simulator that runs in the browser |
| Networking pages | Topology, devices, IP addressing, switch configuration, simulation, gallery, download, contact |
| Electronics Shop | Product catalog and orders |
| Manantan Books | Book library with admin upload |
| Conversation | Real-time chat (Flask-SocketIO) |
| AI Assistant | IT / networking / security helper, works with Gemini or DeepSeek |
| Skills Quiz | Quiz with retake cooldown |
| Admin panel | Users, portfolio, Packet Tracer labs, shop, books, announcements (path set by `ADMIN_PATH`) |

### Network simulator

Pure JavaScript (`static/js/pt-engine.js` and `pt-sim.js`), no plugin needed.

- Devices: PC, router, switch
- Layer 2 reachability through switches, connected and static routes, TTL
- `ping` and `tracert`
- IOS-style command line with shortened commands (for example `en`, `conf t`, `int g0/0`, `ip add`, `no sh`)
- Router interfaces start **shutdown**; use `no shutdown` to bring them up
- Sample labs: LAN, routed LANs, static routes

## Tech stack

- Python 3, Flask 3, Flask-SQLAlchemy, Flask-SocketIO, Flask-Limiter
- PostgreSQL (Neon or Supabase) or MySQL
- gunicorn (`gthread` worker) with `simple-websocket`
- Plain HTML, CSS and JavaScript (no front-end build step)
- Hosted on Render, deployed automatically from the `main` branch

## Project structure

```
app.py               Flask app: models, routes, admin, AI, background tasks
avatars.py           Avatar helpers
quiz_data.py         Quiz questions
supabase_setup.sql   Optional database setup
Procfile             gunicorn start command
requirements.txt     Python dependencies
templates/           Jinja templates (public, admin, networking pages)
static/css/          Stylesheets
static/js/           Front-end scripts, including the simulator
```

## Run locally

```bash
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

export SECRET_KEY="change-me"
export ADMIN_EMAIL="you@example.com"
export ADMIN_PASSWORD="a-strong-password"
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"

python app.py
```

Then open http://127.0.0.1:5000.

## Environment variables

Set these in Render under **Environment** (or in your shell locally). **Never commit real values.**

**Required**

| Variable | Purpose |
|----------|---------|
| `SECRET_KEY` | Flask session secret |
| `DATABASE_URL` | Main database connection string |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Admin account |
| `ADMIN_PATH` | URL path of the admin panel (for example `/admin`) |

**AI Assistant**

| Variable | Purpose |
|----------|---------|
| `AI_PROVIDER` | `gemini`, `deepseek`, `openrouter` or `openai`. Use only the provider name. |
| `GEMINI_API_KEY` or `DEEPSEEK_API_KEY` | API key for the chosen provider |
| `AI_MODEL` | Optional model override. Remove it if the model name does not belong to the chosen provider. |
| `AI_BASE_URL` | Optional endpoint override |
| `AI_FALLBACK_MODELS` | Optional comma-separated backup models, tried when the main one is busy |
| `AI_REASONING_EFFORT` | Gemini only, default `low` (faster replies) |

**Optional**

`FILES_DATABASE_URL` (separate database for uploaded files), `MAIL_RELAY_URL` and `MAIL_RELAY_SECRET` (password reset email), `BUSINESS_URL`, `QUIZ_RETAKE_HOURS`, `DB_LIMIT_MB`, `FILES_DB_LIMIT_MB`, `MEMORY_LIMIT_MB`.

## Deploy on Render

1. Push the code to GitHub (`main` branch).
2. In Render, create a **Web Service** from the repository.
3. Build command: `pip install -r requirements.txt`
4. Start command: taken from the `Procfile`.
5. Add the environment variables above.
6. Every push to `main` redeploys automatically. Wait for **Your service is live**.

## Troubleshooting

**AI Assistant shows an error**
- Open Render **Logs** and look for `[AI Assistant Error]`.
- `HTTP 503` or `high demand`: the provider is busy. The app retries automatically; add `AI_FALLBACK_MODELS` or try again in a minute.
- `ReadTimeout`: the model took too long. Lower `AI_REASONING_EFFORT` or use a faster model.
- `HTTP 404`: the model name is wrong or retired. Check the model list for your key.
- `HTTP 401` or `403`: the API key is invalid or not allowed for that model.

**Router panel shows a PC IP form** (simulator)
- Make sure `static/css/sim.css` contains `[hidden]{display:none!important}`.

**Git push asks for a password**
- GitHub does not accept account passwords. Use a Personal Access Token (classic, `repo` scope) as the password, and delete it when you are done.

## Security notes

- Keep API keys and tokens only in Render environment variables.
- If a key or token appears in a screenshot or chat, delete it and create a new one.
- Rate limiting is enabled on sensitive routes through Flask-Limiter.

## Team

- **Kyle Kristan M. Manantan**: Founder and Team Leader
- **John Paul Nuñez**: Developer
- Justin and Kirby: Members

## License

All rights reserved by Manantan Digital Works unless stated otherwise.

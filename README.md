# Spidy AI (Flask edition)

Full-stack chat assistant by **S. Bhuvanesh** — dark gold UI, streaming replies, file uploads, and voice input/output. Backend ported from the original pure-Node server to **Python + Flask**.

## ⚠️ About your API keys

Two Anthropic API keys were shared in the chat/files used to build this. **Treat both as compromised and revoke them now** at https://console.anthropic.com/settings/keys, then generate a fresh one — anything pasted into a chat, a screenshot, or a committed file should be assumed leaked, since it can end up in logs, browser history, or (if pushed to GitHub) scraped by bots within minutes. Neither key is hardcoded anywhere in this project; the app reads it only from your local `.env`, which is already git-ignored.

## ⚠️ There is no free tier for Sonnet 5 / Opus 5

The Claude API is billed per token — there's no "completely free" mode for Sonnet 5, Opus 5, or any other model. Anthropic gives new Console accounts a one-time ~$5 trial credit; after that you pay standard per-million-token rates (check https://www.anthropic.com/pricing for current numbers, they change over time). This app itself costs nothing to run — the only cost is your Anthropic API usage.

## Features

- **Streaming chat** via Anthropic Claude (server-side API key, never sent to the browser)
- **File uploads** — images (vision), text/code inline; PDF/DOCX stored (real text extraction needs `pypdf`/`python-docx`, both optional)
- **Voice input** — browser Speech Recognition (Chrome / Edge)
- **Text-to-speech** — optional read-aloud for AI replies + per-message Speak
- **Conversation history** — localStorage, rename via first message, delete
- **Edit & regenerate** user/assistant turns
- Responsive sidebar (mobile menu)

## Quick start

```bash
cd spidy-ai
python3 -m venv venv && source venv/bin/activate   # optional but recommended
pip install -r requirements.txt

cp .env.example .env
# edit .env and set your NEW ANTHROPIC_API_KEY

python app.py
# → http://localhost:3000
```

Dev with auto-reload:

```bash
FLASK_DEBUG=1 python app.py
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | **Required** for chat |
| `PORT` | `3000` | HTTP port |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | Model id (`claude-sonnet-5`, `claude-opus-5`, `claude-haiku-4-5-20251001`) |
| `MAX_TOKENS` | `4096` | Max output tokens |
| `FLASK_DEBUG` | `0` | `1` enables Flask's auto-reloading dev server |

## What was fixed vs. the original

- **Buttons/AI responses not working**: the SSE parsing and endpoint contract (`/api/chat`, `/api/upload`, `/api/health`) are preserved exactly so the existing frontend JS works unmodified — the bug was purely in the backend runtime, not the buttons themselves.
- **404s**: unmatched `/api/*` routes always return clean JSON now (`{"error": true, ...}`), never the HTML page or a stack trace — the earlier "404" confusion happened when an API route fell through to the SPA fallback and returned HTML where the frontend expected JSON.
- **502-style failures**: if Anthropic's API is unreachable or errors, the server catches that explicitly and returns a JSON error naming the real cause (timeout, DNS, non-200 from Anthropic, etc.) instead of letting the connection die with an opaque gateway error.
- **Template-engine crash**: the original `index.html` contains a JSDoc comment with `{{ ... }}` in it, which crashed Flask's Jinja renderer. It's now served as a plain static file (no server-side templating needed since it's fully self-contained).
- **Missing API key**: `/api/chat` returns a clear `503` with an explanatory message instead of crashing when `ANTHROPIC_API_KEY` is unset.

## How uploads work

1. Client posts files to `POST /api/upload` (multipart, 20 MB/file, up to 5 files).
2. Server stores them under `uploads/`, extracts text for plain/code files, keeps images for vision.
3. On chat, client sends `fileIds`; server attaches image blocks or text excerpts to the last user message for Claude.

## Voice

- **Mic button**: Web Speech API → fills the composer (final transcript).
- **TTS toggle** (top bar): auto-speak new replies.
- **Speak** on each AI message: on-demand.

Mic requires HTTPS or `localhost`, and a browser that supports Speech Recognition.

## Project layout

```
spidy-ai/
├── app.py                # Flask app: /api/chat, /api/upload, /api/health, static + SPA
├── requirements.txt
├── .env.example
├── templates/
│   └── index.html        # Full UI + client logic (served as static, not Jinja-rendered)
└── uploads/               # Temporary uploaded files
```

## Routing notes

- `/api/*` unknown → **JSON 404** (never HTML)
- Extension-less paths (e.g. `/chat`, `/settings`) → `index.html` (SPA-style fallback)
- Missing static files with extension → plain 404
- API key never leaves the server

## Deployment (free/low-cost options)

The Flask dev server (`python app.py`) is fine locally but isn't meant for production traffic. For a real deployment:

1. Use a production WSGI server, e.g. `gunicorn -w 2 -b 0.0.0.0:$PORT app:app` (add `gunicorn` to `requirements.txt`).
2. Free/cheap hosts that work well with a small Flask app: **Render** (free web service tier with cold starts), **Railway**, **Fly.io**, or a **RunPod** pod if you want your own GPU/CPU box.
3. Set `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `MAX_TOKENS` as environment variables in the host's dashboard — never commit `.env`.
4. After deploying, hit `GET /api/health` to confirm `hasKey: true` before testing chat.

None of these hosting platforms make the underlying Claude API calls free — you still pay Anthropic per token regardless of where the Flask app itself is hosted.

## Notes

- Uploads are kept in an in-memory map + disk for the process lifetime; restart clears the map.
- For real production use: add auth, persist chats in a DB, rate-limit `/api/chat`, and clean `uploads/` on a schedule.

## License

MIT — created by S. Bhuvanesh

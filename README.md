# Spidy AI

Full-stack chat assistant by **S. Bhuvanesh** — dark gold UI, streaming replies, file uploads, and voice input/output.

Inspired by the polish of Claude, Grok, and Cursor.

## Features

- **Streaming chat** via Anthropic Claude (server-side API key)
- **File uploads** — images (vision), PDF, DOCX, text/code (`.txt`, `.md`, `.js`, `.py`, …)
- **Voice input** — browser Speech Recognition (Chrome / Edge)
- **Text-to-speech** — optional read-aloud for AI replies + per-message Speak
- **Conversation history** — localStorage, rename via first message, delete
- **Edit & regenerate** user/assistant turns
- **Copy** markdown answers
- Responsive sidebar (mobile menu)

## Quick start

### 1. Install

```bash
cd spidy-ai
npm install
```

### 2. API key

```bash
cp .env.example .env
# Edit .env and set:
# ANTHROPIC_API_KEY=sk-ant-api03-...
```

Get a key at [console.anthropic.com](https://console.anthropic.com/).

### 3. Run

```bash
npm start
# → http://localhost:3000
```

Dev with auto-reload (Node 18+):

```bash
npm run dev
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | **Required** |
| `PORT` | `3000` | HTTP port |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Model id |
| `MAX_TOKENS` | `4096` | Max output tokens |

## How uploads work

1. Client posts files to `POST /api/upload` (multer, 20 MB, up to 5 files).
2. Server stores them under `uploads/`, extracts text (PDF / DOCX / plain) or keeps images for vision.
3. On chat, client sends `fileIds`; server attaches image blocks or text excerpts to the last user message for Claude.

## Voice

- **Mic button**: Web Speech API → fills the composer (final transcript).
- **TTS toggle** (top bar): auto-speak new replies.
- **Speak** on each AI message: on-demand.

Mic requires HTTPS or `localhost`, and a browser that supports Speech Recognition.

## Project layout

```
spidy-ai/
├── package.json
├── .env.example
├── server/
│   └── index.js          # Express: /api/chat, /api/upload, static
├── public/
│   └── index.html        # Full UI + client logic
└── uploads/              # Temporary uploaded files
```

## Notes

- API key never leaves the server.
- Uploads are kept in memory map + disk for the process lifetime; restart clears the map (re-upload if needed).
- For production: add auth, persist chats in a DB, rate-limit, and clean `uploads/` on a schedule.

## License

MIT — created by S. Bhuvanesh

"""
Spidy AI — Flask backend
Routes:
  GET  /                 -> SPA (templates/index.html)
  GET  /<extensionless>  -> SPA fallback (client-side routing)
  GET  /api/health        -> {ok, model, hasKey}
  POST /api/upload        -> multipart file upload (<=5 files, 20MB each)
  POST /api/chat           -> streams Claude's reply as SSE (text/event-stream)

Run:
  pip install -r requirements.txt
  cp .env.example .env   # then edit .env and set ANTHROPIC_API_KEY
  python app.py
"""
import base64
import json
import os
import uuid
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request
from werkzeug.exceptions import HTTPException

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
INDEX_HTML_PATH = BASE_DIR / "templates" / "index.html"


def render_index():
    # The page is a single self-contained file with its own `{{ ... }}`-looking
    # JS/JSDoc snippets, so it's served as a plain static file rather than
    # through Jinja (which would try, and fail, to parse those as template
    # expressions).
    return Response(INDEX_HTML_PATH.read_text(encoding="utf-8"), mimetype="text/html")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
# claude-sonnet-5 / claude-opus-5 are current model strings; Haiku 4.5 is the
# cheap/fast option. Pick whichever fits your budget — see the note in README
# about none of these being free to call via the API.
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")
MAX_TOKENS = int(os.environ.get("MAX_TOKENS", "4096"))
ANTHROPIC_VERSION = "2023-06-01"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"

TEXT_EXTS = {
    ".txt", ".md", ".js", ".ts", ".jsx", ".tsx", ".py", ".json", ".css",
    ".html", ".xml", ".csv", ".log", ".yml", ".yaml", ".sh", ".sql",
}
MAX_FILES = 5
MAX_FILE_BYTES = 20 * 1024 * 1024

app = Flask(__name__, template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # hard ceiling; per-file checked separately

# in-memory metadata for uploaded files this process has seen (cleared on restart)
file_store: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# CORS (kept permissive to match the original app; tighten for production)
# ---------------------------------------------------------------------------
@app.after_request
def add_cors_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@app.route("/api/<path:_any>", methods=["OPTIONS"])
@app.route("/", methods=["OPTIONS"])
def cors_preflight(_any=None):
    return ("", 204)


# ---------------------------------------------------------------------------
# Error handling — every /api/* error returns clean JSON (never an HTML
# stack trace, which is what makes a broken API route look like a "502").
# ---------------------------------------------------------------------------
def json_error(status, message, detail=None):
    body = {"error": True, "status": status, "message": message}
    if detail:
        body["detail"] = detail
    return jsonify(body), status


@app.errorhandler(HTTPException)
def handle_http_exception(e):
    if request.path.startswith("/api/"):
        return json_error(e.code, e.description or e.name)
    # non-API errors fall through to the SPA for extensionless paths;
    # anything else gets a plain text response like the original server.
    if e.code == 404 and not Path(request.path).suffix:
        return render_index()
    return (e.description or "Not found"), e.code


@app.errorhandler(Exception)
def handle_uncaught(e):
    app.logger.exception("Unhandled error on %s", request.path)
    if request.path.startswith("/api/"):
        return json_error(500, "Internal server error", str(e))
    return "Internal server error", 500


# ---------------------------------------------------------------------------
# Static / SPA
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_index()


@app.route("/<path:subpath>")
def spa_fallback(subpath):
    # Unmatched /api/* routes always get a clean JSON 404 (never the SPA).
    if subpath.startswith("api/"):
        return json_error(404, "Endpoint not found")
    # extensionless routes (e.g. /chat, /settings) render the SPA;
    # anything with a real extension that doesn't exist is a genuine 404.
    if not Path(subpath).suffix:
        return render_index()
    return ("Not found", 404)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.route("/api/health")
def health():
    return jsonify(
        ok=True,
        model=ANTHROPIC_MODEL,
        hasKey=bool(ANTHROPIC_API_KEY),
    )


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------
@app.route("/api/upload", methods=["POST"])
def upload():
    files = request.files.getlist("files") or [
        f for f in request.files.values()
    ]
    if not files:
        return json_error(400, "No files uploaded")
    if len(files) > MAX_FILES:
        return json_error(400, f"Max {MAX_FILES} files")

    results = []
    for f in files:
        raw = f.read()
        if len(raw) > MAX_FILE_BYTES:
            return json_error(400, "File too large (max 20MB)")

        file_id = uuid.uuid4().hex
        ext = Path(f.filename or "").suffix
        disk_path = UPLOAD_DIR / f"{file_id}{ext}"
        disk_path.write_bytes(raw)

        mime_type = f.mimetype or "application/octet-stream"
        is_image = mime_type.startswith("image/")
        extracted_text = None
        if not is_image:
            name_lower = (f.filename or "").lower()
            if mime_type.startswith("text/") or ext.lower() in TEXT_EXTS:
                extracted_text = raw.decode("utf-8", errors="replace")[:100000]
            elif name_lower.endswith((".pdf", ".docx")):
                extracted_text = (
                    f"[Binary document: {f.filename} — text extraction limited "
                    "without pypdf/python-docx installed.]"
                )

        meta = {
            "id": file_id,
            "originalName": f.filename or "file",
            "mimeType": mime_type,
            "size": len(raw),
            "path": str(disk_path),
            "isImage": is_image,
            "extractedText": extracted_text,
        }
        file_store[file_id] = meta
        results.append(
            {
                "id": file_id,
                "originalName": meta["originalName"],
                "mimeType": meta["mimeType"],
                "size": meta["size"],
                "isImage": is_image,
                "hasText": extracted_text is not None,
            }
        )

    return jsonify(files=results)


# ---------------------------------------------------------------------------
# Chat (streaming)
# ---------------------------------------------------------------------------
def build_anthropic_messages(messages, file_ids):
    out = []
    last_user_idx = max(
        (i for i, m in enumerate(messages) if m.get("role") == "user"), default=-1
    )
    for idx, m in enumerate(messages):
        role = "assistant" if m.get("role") == "assistant" else "user"
        is_last_user = role == "user" and idx == last_user_idx and idx == len(messages) - 1

        if is_last_user and file_ids:
            content = []
            text = m.get("content")
            if isinstance(text, str) and text.strip():
                content.append({"type": "text", "text": text})
            for fid in file_ids:
                meta = file_store.get(fid)
                if not meta:
                    continue
                if meta["isImage"]:
                    try:
                        b64 = base64.b64encode(Path(meta["path"]).read_bytes()).decode()
                        content.append(
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": meta["mimeType"] or "image/png",
                                    "data": b64,
                                },
                            }
                        )
                    except OSError:
                        continue
                elif meta["extractedText"]:
                    content.append(
                        {
                            "type": "text",
                            "text": f"[File: {meta['originalName']}]\n{meta['extractedText']}",
                        }
                    )
            if not content:
                content.append({"type": "text", "text": m.get("content") or ""})
            out.append({"role": "user", "content": content})
        else:
            out.append({"role": role, "content": m.get("content", "")})
    return out


@app.route("/api/chat", methods=["POST"])
def chat():
    if not ANTHROPIC_API_KEY:
        return json_error(503, "ANTHROPIC_API_KEY is not configured. Set it in .env")

    body = request.get_json(silent=True)
    if not body:
        return json_error(400, "Invalid JSON")

    messages = body.get("messages")
    file_ids = body.get("fileIds", [])
    system = body.get("system")

    if not isinstance(messages, list) or not messages:
        return json_error(400, "messages array required")

    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": MAX_TOKENS,
        "stream": True,
        "messages": build_anthropic_messages(messages, file_ids),
    }
    if isinstance(system, str) and system:
        payload["system"] = system

    try:
        upstream = requests.post(
            ANTHROPIC_URL,
            headers={
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": ANTHROPIC_VERSION,
            },
            json=payload,
            stream=True,
            timeout=120,
        )
    except requests.RequestException as e:
        # This is the case that used to surface as an opaque 502 — now it's
        # a clear JSON error naming the actual cause (DNS, timeout, etc).
        return json_error(502, "Could not reach Anthropic API", str(e))

    if upstream.status_code != 200:
        detail = upstream.text[:300]
        app.logger.error("Anthropic error %s: %s", upstream.status_code, detail)
        return json_error(upstream.status_code, "Upstream AI request failed", detail)

    def generate():
        buffer = ""
        try:
            for chunk in upstream.iter_content(chunk_size=None, decode_unicode=True):
                if not chunk:
                    continue
                buffer += chunk
                while "\n\n" in buffer:
                    raw_event, buffer = buffer.split("\n\n", 1)
                    for line in raw_event.split("\n"):
                        if not line.startswith("data: "):
                            continue
                        data_str = line[6:].strip()
                        if not data_str or data_str == "[DONE]":
                            continue
                        try:
                            evt = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue
                        if evt.get("type") == "content_block_delta":
                            delta = evt.get("delta", {})
                            if delta.get("type") == "text_delta":
                                yield f"data: {json.dumps({'type': 'text', 'text': delta.get('text', '')})}\n\n"
                        elif evt.get("type") == "message_stop":
                            yield f"data: {json.dumps({'type': 'done'})}\n\n"
                        elif evt.get("type") == "error":
                            msg = evt.get("error", {}).get("message", "stream error")
                            yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"
        except requests.RequestException as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3000"))
    if not ANTHROPIC_API_KEY:
        print("WARNING: ANTHROPIC_API_KEY not set — /api/chat will return 503 until configured.")
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG") == "1", threaded=True)

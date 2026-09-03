require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '4096', 10);

if (!API_KEY) {
  console.warn('\n⚠️  ANTHROPIC_API_KEY is not set. Copy .env.example → .env and add your key.\n');
}

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, '../public')));

const UPLOAD_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${uuidv4().slice(0, 8)}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(png|jpe?g|gif|webp|pdf|txt|md|csv|json|js|ts|py|html|css|docx|doc)$/i.test(file.originalname)
      || file.mimetype.startsWith('image/')
      || file.mimetype === 'application/pdf'
      || file.mimetype.startsWith('text/');
    cb(ok ? null : new Error('Unsupported file type'), ok);
  },
});

async function extractTextFromFile(filePath, mime, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  try {
    if (ext === '.pdf' || mime === 'application/pdf') {
      const data = await pdfParse(fs.readFileSync(filePath));
      return data.text || '';
    }
    if (ext === '.docx' || mime.includes('wordprocessingml')) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || '';
    }
    if (mime.startsWith('text/') || /\.(txt|md|csv|json|js|ts|py|html|css)$/i.test(ext)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (e) {
    console.error('Extract error:', e.message);
  }
  return '';
}

function imageToBase64(filePath, mime) {
  const buf = fs.readFileSync(filePath);
  const mediaType = mime || 'image/png';
  return { type: 'base64', media_type: mediaType, data: buf.toString('base64') };
}

app.post('/api/upload', upload.array('files', 5), async (req, res) => {
  try {
    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const results = [];
    for (const f of req.files) {
      const isImage = f.mimetype.startsWith('image/');
      let textContent = '';
      let imagePayload = null;

      if (isImage) {
        imagePayload = imageToBase64(f.path, f.mimetype);
      } else {
        textContent = await extractTextFromFile(f.path, f.mimetype, f.originalname);
      }

      results.push({
        id: path.basename(f.path),
        name: f.originalname,
        size: f.size,
        mime: f.mimetype,
        isImage,
        textPreview: textContent ? textContent.slice(0, 500) : null,
        textContent: textContent || null,
        // Keep path only server-side; client gets id
        _path: f.path,
      });
    }
    // Store lightweight meta for later chat use (in-memory for demo)
    if (!global.__spidyUploads) global.__spidyUploads = new Map();
    results.forEach((r) => {
      global.__spidyUploads.set(r.id, {
        path: r._path,
        mime: r.mime,
        name: r.name,
        isImage: r.isImage,
        textContent: r.textContent,
      });
    });

    res.json({
      files: results.map(({ _path, textContent, ...rest }) => ({
        ...rest,
        // Don't send full text back if huge; client can request or we inject on chat
        hasText: !!textContent,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

app.post('/api/chat', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'Server missing ANTHROPIC_API_KEY. Set it in .env' });
  }

  const { messages = [], system, fileIds = [], stream = true } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages required' });
  }

  // Build Anthropic content blocks, attaching files to the last user message
  const apiMessages = messages.map((m, idx) => {
    const isLastUser = m.role === 'user' && idx === messages.length - 1;
    if (!isLastUser || !fileIds.length) {
      return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
    }

    const contentBlocks = [];
    const uploads = global.__spidyUploads || new Map();

    for (const fid of fileIds) {
      const meta = uploads.get(fid);
      if (!meta) continue;
      if (meta.isImage && fs.existsSync(meta.path)) {
        contentBlocks.push({
          type: 'image',
          source: imageToBase64(meta.path, meta.mime),
        });
      } else if (meta.textContent) {
        contentBlocks.push({
          type: 'text',
          text: `[Attached file: ${meta.name}]\n\`\`\`\n${meta.textContent.slice(0, 80000)}\n\`\`\``,
        });
      }
    }
    contentBlocks.push({ type: 'text', text: m.content || '' });
    return { role: 'user', content: contentBlocks };
  });

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system:
      system ||
      'You are Spidy AI, a helpful, friendly assistant created by S. Bhuvanesh. Be clear, warm, and concise. Use markdown formatting where useful. When users attach files or images, analyze them carefully.',
    messages: apiMessages,
    stream: !!stream,
  };

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error('Anthropic error:', upstream.status, errText);
      return res.status(upstream.status).json({
        error: 'Upstream API error',
        detail: errText.slice(0, 500),
      });
    }

    if (!stream) {
      const data = await upstream.json();
      const text = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      return res.json({ content: text, usage: data.usage });
    }

    // SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') {
          res.write('data: [DONE]\n\n');
          continue;
        }
        try {
          const evt = JSON.parse(payload);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            res.write(`data: ${JSON.stringify({ type: 'text', text: evt.delta.text })}\n\n`);
          } else if (evt.type === 'message_stop') {
            res.write('data: [DONE]\n\n');
          } else if (evt.type === 'error') {
            res.write(`data: ${JSON.stringify({ type: 'error', error: evt.error })}\n\n`);
          }
        } catch {
          // ignore parse errors on partial
        }
      }
    }
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Chat failed' });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.end();
    }
  }
});

// Optional: simple health
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    hasKey: !!API_KEY,
  });
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🕷️  Spidy AI running at http://localhost:${PORT}`);
  console.log(`    Model: ${MODEL}`);
  console.log(`    API key: ${API_KEY ? 'set ✓' : 'MISSING — add to .env'}\n`);
});

// Máy chủ nhỏ, không phụ thuộc thư viện ngoài.
// - Phục vụ file tĩnh của app (index.html, js/, styles.css...).
// - REST API đọc/ghi file .md thật trong ./notes/ (vault mặc định).
//
// Server CỐ TÌNH mỏng: chỉ đọc/ghi/di chuyển/xoá bytes trong notes/. Mọi quy tắc
// nghiệp vụ (frontmatter, HTML<->Markdown, trash, cascade) nằm ở db.js phía client.

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;                 // gốc để phục vụ file tĩnh
const VAULT = path.join(ROOT, 'notes'); // thư mục dữ liệu
const PORT = process.env.PORT || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------------- Path safety ----------------

// Chỉ cho phép đường dẫn tương đối nằm TRONG notes/. Chặn traversal (../), đường tuyệt đối.
function resolveInVault(rel) {
  const clean = path.normalize(rel || '').replace(/^(\.\.(\/|\\|$))+/, '');
  const abs = path.join(VAULT, clean);
  if (abs !== VAULT && !abs.startsWith(VAULT + path.sep)) return null;
  return abs;
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// ---------------- API: đọc toàn bộ cây notes/ ----------------

// Trả về danh sách phẳng mọi mục cần cho client:
//   files: [{ path, content }]   — mọi .md (kể cả trong .trash/)
//   dirs:  [{ path }]            — mọi thư mục (folder + thư mục con trong .trash/)
//   meta:  [{ path, content }]   — mọi .folder.json
async function readTree() {
  const files = [];
  const dirs = [];
  const meta = [];

  async function walk(absDir, relDir) {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        dirs.push({ path: rel });
        await walk(path.join(absDir, ent.name), rel);
      } else if (ent.name === '.folder.json') {
        meta.push({ path: rel, content: await fs.readFile(path.join(absDir, ent.name), 'utf8') });
      } else if (ent.name.endsWith('.md')) {
        files.push({ path: rel, content: await fs.readFile(path.join(absDir, ent.name), 'utf8') });
      }
    }
  }

  await fs.mkdir(VAULT, { recursive: true });
  await walk(VAULT, '');
  return { files, dirs, meta };
}

// ---------------- Router ----------------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { pathname } = url;

    // ---- REST API ----
    if (pathname.startsWith('/api/')) {
      // GET /api/tree
      if (pathname === '/api/tree' && req.method === 'GET') {
        return sendJson(res, 200, await readTree());
      }

      // PUT /api/file?path=Folder/note.md   (body = nội dung file)
      if (pathname === '/api/file' && req.method === 'PUT') {
        const abs = resolveInVault(url.searchParams.get('path'));
        if (!abs) return sendJson(res, 400, { error: 'bad path' });
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, await readBody(req), 'utf8');
        return sendJson(res, 200, { ok: true });
      }

      // DELETE /api/file?path=...
      if (pathname === '/api/file' && req.method === 'DELETE') {
        const abs = resolveInVault(url.searchParams.get('path'));
        if (!abs) return sendJson(res, 400, { error: 'bad path' });
        await fs.rm(abs, { force: true });
        return sendJson(res, 200, { ok: true });
      }

      // POST /api/move   { from, to }   — di chuyển/đổi tên file hoặc thư mục
      if (pathname === '/api/move' && req.method === 'POST') {
        const { from, to } = JSON.parse(await readBody(req) || '{}');
        const absFrom = resolveInVault(from);
        const absTo = resolveInVault(to);
        if (!absFrom || !absTo) return sendJson(res, 400, { error: 'bad path' });
        await fs.mkdir(path.dirname(absTo), { recursive: true });
        await fs.rename(absFrom, absTo);
        return sendJson(res, 200, { ok: true });
      }

      // POST /api/mkdir?path=...
      if (pathname === '/api/mkdir' && req.method === 'POST') {
        const abs = resolveInVault(url.searchParams.get('path'));
        if (!abs) return sendJson(res, 400, { error: 'bad path' });
        await fs.mkdir(abs, { recursive: true });
        return sendJson(res, 200, { ok: true });
      }

      // DELETE /api/dir?path=...   — xoá cả thư mục (recursive)
      if (pathname === '/api/dir' && req.method === 'DELETE') {
        const abs = resolveInVault(url.searchParams.get('path'));
        if (!abs || abs === VAULT) return sendJson(res, 400, { error: 'bad path' });
        await fs.rm(abs, { recursive: true, force: true });
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 404, { error: 'not found' });
    }

    // ---- Static files ----
    let rel = decodeURIComponent(pathname);
    if (rel === '/') rel = '/index.html';
    const absStatic = path.normalize(path.join(ROOT, rel));
    if (absStatic !== ROOT && !absStatic.startsWith(ROOT + path.sep)) {
      return send(res, 403, 'Forbidden', 'text/plain');
    }
    try {
      const data = await fs.readFile(absStatic);
      return send(res, 200, data, MIME[path.extname(absStatic)] || 'application/octet-stream');
    } catch {
      return send(res, 404, 'Not found', 'text/plain');
    }
  } catch (err) {
    sendJson(res, 500, { error: String(err && err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`Personal Notes running at http://localhost:${PORT}`);
  console.log(`Notes are saved as .md files in: ${VAULT}`);
});

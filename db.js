// Tầng lưu trữ: gọi REST API của server.js để đọc/ghi file .md thật trong ./notes/.
// Mỗi note là một file .md (kiểu Obsidian); folder là thư mục con; Trash là .trash/.
//
// Bề mặt API (tên hàm + chữ ký) giữ NGUYÊN như bản IndexedDB cũ, nên toàn bộ UI
// (queries/render/nav/editor/...) không phải đổi gì. Việc dịch note <-> file .md
// nằm gọn trong file này; server chỉ đọc/ghi bytes.

const TRASH_RETENTION_DAYS = 30;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const TRASH_DIR = '.trash';

// File Insights do skill (Claude Code/Codex) ghi ra. Nằm ở gốc vault, kết thúc .md
// nên phải loại trừ khỏi danh sách note thường (xem getAllNotes / getInsights).
const INSIGHTS_FILE = '.insights.md';

// ---------------- HTTP helpers (nói chuyện với server.js) ----------------

async function apiTree() {
  const res = await fetch('/api/tree');
  if (!res.ok) throw new Error('Failed to read notes');
  return res.json();
}

async function apiWrite(path, content) {
  await fetch(`/api/file?path=${encodeURIComponent(path)}`, { method: 'PUT', body: content });
}

async function apiDeleteFile(path) {
  await fetch(`/api/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
}

async function apiMove(from, to) {
  await fetch('/api/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
}

async function apiMkdir(path) {
  await fetch(`/api/mkdir?path=${encodeURIComponent(path)}`, { method: 'POST' });
}

async function apiDeleteDir(path) {
  await fetch(`/api/dir?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
}

// Đọc toàn bộ cây một lần rồi tra cứu tại chỗ. Gọi lại mỗi thao tác để luôn tươi.
async function loadTree() {
  const { files, dirs, meta } = await apiTree();
  return {
    files,                                   // [{ path, content }]
    dirs: new Set(dirs.map((d) => d.path)),  // Set<string>
    metaByDir: new Map(meta.map((m) => [dirOf(m.path), m.content])),
  };
}

function dirOf(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

// ---------------- Slug / tên file ----------------

const INVALID = /[\\/:*?"<>|]/g;

function slugifyTitle(title) {
  const base = (title || '').trim().replace(INVALID, ' ').replace(/\s+/g, ' ').trim();
  return base || 'Untitled';
}

// Tìm một tên file .md chưa dùng trong thư mục dir, xuất phát từ title.
function uniqueFileName(existingNames, title) {
  const base = slugifyTitle(title);
  let candidate = `${base}.md`;
  let i = 2;
  while (existingNames.has(candidate)) {
    candidate = `${base} ${i}.md`;
    i += 1;
  }
  return candidate;
}

// Tên file (không kèm thư mục) của mọi .md nằm TRỰC TIẾP trong relDir.
function fileNamesIn(tree, relDir) {
  const names = new Set();
  for (const f of tree.files) {
    if (dirOf(f.path) === relDir) names.add(f.path.slice(relDir ? relDir.length + 1 : 0));
  }
  return names;
}

// ---------------- Frontmatter (YAML tối giản, phẳng) ----------------

const FM_KEYS = [
  'title', 'favourite', 'icon', 'theme', 'font',
  'fontSize', 'lineHeight', 'createdAt', 'updatedAt',
  'deletedAt', 'deletedWithFolderAt', 'originalFolderId',
];

function fmScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === 'null' || s === '') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return s;
}

function buildFrontmatter(meta) {
  const lines = ['---'];
  for (const key of FM_KEYS) {
    if (meta[key] === undefined) continue;
    lines.push(`${key}: ${fmScalar(meta[key])}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function splitFrontmatter(text) {
  const meta = {};
  if (!text.startsWith('---')) return { meta, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { meta, body: text };
  const block = text.slice(text.indexOf('\n') + 1, end);
  const rest = text.slice(end + 4).replace(/^\r?\n/, '');
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = parseScalar(line.slice(idx + 1));
  }
  return { meta, body: rest };
}

// ---------------- HTML <-> Markdown ----------------
// Chỉ chuyển đúng tập định dạng đã chốt giữ lại: <p> <b/strong> <i/em> <s> <ul><li> <a>.
// Các thẻ không map được (<u>, <span style>, <img>) → chỉ giữ text bên trong.

// Chuyển 1 phần tử inline (áp quy tắc theo tag của CHÍNH nó).
function inlineElToMd(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'br') return '\n';
  const inner = inlineToMd(el);
  if (tag === 'b' || tag === 'strong') return `**${inner}**`;
  if (tag === 'i' || tag === 'em') return `*${inner}*`;
  if (tag === 's' || tag === 'strike' || tag === 'del') return `~~${inner}~~`;
  if (tag === 'a') return `[${inner}](${el.getAttribute('href') || ''})`;
  return inner; // u, span, img, ... → chỉ lấy text
}

// Chuyển nội dung con của 1 node thành markdown inline.
function inlineToMd(node) {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) out += child.textContent;
    else if (child.nodeType === Node.ELEMENT_NODE) out += inlineElToMd(child);
  }
  return out;
}

const BLOCK_TAGS = new Set(['p', 'div', 'ul', 'ol', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

export function htmlToMarkdown(html) {
  const root = document.createElement('div');
  root.innerHTML = html || '';
  const blocks = [];
  let inlineRun = ''; // gom các node inline top-level liền kề thành 1 đoạn

  const flushInline = () => {
    const t = inlineRun.trim();
    if (t) blocks.push(t);
    inlineRun = '';
  };

  for (const node of root.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      inlineRun += node.textContent;
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = node.tagName.toLowerCase();

    if (tag === 'br') {
      inlineRun += '\n';
    } else if (tag === 'ul' || tag === 'ol') {
      flushInline();
      const items = [];
      node.querySelectorAll(':scope > li').forEach((li, i) => {
        const marker = tag === 'ol' ? `${i + 1}.` : '-';
        items.push(`${marker} ${inlineToMd(li).trim()}`);
      });
      if (items.length) blocks.push(items.join('\n'));
    } else if (BLOCK_TAGS.has(tag)) {
      // phần tử block (p, div, ...) → kết thúc đoạn inline đang gom, rồi là 1 block riêng
      flushInline();
      const md = inlineToMd(node).trim();
      if (md) blocks.push(md);
    } else {
      // phần tử inline top-level (b, i, s, a, span) → gộp vào đoạn đang gom
      inlineRun += inlineElToMd(node);
    }
  }
  flushInline();
  return blocks.join('\n\n').trim();
}

export function markdownToHtml(md) {
  const text = (md || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  const blocks = text.split(/\n{2,}/);
  const html = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    // Heading: một dòng bắt đầu bằng 1-6 dấu # (dùng cho Insights; note thường không có).
    const h = /^(#{1,6})\s+(.*)$/.exec(block);
    if (h && lines.length === 1) {
      const level = h[1].length;
      html.push(`<h${level}>${inlineMdToHtml(h[2])}</h${level}>`);
      continue;
    }
    const isList = lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l));
    if (isList) {
      const ordered = /^\s*\d+\.\s+/.test(lines[0]);
      const tag = ordered ? 'ol' : 'ul';
      const items = lines
        .map((l) => l.replace(/^\s*([-*]|\d+\.)\s+/, ''))
        .map((l) => `<li>${inlineMdToHtml(l)}</li>`)
        .join('');
      html.push(`<${tag}>${items}</${tag}>`);
    } else {
      html.push(`<p>${inlineMdToHtml(block.replace(/\n/g, '<br>'))}</p>`);
    }
  }
  return html.join('');
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineMdToHtml(s) {
  let out = escHtml(s);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank">${t}</a>`);
  out = out.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
  return out;
}

// ---------------- Note <-> file ----------------

// id của note = đường dẫn tương đối: "folderId/filename.md" hoặc "filename.md".
function makeId(folderId, name) {
  return folderId ? `${folderId}/${name}` : name;
}

function splitId(id) {
  const idx = id.lastIndexOf('/');
  if (idx === -1) return { folderId: null, name: id };
  return { folderId: id.slice(0, idx), name: id.slice(idx + 1) };
}

function fileToNote(text, id, { folderId }) {
  const { meta, body } = splitFrontmatter(text);
  return {
    id,
    title: meta.title ?? '',
    content: markdownToHtml(body),
    folderId: folderId ?? null,
    isFavourite: meta.favourite === true,
    icon: meta.icon ?? null,
    theme: meta.theme ?? 'default',
    font: meta.font ?? 'sans',
    fontSize: typeof meta.fontSize === 'number' ? meta.fontSize : 16,
    lineHeight: typeof meta.lineHeight === 'number' ? meta.lineHeight : 1.6,
    createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : Date.now(),
    updatedAt: typeof meta.updatedAt === 'number' ? meta.updatedAt : Date.now(),
    deletedAt: typeof meta.deletedAt === 'number' ? meta.deletedAt : null,
    deletedWithFolderAt: typeof meta.deletedWithFolderAt === 'number' ? meta.deletedWithFolderAt : null,
  };
}

function noteToFile(note, extra = {}) {
  const meta = {
    title: note.title || '',
    favourite: !!note.isFavourite,
    icon: note.icon ?? null,
    theme: note.theme || 'default',
    font: note.font || 'sans',
    fontSize: note.fontSize || 16,
    lineHeight: note.lineHeight || 1.6,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    ...extra,
  };
  return `${buildFrontmatter(meta)}\n\n${htmlToMarkdown(note.content)}\n`;
}

// ---------------- Notes ----------------

export async function getAllNotes() {
  const tree = await loadTree();
  const out = [];
  for (const f of tree.files) {
    if (f.path === INSIGHTS_FILE) continue; // không phải note — là bản Insights
    const dir = dirOf(f.path);
    if (dir === TRASH_DIR) {
      // note đã xoá lẻ: originalFolderId lưu trong frontmatter
      const { meta } = splitFrontmatter(f.content);
      out.push(fileToNote(f.content, f.path, { folderId: meta.originalFolderId ?? null }));
    } else if (dir.startsWith(`${TRASH_DIR}/`)) {
      // note nằm trong folder đã xoá (dưới .trash/<folder>/) — folderId là folder gốc
      const folderId = dir.slice(TRASH_DIR.length + 1);
      out.push(fileToNote(f.content, f.path, { folderId }));
    } else {
      out.push(fileToNote(f.content, f.path, { folderId: dir || null }));
    }
  }
  return out;
}

export async function getNote(id) {
  const tree = await loadTree();
  const f = tree.files.find((x) => x.path === id);
  if (!f) return null;
  const { folderId } = splitId(id);
  return fileToNote(f.content, id, { folderId });
}

// ---------------- Insights ----------------
// App chỉ ĐỌC file này; nội dung do skill weekly-insights ghi ra ngoài app.
// Trả { html, updatedAt } hoặc null nếu chưa từng chạy skill.
export async function getInsights() {
  const tree = await loadTree();
  const f = tree.files.find((x) => x.path === INSIGHTS_FILE);
  if (!f) return null;
  const { meta, body } = splitFrontmatter(f.content);
  return { html: markdownToHtml(body), updatedAt: meta.updatedAt ?? null };
}

export async function createNote({ folderId = null } = {}) {
  const now = Date.now();
  const note = {
    id: '', title: '', content: '', folderId,
    isFavourite: false, icon: null, theme: 'default', font: 'sans',
    fontSize: 16, lineHeight: 1.6, createdAt: now, updatedAt: now,
    deletedAt: null, deletedWithFolderAt: null,
  };
  const tree = await loadTree();
  if (folderId) await apiMkdir(folderId);
  const name = uniqueFileName(fileNamesIn(tree, folderId || ''), note.title);
  note.id = makeId(folderId, name);
  await apiWrite(note.id, noteToFile(note));
  return note;
}

export async function updateNote(id, patch, { touch = true } = {}) {
  const tree = await loadTree();
  const f = tree.files.find((x) => x.path === id);
  if (!f) return null;
  const { folderId } = splitId(id);
  const note = fileToNote(f.content, id, { folderId });

  const next = { ...note, ...patch };
  if (touch) next.updatedAt = Date.now();

  const movingFolder = patch.folderId !== undefined && patch.folderId !== folderId;
  const renaming = patch.title !== undefined && patch.title !== note.title;

  if (movingFolder || renaming) {
    const destFolder = next.folderId;
    if (destFolder) await apiMkdir(destFolder);
    const existing = fileNamesIn(tree, destFolder || '');
    // đừng tính chính file đang sửa là "đã tồn tại" nếu ở cùng thư mục
    if (!movingFolder) existing.delete(splitId(id).name);
    const destName = uniqueFileName(existing, next.title);
    const destId = makeId(destFolder, destName);
    next.id = destId;
    await apiWrite(destId, noteToFile(next));
    if (destId !== id) await apiDeleteFile(id);
    return next;
  }

  await apiWrite(id, noteToFile(next));
  return next;
}

// Soft delete: move file .md vào .trash/, ghi kèm deletedAt + originalFolderId để restore.
export async function softDeleteNote(id, { deletedAt = Date.now() } = {}) {
  const tree = await loadTree();
  const f = tree.files.find((x) => x.path === id);
  if (!f) return null;
  const { folderId } = splitId(id);
  const note = fileToNote(f.content, id, { folderId });

  await apiMkdir(TRASH_DIR);
  const trashName = uniqueFileName(fileNamesIn(tree, TRASH_DIR), note.title);
  note.deletedAt = deletedAt;
  note.deletedWithFolderAt = null;
  const trashId = makeId(TRASH_DIR, trashName);
  await apiWrite(trashId, noteToFile(note, { deletedAt, deletedWithFolderAt: null, originalFolderId: folderId }));
  await apiDeleteFile(id);
  return { ...note, id: trashId };
}

// Restore note lẻ: về đúng folder cũ nếu còn tồn tại, không thì về gốc vault (All Notes).
export async function restoreNote(id) {
  const tree = await loadTree();
  const f = tree.files.find((x) => x.path === id);
  if (!f) return null;
  const { meta } = splitFrontmatter(f.content);
  let folderId = meta.originalFolderId ?? null;
  if (folderId && !tree.dirs.has(folderId)) folderId = null;

  if (folderId) await apiMkdir(folderId);
  const note = fileToNote(f.content, id, { folderId });
  note.deletedAt = null;
  note.deletedWithFolderAt = null;
  const destName = uniqueFileName(fileNamesIn(tree, folderId || ''), note.title);
  note.id = makeId(folderId, destName);
  await apiWrite(note.id, noteToFile(note));
  await apiDeleteFile(id);
  return note;
}

export async function purgeNote(id) {
  await apiDeleteFile(id);
}

// ---------------- Folders ----------------

function parseMeta(content) {
  try {
    return JSON.parse(content || '{}');
  } catch {
    return {};
  }
}

export async function getAllFolders() {
  const tree = await loadTree();
  const out = [];

  for (const dir of tree.dirs) {
    if (dir === TRASH_DIR) continue;
    if (dir.startsWith(`${TRASH_DIR}/`)) {
      // folder đã xoá: .trash/<name>
      const name = dir.slice(TRASH_DIR.length + 1);
      if (name.includes('/')) continue; // chỉ lấy cấp 1 trong trash
      const meta = parseMeta(tree.metaByDir.get(dir));
      out.push({
        id: dir,
        name: meta.name || name,
        color: meta.color || 'blue',
        icon: meta.icon || null,
        createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : 0,
        deletedAt: typeof meta.deletedAt === 'number' ? meta.deletedAt : Date.now(),
      });
    } else if (!dir.includes('/')) {
      // folder sống (cấp 1)
      const meta = parseMeta(tree.metaByDir.get(dir));
      out.push({
        id: dir,
        name: dir,
        color: meta.color || 'blue',
        icon: meta.icon || null,
        createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : 0,
        deletedAt: null,
      });
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export async function createFolder(name, color, icon = null) {
  const tree = await loadTree();
  const clean = slugifyTitle(name) || 'Untitled folder';
  let folderName = clean;
  let i = 2;
  while (tree.dirs.has(folderName)) { folderName = `${clean} ${i}`; i += 1; }
  await apiMkdir(folderName);
  const meta = { name: folderName, color: color || 'blue', icon: icon || null, createdAt: Date.now() };
  await apiWrite(`${folderName}/.folder.json`, JSON.stringify(meta, null, 2));
  return { id: folderName, name: folderName, color: meta.color, icon: meta.icon, createdAt: meta.createdAt, deletedAt: null };
}

export async function updateFolder(id, patch) {
  const tree = await loadTree();
  if (!tree.dirs.has(id)) return null;
  const meta = parseMeta(tree.metaByDir.get(id));
  const merged = { name: meta.name || id, color: meta.color || 'blue', icon: meta.icon || null, createdAt: meta.createdAt || 0, ...patch };

  // Đổi tên folder = đổi tên thư mục thật (move mọi .md sang thư mục mới)
  if (patch.name && patch.name !== id) {
    const newName = slugifyTitle(patch.name);
    let target = newName;
    let i = 2;
    while (tree.dirs.has(target)) { target = `${newName} ${i}`; i += 1; }
    for (const f of tree.files) {
      if (dirOf(f.path) === id) {
        const base = f.path.slice(id.length + 1);
        await apiMove(f.path, `${target}/${base}`);
      }
    }
    await apiWrite(`${target}/.folder.json`, JSON.stringify({ ...merged, name: target }, null, 2));
    await apiDeleteDir(id);
    return { id: target, name: target, color: merged.color, icon: merged.icon, createdAt: merged.createdAt, deletedAt: null };
  }

  await apiWrite(`${id}/.folder.json`, JSON.stringify(merged, null, 2));
  return { id, name: merged.name, color: merged.color, icon: merged.icon, createdAt: merged.createdAt, deletedAt: null };
}

// Xoá folder = move cả thư mục con vào .trash/, đánh dấu deletedWithFolderAt = timestamp đợt này.
export async function softDeleteFolder(id) {
  const tree = await loadTree();
  if (!tree.dirs.has(id)) return null;
  const now = Date.now();
  const meta = parseMeta(tree.metaByDir.get(id));

  await apiMkdir(TRASH_DIR);
  let trashName = id;
  let i = 2;
  while (tree.dirs.has(`${TRASH_DIR}/${trashName}`)) { trashName = `${id} ${i}`; i += 1; }
  const destDir = `${TRASH_DIR}/${trashName}`;

  for (const f of tree.files) {
    if (dirOf(f.path) !== id) continue;
    const base = f.path.slice(id.length + 1);
    const note = fileToNote(f.content, f.path, { folderId: id });
    await apiWrite(`${destDir}/${base}`, noteToFile(note, { deletedAt: now, deletedWithFolderAt: now, originalFolderId: id }));
  }
  await apiWrite(`${destDir}/.folder.json`, JSON.stringify({ ...meta, name: meta.name || id, deletedAt: now, deletedWithFolderAt: now }, null, 2));
  await apiDeleteDir(id);
  return { folder: { id, name: meta.name || id }, batchAt: now };
}

// Restore folder = tạo lại thư mục + đúng bộ note bị xoá kèm nó (deletedWithFolderAt khớp batch).
export async function restoreFolder(id) {
  const tree = await loadTree();
  const { name: trashFolderName } = splitId(id); // id = ".trash/<name>"
  const srcDir = id;
  if (!tree.dirs.has(srcDir)) return null;
  const meta = parseMeta(tree.metaByDir.get(srcDir));
  const originalName = meta.name || trashFolderName;
  const batchAt = meta.deletedWithFolderAt ?? meta.deletedAt;

  let target = originalName;
  let i = 2;
  while (tree.dirs.has(target)) { target = `${originalName} ${i}`; i += 1; }
  await apiMkdir(target);
  await apiWrite(`${target}/.folder.json`, JSON.stringify({ name: target, color: meta.color || 'blue', icon: meta.icon || null, createdAt: meta.createdAt || Date.now() }, null, 2));

  for (const f of tree.files) {
    if (dirOf(f.path) !== srcDir) continue;
    const { meta: nm } = splitFrontmatter(f.content);
    if (nm.deletedWithFolderAt !== batchAt) continue; // chỉ mang lại đúng đợt
    const base = f.path.slice(srcDir.length + 1);
    const note = fileToNote(f.content, f.path, { folderId: target });
    note.deletedAt = null;
    note.deletedWithFolderAt = null;
    await apiWrite(`${target}/${base}`, noteToFile(note));
  }
  await apiDeleteDir(srcDir);
  return { id: target, name: target, color: meta.color || 'blue', icon: meta.icon || null, createdAt: meta.createdAt || 0, deletedAt: null };
}

export async function purgeFolder(id) {
  await apiDeleteDir(id);
}

export async function countNotesInFolder(id) {
  const notes = await getAllNotes();
  return notes.filter((n) => n.folderId === id && n.deletedAt === null).length;
}

// ---------------- Trash ----------------

export async function emptyTrash() {
  await apiDeleteDir(TRASH_DIR);
}

// Auto-purge: chạy mỗi lần mở app. Xoá mục trong .trash quá 30 ngày.
export async function purgeExpired(now = Date.now()) {
  const cutoff = now - TRASH_RETENTION_MS;
  const tree = await loadTree();

  // note lẻ trong .trash/
  for (const f of tree.files) {
    if (dirOf(f.path) !== TRASH_DIR) continue;
    const { meta } = splitFrontmatter(f.content);
    if (typeof meta.deletedAt === 'number' && meta.deletedAt < cutoff) {
      await apiDeleteFile(f.path);
    }
  }
  // folder đã xoá trong .trash/<name>/
  for (const dir of tree.dirs) {
    if (!dir.startsWith(`${TRASH_DIR}/`)) continue;
    const name = dir.slice(TRASH_DIR.length + 1);
    if (name.includes('/')) continue;
    const meta = parseMeta(tree.metaByDir.get(dir));
    if (typeof meta.deletedAt === 'number' && meta.deletedAt < cutoff) {
      await apiDeleteDir(dir);
    }
  }
}

export function daysLeftInTrash(deletedAt, now = Date.now()) {
  return Math.max(0, Math.ceil((deletedAt + TRASH_RETENTION_MS - now) / (24 * 60 * 60 * 1000)));
}

export { TRASH_RETENTION_DAYS };

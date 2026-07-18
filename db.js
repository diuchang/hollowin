// IndexedDB layer + toàn bộ quy tắc nghiệp vụ (domain logic).
// Không có server, không tài khoản: mọi dữ liệu nằm trong trình duyệt này.

const DB_NAME = 'personal-notes';
const DB_VERSION = 1;
const TRASH_RETENTION_DAYS = 30;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('notes')) {
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('folderId', 'folderId');
        notes.createIndex('updatedAt', 'updatedAt');
        notes.createIndex('deletedAt', 'deletedAt');
      }
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    Promise.resolve(fn(t)).then((r) => { result = r; }, reject);
  });
}

const reqToPromise = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const uuid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

// ---------- Notes ----------

export async function getAllNotes() {
  return tx(['notes'], 'readonly', (t) => reqToPromise(t.objectStore('notes').getAll()));
}

export async function getAllFolders() {
  return tx(['folders'], 'readonly', (t) => reqToPromise(t.objectStore('folders').getAll()));
}

export async function getNote(id) {
  return tx(['notes'], 'readonly', (t) => reqToPromise(t.objectStore('notes').get(id)));
}

export async function createNote({ folderId = null } = {}) {
  const now = Date.now();
  const note = {
    id: uuid(),
    title: '',
    content: '',
    folderId,
    isFavourite: false,
    icon: null,
    theme: 'default',
    font: 'sans',
    fontSize: 16,
    lineHeight: 1.6,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedWithFolderAt: null,
  };
  await tx(['notes'], 'readwrite', (t) => reqToPromise(t.objectStore('notes').add(note)));
  return note;
}

export async function updateNote(id, patch, { touch = true } = {}) {
  return tx(['notes'], 'readwrite', async (t) => {
    const store = t.objectStore('notes');
    const note = await reqToPromise(store.get(id));
    if (!note) return null;
    const next = { ...note, ...patch };
    if (touch) next.updatedAt = Date.now();
    await reqToPromise(store.put(next));
    return next;
  });
}

// Soft delete: dữ liệu giữ nguyên, chỉ ẩn khỏi All Notes / Folder / Favourite.
export async function softDeleteNote(id) {
  return updateNote(id, { deletedAt: Date.now(), deletedWithFolderAt: null }, { touch: false });
}

// Restore note lẻ: về đúng folder cũ nếu folder còn sống, không thì về All Notes.
export async function restoreNote(id) {
  return tx(['notes', 'folders'], 'readwrite', async (t) => {
    const notes = t.objectStore('notes');
    const note = await reqToPromise(notes.get(id));
    if (!note) return null;
    let folderId = note.folderId;
    if (folderId) {
      const folder = await reqToPromise(t.objectStore('folders').get(folderId));
      if (!folder || folder.deletedAt !== null) folderId = null;
    }
    const next = { ...note, folderId, deletedAt: null, deletedWithFolderAt: null };
    await reqToPromise(notes.put(next));
    return next;
  });
}

export async function purgeNote(id) {
  return tx(['notes'], 'readwrite', (t) => reqToPromise(t.objectStore('notes').delete(id)));
}

// ---------- Folders ----------

export async function createFolder(name, color, icon = null) {
  const folder = {
    id: uuid(),
    name: name.trim() || 'Untitled folder',

    color: color || 'blue',
    icon: icon || null,
    createdAt: Date.now(),
    deletedAt: null,
  };
  await tx(['folders'], 'readwrite', (t) => reqToPromise(t.objectStore('folders').add(folder)));
  return folder;
}

export async function updateFolder(id, patch) {
  return tx(['folders'], 'readwrite', async (t) => {
    const store = t.objectStore('folders');
    const folder = await reqToPromise(store.get(id));
    if (!folder) return null;
    const next = { ...folder, ...patch };
    await reqToPromise(store.put(next));
    return next;
  });
}

// Xoá folder = cascade xoá mọi note đang sống bên trong, trong một thao tác duy nhất.
// deletedWithFolderAt đánh dấu đúng "đợt" này để restore không vơ nhầm note bị xoá lẻ trước đó.
export async function softDeleteFolder(id) {
  return tx(['notes', 'folders'], 'readwrite', async (t) => {
    const folders = t.objectStore('folders');
    const folder = await reqToPromise(folders.get(id));
    if (!folder) return null;
    const now = Date.now();
    await reqToPromise(folders.put({ ...folder, deletedAt: now }));

    const notes = t.objectStore('notes');
    const inFolder = await reqToPromise(notes.index('folderId').getAll(id));
    for (const note of inFolder) {
      if (note.deletedAt === null) {
        await reqToPromise(notes.put({ ...note, deletedAt: now, deletedWithFolderAt: now }));
      }
    }
    return { folder, batchAt: now };
  });
}

// Restore folder = khôi phục folder + đúng bộ note đã bị xoá kèm nó.
export async function restoreFolder(id) {
  return tx(['notes', 'folders'], 'readwrite', async (t) => {
    const folders = t.objectStore('folders');
    const folder = await reqToPromise(folders.get(id));
    if (!folder) return null;
    const batchAt = folder.deletedAt;
    await reqToPromise(folders.put({ ...folder, deletedAt: null }));

    const notes = t.objectStore('notes');
    const inFolder = await reqToPromise(notes.index('folderId').getAll(id));
    for (const note of inFolder) {
      if (note.deletedWithFolderAt === batchAt && note.deletedAt !== null) {
        await reqToPromise(notes.put({ ...note, deletedAt: null, deletedWithFolderAt: null }));
      }
    }
    return folder;
  });
}

// Xoá vĩnh viễn folder → xoá luôn mọi note thuộc nó (không để lại note mồ côi).
export async function purgeFolder(id) {
  return tx(['notes', 'folders'], 'readwrite', async (t) => {
    const notes = t.objectStore('notes');
    const inFolder = await reqToPromise(notes.index('folderId').getAll(id));
    for (const note of inFolder) await reqToPromise(notes.delete(note.id));
    await reqToPromise(t.objectStore('folders').delete(id));
  });
}

export async function countNotesInFolder(id) {
  const notes = await getAllNotes();
  return notes.filter((n) => n.folderId === id && n.deletedAt === null).length;
}

// ---------- Trash ----------

export async function emptyTrash() {
  return tx(['notes', 'folders'], 'readwrite', async (t) => {
    const notes = t.objectStore('notes');
    const all = await reqToPromise(notes.getAll());
    for (const n of all) if (n.deletedAt !== null) await reqToPromise(notes.delete(n.id));

    const folders = t.objectStore('folders');
    const allFolders = await reqToPromise(folders.getAll());
    for (const f of allFolders) if (f.deletedAt !== null) await reqToPromise(folders.delete(f.id));
  });
}

// Auto-purge: chạy mỗi lần mở app, không cần background job vì app không có server.
export async function purgeExpired(now = Date.now()) {
  const cutoff = now - TRASH_RETENTION_MS;
  return tx(['notes', 'folders'], 'readwrite', async (t) => {
    const notes = t.objectStore('notes');
    const all = await reqToPromise(notes.getAll());
    for (const n of all) {
      if (n.deletedAt !== null && n.deletedAt < cutoff) await reqToPromise(notes.delete(n.id));
    }
    const folders = t.objectStore('folders');
    const allFolders = await reqToPromise(folders.getAll());
    for (const f of allFolders) {
      if (f.deletedAt !== null && f.deletedAt < cutoff) await reqToPromise(folders.delete(f.id));
    }
  });
}

export function daysLeftInTrash(deletedAt, now = Date.now()) {
  return Math.max(0, Math.ceil((deletedAt + TRASH_RETENTION_MS - now) / (24 * 60 * 60 * 1000)));
}

export { TRASH_RETENTION_DAYS };

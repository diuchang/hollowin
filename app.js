import * as db from './db.js';
import { seedIfEmpty } from './seed.js';

// ---------------- Constants ----------------

const FOLDER_COLORS = {
  blue: '#5b8def', green: '#4aa96c', yellow: '#e0a300',
  pink: '#dd6b9a', purple: '#8b6ade', orange: '#d8763a',
};

const THEMES = [
  { id: 'default', label: 'White', bg: '#ffffff' },
  { id: 'blue', label: 'Blue', bg: '#eef4fb' },
  { id: 'green', label: 'Green', bg: '#eef6ef' },
  { id: 'yellow', label: 'Yellow', bg: '#fdf6e3' },
  { id: 'pink', label: 'Pink', bg: '#fceef3' },
  { id: 'purple', label: 'Purple', bg: '#f3f0fb' },
];

const FONTS = {
  sans: 'var(--f-sans)', serif: 'var(--f-serif)',
  mono: 'var(--f-mono)', hand: 'var(--f-hand)',
};

const FONT_OPTIONS = [
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
  { id: 'hand', label: 'Handwriting' },
];

const EMOJIS = ['😀','😄','😍','🤔','😴','😭','🥳','👍','🙏','💪','🔥','✨','⭐','❤️','💡','📌','✅','❌','⚠️','📝','📚','🎯','🎉','☕','🌱','🌙','☀️','🍀','🎵','🏃','✈️','🏠','💰','⏰','📅','🤝','👀','💭'];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------------- State ----------------

const state = {
  view: 'all',        // 'all' | 'folder' | 'favourite' | 'trash'
  folderId: null,
  range: 'all',       // 'all' | 'today' | 'week' | 'month'
  query: '',
  notes: [],
  folders: [],
  editing: null,      // note đang mở trong Editor
};

// ---------------- Utils ----------------

// Chèn khoảng trắng ở ranh giới block, nếu không "<p>a</p><p>b</p>" sẽ dính thành "ab"
// (ảnh hưởng cả preview trên card lẫn số từ trong Editor).
const htmlToText = (html) => {
  const d = document.createElement('div');
  d.innerHTML = (html || '').replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote)\s*\/?>/gi, ' ');
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
};

const displayTitle = (note) => {
  if (note.title.trim()) return note.title.trim();
  const text = htmlToText(note.content);
  return text ? text.slice(0, 60) : 'Untitled note';
};

const fmtDate = (ts) => {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return `Today ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function rangeStart(range) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === 'today') return d.getTime();
  if (range === 'week') {
    const dow = (d.getDay() + 6) % 7; // tuần bắt đầu từ Thứ 2
    d.setDate(d.getDate() - dow);
    return d.getTime();
  }
  if (range === 'month') { d.setDate(1); return d.getTime(); }
  return 0;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

// ---------------- Data refresh ----------------

async function refresh() {
  const [notes, folders] = await Promise.all([db.getAllNotes(), db.getAllFolders()]);
  state.notes = notes;
  state.folders = folders;
}

const liveFolders = () =>
  state.folders.filter((f) => f.deletedAt === null).sort((a, b) => a.createdAt - b.createdAt);

const folderById = (id) => state.folders.find((f) => f.id === id);

// Các truy vấn cốt lõi theo spec
const notesAll = () => state.notes.filter((n) => n.deletedAt === null);
const notesInFolder = (id) => state.notes.filter((n) => n.folderId === id && n.deletedAt === null);
const notesFavourite = () => state.notes.filter((n) => n.isFavourite && n.deletedAt === null);

function visibleNotes() {
  let list;
  if (state.view === 'folder') list = notesInFolder(state.folderId);
  else if (state.view === 'favourite') list = notesFavourite();
  else list = notesAll();

  const from = rangeStart(state.range);
  if (from) list = list.filter((n) => n.updatedAt >= from);

  const q = state.query.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (n) => displayTitle(n).toLowerCase().includes(q) || htmlToText(n.content).toLowerCase().includes(q)
    );
  }
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

function trashItems() {
  const notes = state.notes
    .filter((n) => n.deletedAt !== null)
    .map((n) => ({ kind: 'note', item: n, deletedAt: n.deletedAt }));
  const folders = state.folders
    .filter((f) => f.deletedAt !== null)
    .map((f) => ({ kind: 'folder', item: f, deletedAt: f.deletedAt }));
  return [...notes, ...folders].sort((a, b) => b.deletedAt - a.deletedAt);
}

// ---------------- Render: sidebar ----------------

function renderSidebar() {
  $$('.nav-item').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.view === state.view)
  );

  $('[data-count="all"]').textContent = notesAll().length || '';
  $('[data-count="favourite"]').textContent = notesFavourite().length || '';
  const tCount = trashItems().length;
  $('[data-count="trash"]').textContent = tCount || '';

  const wrap = $('#folder-list');
  wrap.innerHTML = '';
  const folders = liveFolders();

  if (!folders.length) {
    wrap.innerHTML = '<p class="empty-hint">No folders yet</p>';
    return;
  }

  for (const f of folders) {
    const btn = document.createElement('button');
    btn.className = 'folder-item' + (state.view === 'folder' && state.folderId === f.id ? ' is-active' : '');
    btn.innerHTML = `
      <span class="swatch" style="background:${FOLDER_COLORS[f.color] || FOLDER_COLORS.blue}"></span>
      <span class="name"></span>
      <span class="n">${notesInFolder(f.id).length || ''}</span>`;
    btn.querySelector('.name').textContent = f.name;
    btn.onclick = () => { state.view = 'folder'; state.folderId = f.id; render(); };
    btn.oncontextmenu = (e) => {
      e.preventDefault();
      openFolderContextMenu(f.id, e.clientX, e.clientY);
    };
    wrap.appendChild(btn);
  }
}

// ---------------- Render: list header ----------------

function renderHead() {
  const isTrash = state.view === 'trash';
  const isFolder = state.view === 'folder';
  const folder = isFolder ? folderById(state.folderId) : null;

  $('#list-title').textContent = isTrash
    ? 'Trash'
    : state.view === 'favourite'
    ? 'Favourite'
    : isFolder
    ? folder?.name ?? 'Folder'
    : 'All Notes';

  const count = isTrash ? trashItems().length : visibleNotes().length;
  $('#list-count').textContent = plural(count, isTrash ? 'item' : 'note');

  $('#filters').hidden = isTrash;
  $('#trash-head').hidden = !isTrash;
  $('.search-wrap').hidden = isTrash;
  $('#folder-actions').hidden = !isFolder;

  // Nhãn nút "+ New Note" đổi theo folder đang mở
  $('#btn-new-note').innerHTML = isFolder
    ? `<span class="plus">+</span> New Note in ${escapeHtml(folder?.name ?? '')}`
    : '<span class="plus">+</span> New Note';

  if (isFolder && folder) {
    const picker = $('#folder-colors');
    picker.innerHTML = '';
    for (const [id, hex] of Object.entries(FOLDER_COLORS)) {
      const dot = document.createElement('button');
      dot.className = 'color-dot' + (folder.color === id ? ' is-active' : '');
      dot.style.background = hex;
      dot.title = id;
      dot.onclick = async () => {
        await db.updateFolder(folder.id, { color: id });
        await refresh();
        render();
      };
      picker.appendChild(dot);
    }
  }

  $$('.filter').forEach((b) => b.classList.toggle('is-active', b.dataset.range === state.range));
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------- Render: note list ----------------

function renderList() {
  const wrap = $('#note-list');
  wrap.innerHTML = '';

  if (state.view === 'trash') return renderTrash(wrap);

  const notes = visibleNotes();
  if (!notes.length) return wrap.appendChild(emptyState());

  for (const n of notes) {
    const card = document.createElement('button');
    card.className = 'note-card';
    card.dataset.theme = n.theme || 'default';

    const folder = n.folderId ? folderById(n.folderId) : null;
    card.innerHTML = `
      ${n.isFavourite ? '<span class="card-star">⭐</span>' : ''}
      <span class="card-title"></span>
      <span class="card-preview"></span>
      <span class="card-foot">
        <span class="when"></span>
        ${folder ? `<span class="chip-folder"><span class="swatch" style="background:${FOLDER_COLORS[folder.color]}"></span><span class="fname"></span></span>` : ''}
      </span>`;

    card.querySelector('.card-title').textContent = displayTitle(n);
    card.querySelector('.card-preview').textContent = htmlToText(n.content) || 'Empty note';
    card.querySelector('.when').textContent = fmtDate(n.updatedAt);
    if (folder) card.querySelector('.fname').textContent = folder.name;

    card.onclick = () => openEditor(n.id);
    card.oncontextmenu = (e) => {
      e.preventDefault();
      openNoteContextMenu(n.id, e.clientX, e.clientY);
    };
    wrap.appendChild(card);
  }
}

function emptyState() {
  const el = document.createElement('div');
  el.className = 'empty-state';
  // CTA tạo note chỉ hợp lý khi "trống" nghĩa là chưa có note nào để tạo mới —
  // không hiện khi trống do lọc search/date-range (nên gỡ lọc) hay Favourite (nên đánh sao note có sẵn).
  const showCta = !state.query && state.range === 'all' && (state.view === 'all' || state.view === 'folder');
  const msg =
    state.query ? ['🔍', 'No notes found', `Nothing matches “${state.query}”`]
    : state.range !== 'all' ? ['📭', 'No notes in this time range', 'Try the All tab']
    : state.view === 'favourite' ? ['⭐', 'No favourites yet', 'Open a note and tap ☆ to star it']
    : state.view === 'folder' ? ['📁', 'This folder is empty', 'Create the first note in this folder']
    : ['🗒', 'No notes yet', 'Create your first note to get started'];

  el.innerHTML = `<span class="big">${msg[0]}</span><p><strong>${escapeHtml(msg[1])}</strong></p><p>${escapeHtml(msg[2])}</p>`;

  if (showCta) {
    const folder = state.view === 'folder' ? folderById(state.folderId) : null;
    const btn = document.createElement('button');
    btn.className = 'btn-new empty-state-cta';
    btn.innerHTML = folder
      ? `<span class="plus">+</span> New Note in ${escapeHtml(folder.name)}`
      : '<span class="plus">+</span> New Note';
    btn.onclick = () => createNoteInCurrentView();
    el.appendChild(btn);
  }
  return el;
}

function renderTrash(wrap) {
  const items = trashItems();
  if (!items.length) {
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.innerHTML = '<span class="big">🗑</span><p><strong>Trash is empty</strong></p><p>Deleted notes and folders stay here for 30 days</p>';
    wrap.appendChild(el);
    return;
  }

  for (const { kind, item, deletedAt } of items) {
    const card = document.createElement('div');
    card.className = 'note-card trash-card';
    const left = db.daysLeftInTrash(deletedAt);
    const isFolder = kind === 'folder';
    const childCount = isFolder
      ? state.notes.filter((n) => n.folderId === item.id && n.deletedWithFolderAt === deletedAt).length
      : 0;

    card.innerHTML = `
      <span class="card-title"><span class="type-ico">${isFolder ? '📁' : '🗒'}</span><span class="tname"></span></span>
      <span class="card-preview"></span>
      <span class="card-foot">
        <span>Deleted ${fmtDate(deletedAt)}</span>
        <span class="expiry">· ${plural(left, 'day')} left</span>
      </span>
      <span class="trash-actions">
        <button class="ghost-btn" data-act="restore">Restore</button>
        <button class="ghost-btn danger" data-act="purge">Delete Permanently</button>
      </span>`;

    card.querySelector('.tname').textContent = isFolder ? item.name : displayTitle(item);
    card.querySelector('.card-preview').textContent = isFolder
      ? `Folder · restoring brings back ${plural(childCount, 'note')} deleted with it`
      : htmlToText(item.content) || 'Empty note';

    card.querySelector('[data-act="restore"]').onclick = async () => {
      if (isFolder) {
        await db.restoreFolder(item.id);
        toast(`Restored folder "${item.name}" and ${plural(childCount, 'note')}`);
      } else {
        const restored = await db.restoreNote(item.id);
        const f = restored?.folderId ? folderById(restored.folderId) : null;
        toast(f ? `Restored to folder "${f.name}"` : 'Restored to All Notes');
      }
      await refresh();
      render();
    };

    card.querySelector('[data-act="purge"]').onclick = async () => {
      const ok = await confirmModal({
        title: isFolder ? 'Delete folder permanently?' : 'Delete note permanently?',
        body: isFolder
          ? `<p>Folder <strong>${escapeHtml(item.name)}</strong> and ${plural(childCount, 'note')} inside will be deleted permanently.</p><p class="warn">This cannot be undone.</p>`
          : `<p class="warn">This note will be deleted permanently and cannot be recovered.</p>`,
        confirm: 'Delete permanently',
        danger: true,
      });
      if (!ok) return;
      isFolder ? await db.purgeFolder(item.id) : await db.purgeNote(item.id);
      await refresh();
      render();
    };

    wrap.appendChild(card);
  }
}

function render() {
  renderSidebar();
  renderHead();
  renderList();
}

// ---------------- Shared note actions ----------------
// Dùng chung cho cả nút trên Editor lẫn menu chuột phải trên note-card,
// nên không đụng tới state.editing trực tiếp — tự tra note theo id.

async function toggleFavourite(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  const isFavourite = !note.isFavourite;
  // Favourite độc lập với folder → không đụng vào folderId
  await db.updateNote(id, { isFavourite }, { touch: false });
  await refresh();
  if (state.editing?.id === id) {
    state.editing.isFavourite = isFavourite;
    renderEditorChrome(state.editing);
  } else {
    render();
  }
  toast(isFavourite ? 'Added to Favourite' : 'Removed from Favourite');
}

// Move to Folder — 1 note thuộc tối đa 1 folder
function openMoveModal(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  const current = note.folderId;

  $('#modal-title').textContent = 'Move to Folder';
  const list = liveFolders();
  $('#modal-body').innerHTML =
    `<p>A note belongs to at most 1 folder.</p><div class="modal-list" id="move-list"></div>` +
    (list.length ? '' : '<p style="margin-top:10px">No folders yet — create one in the sidebar first.</p>');

  const wrap = $('#move-list');
  const mk = (label, color, folderId) => {
    const b = document.createElement('button');
    b.className = folderId === current ? 'is-current' : '';
    b.innerHTML = `<span class="swatch" style="background:${color}"></span><span class="l"></span>${folderId === current ? '<span style="margin-left:auto">✓</span>' : ''}`;
    b.querySelector('.l').textContent = label;
    b.onclick = async () => {
      closeModal();
      await db.updateNote(id, { folderId });
      await refresh();
      if (state.editing?.id === id) {
        state.editing.folderId = folderId;
        renderEditorChrome(state.editing);
      } else {
        render();
      }
      toast(folderId ? `Moved to "${label}"` : 'Moved to All Notes');
    };
    return b;
  };

  wrap.appendChild(mk('All Notes (no folder)', '#c9c3b9', null));
  for (const f of list) wrap.appendChild(mk(f.name, FOLDER_COLORS[f.color], f.id));

  const foot = $('#modal-foot');
  foot.innerHTML = '';
  const close = document.createElement('button');
  close.className = 'ghost-btn';
  close.textContent = 'Close';
  close.onclick = closeModal;
  foot.appendChild(close);
  $('#modal-root').hidden = false;
}

async function deleteNoteById(id) {
  const ok = await confirmModal({
    title: 'Delete note?',
    body: '<p>The note moves to Trash and can be restored within 30 days.</p>',
    confirm: 'Delete',
    danger: true,
  });
  if (!ok) return;

  if (state.editing?.id === id) {
    pendingPatch = null;
    clearTimeout(saveTimer);
    state.editing = null;
    $('#editor').hidden = true;
    $('#app').classList.remove('is-hidden');
  }
  await db.softDeleteNote(id);
  await refresh();
  render();
  toast('Note moved to Trash');
}

// ---- Floating panel: dùng chung cho menu chuột phải trên note-card
//      và dropdown chọn nhanh giá trị (Size/Spacing) ----

let floatingMenuEl = null;

function closeFloatingMenu() {
  if (!floatingMenuEl) return;
  floatingMenuEl.remove();
  floatingMenuEl = null;
  document.removeEventListener('click', closeFloatingMenu);
  document.removeEventListener('contextmenu', closeFloatingMenu, true);
  document.removeEventListener('scroll', closeFloatingMenuOnOutsideScroll, true);
  document.removeEventListener('keydown', floatingMenuKeydown);
}

function floatingMenuKeydown(e) {
  if (e.key === 'Escape') closeFloatingMenu();
}

// Listener 'scroll' đăng ký ở capture phase nên bắt được cả sự kiện cuộn xảy ra
// NGAY BÊN TRONG panel (vd danh sách value-picker dài, tự nó overflow-y:auto).
// Phải bỏ qua trường hợp đó, chỉ đóng khi người dùng cuộn nội dung phía SAU panel.
function closeFloatingMenuOnOutsideScroll(e) {
  if (floatingMenuEl && floatingMenuEl.contains(e.target)) return;
  closeFloatingMenu();
}

// x,y là góc trên-trái mong muốn; panel tự ghim lại trong viewport nếu bị tràn mép phải/dưới
function openFloatingMenu(x, y, extraClass, fill) {
  closeFloatingMenu();

  const menu = document.createElement('div');
  menu.className = extraClass ? `ctx-menu ${extraClass}` : 'ctx-menu';
  fill(menu);
  document.body.appendChild(menu);

  const EDGE_GAP = 12; // luôn chừa khoảng cách với mép màn hình, không để panel dán sát lề
  const vw = window.innerWidth, vh = window.innerHeight;
  // Cố tình dùng offsetWidth/offsetHeight thay vì getBoundingClientRect(): panel vừa gắn vào DOM
  // đã bắt đầu chạy animation "pop" (có scale(.98) lúc khởi động), nên rect đo ngay lúc này bị co nhỏ hơn
  // kích thước thật, làm khoảng cách mép bị lệch vài px. offsetWidth/offsetHeight không bị transform ảnh hưởng.
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(EDGE_GAP, Math.min(x, vw - w - EDGE_GAP))}px`;
  menu.style.top = `${Math.max(EDGE_GAP, Math.min(y, vh - h - EDGE_GAP))}px`;

  floatingMenuEl = menu;
  // Trì hoãn 1 tick để chính cú click vừa rồi không lập tức đóng ngay panel mới mở
  setTimeout(() => {
    document.addEventListener('click', closeFloatingMenu);
    document.addEventListener('contextmenu', closeFloatingMenu, true);
    document.addEventListener('scroll', closeFloatingMenuOnOutsideScroll, true);
    document.addEventListener('keydown', floatingMenuKeydown);
  }, 0);
  return menu;
}

function openNoteContextMenu(id, x, y) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;

  openFloatingMenu(x, y, null, (menu) => {
    menu.innerHTML = `
      <button data-act="fav">${note.isFavourite ? '☆ Remove from Favourite' : '⭐ Add to Favourite'}</button>
      <button data-act="move">📁 Move to Folder</button>
      <button class="danger" data-act="delete">🗑 Delete</button>`;
    menu.querySelector('[data-act="fav"]').onclick = () => { closeFloatingMenu(); toggleFavourite(id); };
    menu.querySelector('[data-act="move"]').onclick = () => { closeFloatingMenu(); openMoveModal(id); };
    menu.querySelector('[data-act="delete"]').onclick = () => { closeFloatingMenu(); deleteNoteById(id); };
  });
}

// Chuột-phải vào 1 folder trong sidebar
function openFolderContextMenu(folderId, x, y) {
  const folder = folderById(folderId);
  if (!folder) return;

  openFloatingMenu(x, y, null, (menu) => {
    menu.innerHTML = `
      <button data-act="rename">✏️ Rename</button>
      <button class="danger" data-act="delete">🗑 Delete folder</button>`;
    menu.querySelector('[data-act="rename"]').onclick = () => { closeFloatingMenu(); renameFolder(folderId); };
    menu.querySelector('[data-act="delete"]').onclick = () => { closeFloatingMenu(); deleteFolderById(folderId); };
  });
}

// Dropdown chọn nhanh cho ô nhập số (Size/Spacing) — không thay thế việc gõ tay,
// chỉ là lối tắt: bấm nút mũi tên cạnh ô số để chọn nhanh một giá trị có sẵn.
function openValuePicker(input, values, formatLabel) {
  const toggle = input.parentElement.querySelector('.combo-toggle');
  const r = toggle.getBoundingClientRect();

  openFloatingMenu(r.left, r.bottom + 6, 'value-picker', (menu) => {
    const current = Number(input.value);
    for (const v of values) {
      const b = document.createElement('button');
      b.textContent = formatLabel(v);
      if (v === current) b.classList.add('is-current');
      b.onclick = () => {
        closeFloatingMenu();
        input.value = v;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      menu.appendChild(b);
    }
  });
}

// ---------------- Modals ----------------

function closeModal() { $('#modal-root').hidden = true; }

function confirmModal({ title, body, confirm = 'Confirm', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = body;
    const foot = $('#modal-foot');
    foot.innerHTML = '';

    const no = document.createElement('button');
    no.className = 'ghost-btn';
    no.textContent = cancel;
    no.onclick = () => { closeModal(); resolve(false); };

    const yes = document.createElement('button');
    yes.className = 'btn-primary' + (danger ? ' danger' : '');
    yes.textContent = confirm;
    yes.onclick = () => { closeModal(); resolve(true); };

    foot.append(no, yes);
    $('#modal-root').hidden = false;
    yes.focus();
  });
}

function promptModal({ title, label, value = '', confirm = 'Save', extra = '' }) {
  return new Promise((resolve) => {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = `<p>${escapeHtml(label)}</p><input type="text" id="prompt-input" />${extra}`;
    const input = $('#prompt-input');
    input.value = value;

    const foot = $('#modal-foot');
    foot.innerHTML = '';
    const no = document.createElement('button');
    no.className = 'ghost-btn';
    no.textContent = 'Cancel';
    no.onclick = () => { closeModal(); resolve(null); };
    const yes = document.createElement('button');
    yes.className = 'btn-primary';
    yes.textContent = confirm;
    yes.onclick = () => { closeModal(); resolve(input.value); };
    foot.append(no, yes);

    input.onkeydown = (e) => { if (e.key === 'Enter') yes.click(); };
    $('#modal-root').hidden = false;
    input.focus();
    input.select();
  });
}

$('.modal-backdrop').onclick = closeModal;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modal-root').hidden) closeModal();
});

// Modal tạo folder mới — có chọn màu ngay lúc tạo, khỏi phải mở lại folder để đổi màu sau
function newFolderModal() {
  return new Promise((resolve) => {
    const colorIds = Object.keys(FOLDER_COLORS);
    let selected = colorIds[liveFolders().length % colorIds.length];

    $('#modal-title').textContent = 'New folder';
    $('#modal-body').innerHTML =
      `<p>Folder name</p><input type="text" id="prompt-input" />` +
      `<p style="margin-top:16px">Color</p><div class="swatches" id="new-folder-colors"></div>`;

    const input = $('#prompt-input');
    const picker = $('#new-folder-colors');
    for (const id of colorIds) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'swatch-btn' + (id === selected ? ' is-active' : '');
      dot.style.background = FOLDER_COLORS[id];
      dot.title = id;
      dot.onclick = () => {
        selected = id;
        picker.querySelectorAll('.swatch-btn').forEach((d) => d.classList.remove('is-active'));
        dot.classList.add('is-active');
      };
      picker.appendChild(dot);
    }

    const foot = $('#modal-foot');
    foot.innerHTML = '';
    const no = document.createElement('button');
    no.className = 'ghost-btn';
    no.textContent = 'Cancel';
    no.onclick = () => { closeModal(); resolve(null); };
    const yes = document.createElement('button');
    yes.className = 'btn-primary';
    yes.textContent = 'Create';
    yes.onclick = () => { closeModal(); resolve({ name: input.value, color: selected }); };
    foot.append(no, yes);

    input.onkeydown = (e) => { if (e.key === 'Enter') yes.click(); };
    $('#modal-root').hidden = false;
    input.focus();
  });
}

// ---------------- Folder actions ----------------

$('#btn-new-folder').onclick = async () => {
  const result = await newFolderModal();
  if (!result) return;
  const folder = await db.createFolder(result.name, result.color);
  await refresh();
  state.view = 'folder';
  state.folderId = folder.id;
  render();
};

// Dùng chung cho cả nút Rename/Delete ở header Folder view lẫn menu chuột-phải trên sidebar
async function renameFolder(folderId) {
  const folder = folderById(folderId);
  if (!folder) return;
  const name = await promptModal({ title: 'Rename folder', label: 'Folder name', value: folder.name });
  if (name === null || !name.trim()) return;
  await db.updateFolder(folder.id, { name: name.trim() });
  await refresh();
  render();
}

// Xoá folder → modal cảnh báo rõ số note bị ảnh hưởng (spec bắt buộc)
async function deleteFolderById(folderId) {
  const folder = folderById(folderId);
  if (!folder) return;
  const n = notesInFolder(folder.id).length;
  const ok = await confirmModal({
    title: 'Delete folder?',
    body:
      `<p>Folder <strong>${escapeHtml(folder.name)}</strong> contains <strong>${plural(n, 'note')}</strong>.</p>` +
      (n > 0
        ? `<p class="warn">Deleting this folder also deletes the ${plural(n, 'note')} inside.</p><p>The folder and its ${plural(n, 'note')} move to Trash and can be restored within 30 days.</p>`
        : `<p>The folder moves to Trash and can be restored within 30 days.</p>`),
    confirm: `Delete folder${n ? ` and ${plural(n, 'note')}` : ''}`,
    danger: true,
  });
  if (!ok) return;
  await db.softDeleteFolder(folder.id);
  await refresh();
  // Chỉ điều hướng về All Notes nếu đúng folder đang mở bị xoá; xoá folder khác
  // (vd từ menu chuột-phải trên sidebar) thì giữ nguyên view hiện tại.
  if (state.view === 'folder' && state.folderId === folderId) {
    state.view = 'all';
    state.folderId = null;
  }
  render();
  toast(n ? `Moved folder and ${plural(n, 'note')} to Trash` : 'Moved folder to Trash');
}

$('[data-act="rename"]').onclick = () => renameFolder(state.folderId);
$('[data-act="delete-folder"]').onclick = () => deleteFolderById(state.folderId);

// ---------------- Nav / filters / search ----------------

$$('.nav-item').forEach((btn) => {
  btn.onclick = () => {
    state.view = btn.dataset.view;
    state.folderId = null;
    render();
  };
});

$$('.filter').forEach((btn) => {
  btn.onclick = () => { state.range = btn.dataset.range; render(); };
});

$('#search').oninput = (e) => { state.query = e.target.value; render(); };

$('#btn-empty-trash').onclick = async () => {
  const n = trashItems().length;
  if (!n) return;
  const ok = await confirmModal({
    title: 'Empty Trash?',
    body: `<p>All <strong>${plural(n, 'item')}</strong> in Trash will be deleted permanently, right away.</p><p class="warn">This cannot be undone.</p>`,
    confirm: 'Delete all',
    danger: true,
  });
  if (!ok) return;
  await db.emptyTrash();
  await refresh();
  render();
  toast('Trash emptied');
};

// ---------------- Editor ----------------

const contentEl = $('#note-content');
const titleEl = $('#note-title');

// Dùng chung cho nút "+ New Note" trên header lẫn nút CTA trong empty state
async function createNoteInCurrentView() {
  // Tạo note ngay trong folder đang mở → gán sẵn folderId, không cần move thêm
  const folderId = state.view === 'folder' ? state.folderId : null;
  const note = await db.createNote({ folderId });
  await refresh();
  openEditor(note.id);
  titleEl.focus();
}

$('#btn-new-note').onclick = createNoteInCurrentView;

function openEditor(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  state.editing = { ...note };


  titleEl.value = note.title;
  contentEl.innerHTML = note.content;
  savedContentRange = null; // tránh dính range của note vừa đóng trước đó

  applyNoteStyle(note);
  renderEditorChrome(note);

  $('#app').classList.add('is-hidden');
  $('#editor').hidden = false;
  $('#meta-saved').textContent = 'Saved';
  contentEl.focus();
}

async function closeEditor() {
  await flushSave();          // không mất dữ liệu khi thoát giữa chừng
  state.editing = null;
  $('#editor').hidden = true;
  $('#app').classList.remove('is-hidden');
  await refresh();
  render();
}

$('#btn-back').onclick = closeEditor;

function applyNoteStyle(note) {
  const sheet = $('.editor-sheet');
  sheet.dataset.theme = note.theme || 'default';
  sheet.style.setProperty('--note-font', FONTS[note.font] || FONTS.sans);
  sheet.style.setProperty('--note-size', `${note.fontSize || 16}px`);
  sheet.style.setProperty('--note-lh', note.lineHeight || 1.6);

  setFontTrigger(note.font || 'sans');
  $('#opt-size').value = note.fontSize || 16;
  $('#opt-spacing').value = (note.lineHeight || 1.6).toFixed(1); // luôn hiện đúng 1 chữ số thập phân, vd "1.6" chứ không phải "1.6000000000001"

  $$('.swatch-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.theme === (note.theme || 'default')));
}

function renderEditorChrome(note) {
  const fav = $('#btn-fav');
  fav.textContent = note.isFavourite ? '⭐' : '☆';
  fav.classList.toggle('is-on', note.isFavourite);

  const folder = note.folderId ? folderById(note.folderId) : null;
  $('#btn-move').title = folder ? `Folder: ${folder.name}` : 'Move to Folder';

  $('#meta-dates').textContent = `Created ${fmtDate(note.createdAt)} · Edited ${fmtDate(note.updatedAt)}`;
  updateWordCount();
}

function updateWordCount() {
  const text = htmlToText(contentEl.innerHTML);
  const words = text ? text.split(/\s+/).length : 0;
  $('#meta-words').textContent = plural(words, 'word');
}

// ---- Auto-save (debounce 600ms, không có nút Lưu thủ công) ----

let saveTimer = null;
let pendingPatch = null;

// Vùng bôi đen gần nhất trong note-content — bấm vào ô Size/nút ▾ sẽ chuyển focus
// và huỷ mất selection thật, nên phải lưu lại liên tục qua "selectionchange" để dùng lại sau.
let savedContentRange = null;

function queueSave(patch) {
  if (!state.editing) return;
  pendingPatch = { ...(pendingPatch || {}), ...patch };
  Object.assign(state.editing, patch);

  const saved = $('#meta-saved');
  saved.textContent = 'Saving…';
  saved.classList.add('is-saving');

  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}

async function flushSave() {
  clearTimeout(saveTimer);
  if (!pendingPatch || !state.editing) return;
  const patch = pendingPatch;
  pendingPatch = null;
  const next = await db.updateNote(state.editing.id, patch);
  if (next && state.editing) {
    state.editing.updatedAt = next.updatedAt;
    $('#meta-dates').textContent = `Created ${fmtDate(next.createdAt)} · Edited ${fmtDate(next.updatedAt)}`;
  }
  const saved = $('#meta-saved');
  saved.textContent = 'Saved';
  saved.classList.remove('is-saving');
}

titleEl.oninput = () => queueSave({ title: titleEl.value });
contentEl.oninput = () => { queueSave({ content: contentEl.innerHTML }); updateWordCount(); };

// Lưu nốt khi đóng/refresh tab giữa chừng
window.addEventListener('beforeunload', () => {
  if (pendingPatch && state.editing) {
    clearTimeout(saveTimer);
    db.updateNote(state.editing.id, pendingPatch);
  }
});

// ---- Editor quick actions (dùng lại các hàm dùng chung ở trên) ----

$('#btn-fav').onclick = () => state.editing && toggleFavourite(state.editing.id);
$('#btn-move').onclick = () => state.editing && openMoveModal(state.editing.id);
$('#btn-del-note').onclick = () => state.editing && deleteNoteById(state.editing.id);

$('#btn-panel').onclick = () => $('#panel').classList.toggle('is-hidden');

// ---- Panel: Theme Style ----

const swatchWrap = $('#theme-swatches');
for (const t of THEMES) {
  const b = document.createElement('button');
  b.className = 'swatch-btn';
  b.dataset.theme = t.id;
  b.style.background = t.bg;
  b.title = t.label;
  b.onclick = () => {
    if (!state.editing) return;
    queueSave({ theme: t.id });
    $('.editor-sheet').dataset.theme = t.id;
    $$('.swatch-btn').forEach((x) => x.classList.toggle('is-active', x === b));
  };
  swatchWrap.appendChild(b);
}

// ---- Panel: Text Editor ----

function setFontTrigger(fontId) {
  const trigger = $('#opt-font');
  trigger.dataset.value = fontId;
  trigger.querySelector('.picker-trigger-label').textContent =
    FONT_OPTIONS.find((f) => f.id === fontId)?.label ?? 'Sans';
}

// Panel tự vẽ (giống value-picker) thay cho <select> gốc — mỗi lựa chọn hiện đúng
// kiểu chữ tương ứng để xem trước, và khớp phong cách viền đậm/bóng cứng của cả app.
function openFontPicker() {
  const trigger = $('#opt-font');
  const r = trigger.getBoundingClientRect();
  const current = trigger.dataset.value;

  openFloatingMenu(r.left, r.bottom + 6, null, (menu) => {
    for (const f of FONT_OPTIONS) {
      const b = document.createElement('button');
      b.textContent = f.label;
      b.style.fontFamily = FONTS[f.id];
      if (f.id === current) b.classList.add('is-current');
      b.onclick = () => {
        closeFloatingMenu();
        setFontTrigger(f.id);
        applyFontChange(f.id);
      };
      menu.appendChild(b);
    }
  });
}

$('#opt-font').onclick = openFontPicker;

// Dùng chung cho Size và Font: nếu đang có đoạn văn bản được bôi đen (còn nhớ trong
// savedContentRange) thì chỉ áp dụng riêng cho đoạn đó bằng cách bọc trong 1 <span style="...">,
// không đụng phần còn lại của note. Không có đoạn nào đang chọn thì gọi applyGlobally()
// để giữ hành vi cũ: áp dụng cho mặc định của cả note.
function applyInlineStyleToSelectionOrGlobal(cssProp, cssValue, applyGlobally) {
  const sel = window.getSelection();
  const hasSelection = savedContentRange && !savedContentRange.collapsed;

  if (!hasSelection) {
    applyGlobally();
    return;
  }

  contentEl.focus();
  sel.removeAllRanges();
  sel.addRange(savedContentRange);

  const range = sel.getRangeAt(0);
  const span = document.createElement('span');
  span.style[cssProp] = cssValue;
  span.appendChild(range.extractContents());
  range.insertNode(span);

  // Chọn lại đúng đoạn vừa bọc, để có thể đổi tiếp hoặc thấy rõ vùng vừa áp dụng
  const newRange = document.createRange();
  newRange.selectNodeContents(span);
  sel.removeAllRanges();
  sel.addRange(newRange);
  savedContentRange = newRange.cloneRange();

  queueSave({ content: contentEl.innerHTML });
  updateWordCount();
}

function applyFontSizeChange(v) {
  applyInlineStyleToSelectionOrGlobal('fontSize', `${v}px`, () => {
    queueSave({ fontSize: v });
    $('.editor-sheet').style.setProperty('--note-size', `${v}px`);
  });
}

function applyFontChange(fontId) {
  applyInlineStyleToSelectionOrGlobal('fontFamily', FONTS[fontId], () => {
    queueSave({ font: fontId });
    $('.editor-sheet').style.setProperty('--note-font', FONTS[fontId]);
  });
}

// onchange (không phải oninput) để không ghi đè giá trị đang gõ dở giữa chừng.
// Không giới hạn khoảng giá trị — người dùng gõ số gì cũng được, chỉ chặn
// NaN/rỗng/số ≤ 0 vì font-size hoặc line-height ≤ 0 làm chữ biến mất hẳn, không phải là giới hạn phạm vi.
$('#opt-size').onchange = (e) => {
  let v = Math.round(Number(e.target.value));
  if (!Number.isFinite(v) || v <= 0) v = state.editing?.fontSize || 16;
  e.target.value = v;
  applyFontSizeChange(v);
};

$('#opt-spacing').onchange = (e) => {
  let v = Number(e.target.value);
  if (!Number.isFinite(v) || v <= 0) v = state.editing?.lineHeight || 1.6;
  v = Math.round(v * 10) / 10;
  e.target.value = v.toFixed(1);
  queueSave({ lineHeight: v });
  $('.editor-sheet').style.setProperty('--note-lh', v);
};

// Nút mũi tên cạnh ô số — cách nhanh để chọn mà không cần gõ tay
$('#opt-size-toggle').onclick = () => {
  const sizes = Array.from({ length: 24 - 13 + 1 }, (_, i) => 13 + i);
  openValuePicker($('#opt-size'), sizes, (v) => `${v}px`);
};

$('#opt-spacing-toggle').onclick = () => {
  const spacings = Array.from({ length: 13 }, (_, i) => Math.round((1.2 + i * 0.1) * 10) / 10);
  openValuePicker($('#opt-spacing'), spacings, (v) => v.toFixed(1));
};

// Giữ selection trong contenteditable khi bấm nút trên panel
$$('.fmt, .chip').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));

function exec(cmd, value = null) {
  contentEl.focus();
  document.execCommand(cmd, false, value);
  queueSave({ content: contentEl.innerHTML });
  syncFmtState();
}

$$('.fmt').forEach((b) => { b.onclick = () => exec(b.dataset.cmd); });

function syncFmtState() {
  if ($('#editor').hidden) return;
  // Chỉ phản ánh trạng thái khi con trỏ đang ở trong vùng nội dung,
  // tránh việc caret ở ô tiêu đề (vốn in đậm sẵn) làm nút B sáng nhầm.
  const sel = window.getSelection();
  const inContent = sel.rangeCount && contentEl.contains(sel.anchorNode);
  if (!inContent) {
    $$('.fmt').forEach((b) => b.classList.remove('is-on'));
    return;
  }
  $$('.fmt').forEach((b) => {
    try { b.classList.toggle('is-on', document.queryCommandState(b.dataset.cmd)); } catch { /* ignore */ }
  });

  // Đang có đoạn thật sự được bôi đen trong content -> lưu lại để dùng sau khi
  // focus rời khỏi note-content (vd bấm sang ô Size, selection lúc đó không còn
  // phản ánh đúng nữa). Nhưng nếu selection collapse NGAY TRONG content (người
  // dùng bấm/gõ chỗ khác để chủ động huỷ chọn) thì phải xoá savedContentRange —
  // nếu không, lần đổi Size tiếp theo (tưởng là áp dụng cho cả note) sẽ áp nhầm
  // vào đoạn đã chọn từ trước đó, dán chồng span lên chính nó.
  if (!sel.isCollapsed) {
    savedContentRange = sel.getRangeAt(0).cloneRange();
  } else {
    savedContentRange = null;
  }
}
document.addEventListener('selectionchange', syncFmtState);

// ---- Panel: Others ----

$('#ins-bullet').onclick = () => exec('insertUnorderedList');

$('#ins-link').onclick = async () => {
  const sel = window.getSelection();
  const savedRange = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const url = await promptModal({ title: 'Insert link', label: 'URL address', value: 'https://', confirm: 'Insert' });
  if (!url) return;
  contentEl.focus();
  if (savedRange) {
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  if (sel.isCollapsed) {
    document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}" target="_blank">${escapeHtml(url)}</a>`);
  } else {
    document.execCommand('createLink', false, url);
  }
  queueSave({ content: contentEl.innerHTML });
};

$('#ins-image').onclick = () => $('#image-input').click();

$('#image-input').onchange = (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    contentEl.focus();
    document.execCommand('insertImage', false, reader.result);
    queueSave({ content: contentEl.innerHTML });
  };
  reader.readAsDataURL(file);
  e.target.value = '';
};

const emojiGrid = $('#emoji-grid');
for (const em of EMOJIS) {
  const b = document.createElement('button');
  b.textContent = em;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.onclick = () => exec('insertText', em);
  emojiGrid.appendChild(b);
}
$('#ins-emoji').onclick = () => { emojiGrid.hidden = !emojiGrid.hidden; };

// ---------------- Boot ----------------

async function boot() {
  await db.purgeExpired();   // auto-purge Trash quá 30 ngày, chạy mỗi lần mở app
  await seedIfEmpty();       // nạp dữ liệu mẫu, chỉ ở lần mở app đầu tiên
  await refresh();
  render();
}

boot();

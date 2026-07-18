import * as db from '../db.js';
import { $, $$ } from './dom.js';
import { state } from './state.js';
import { refresh } from './queries.js';
import { render } from './render.js';
import { THEMES, FONTS, FONT_OPTIONS, EMOJIS, NOTE_ICONS } from './constants.js';
import { fmtDate, plural, escapeHtml, htmlToText } from './utils.js';
import { folderById } from './queries.js';
import { toggleFavourite, openMoveModal, deleteNoteById } from './noteActions.js';
import { openFloatingMenu, closeFloatingMenu, openValuePicker } from './floatingMenu.js';
import { promptModal } from './modals.js';

// ---------------- Editor ----------------

const contentEl = $('#note-content');
const titleEl = $('#note-title');

// Dùng chung cho nút "+ New Note" trên header lẫn nút CTA trong empty state
export async function createNoteInCurrentView() {
  // Tạo note ngay trong folder đang mở → gán sẵn folderId, không cần move thêm
  const folderId = state.view === 'folder' ? state.folderId : null;
  const note = await db.createNote({ folderId });
  await refresh();
  openEditor(note.id);
  titleEl.focus();
}

$('#btn-new-note').onclick = createNoteInCurrentView;

export function openEditor(id) {
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

// Dùng khi 1 note bị xoá (từ menu chuột-phải hoặc nút trong Editor) đúng lúc đang mở
// trong Editor — huỷ autosave đang chờ để không ghi đè lên note vừa chuyển vào Trash,
// rồi ẩn Editor. Không gọi closeEditor() vì hàm đó sẽ flush nốt bản patch đang chờ.
export function abandonEditorFor(id) {
  if (state.editing?.id !== id) return;
  pendingPatch = null;
  clearTimeout(saveTimer);
  state.editing = null;
  $('#editor').hidden = true;
  $('#app').classList.remove('is-hidden');
}

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
  setIconTrigger(note.icon || null);
}

export function renderEditorChrome(note) {
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

// ---- Note icon (shown next to the title) ----

function setIconTrigger(icon) {
  const btn = $('#note-icon-btn');
  btn.textContent = icon || '🏷';
  btn.classList.toggle('is-set', !!icon);
}

function openIconPicker() {
  const trigger = $('#note-icon-btn');
  const r = trigger.getBoundingClientRect();
  const current = state.editing?.icon || null;

  openFloatingMenu(r.left, r.bottom + 6, 'icon-picker', (menu) => {
    const noneBtn = document.createElement('button');
    noneBtn.textContent = 'No icon';
    if (!current) noneBtn.classList.add('is-current');
    noneBtn.onclick = () => {
      closeFloatingMenu();
      setIconTrigger(null);
      queueSave({ icon: null });
    };
    menu.appendChild(noneBtn);

    const grid = document.createElement('div');
    grid.className = 'icon-grid';
    for (const ic of NOTE_ICONS) {
      const b = document.createElement('button');
      b.textContent = ic;
      if (ic === current) b.classList.add('is-current');
      b.onclick = () => {
        closeFloatingMenu();
        setIconTrigger(ic);
        queueSave({ icon: ic });
      };
      grid.appendChild(b);
    }
    menu.appendChild(grid);
  });
}

$('#note-icon-btn').onclick = openIconPicker;

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

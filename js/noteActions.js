import * as db from '../db.js';
import { $ } from './dom.js';
import { state } from './state.js';
import { refresh, folderById, liveFolders } from './queries.js';
import { render } from './render.js';
import { renderEditorChrome, abandonEditorFor } from './editor.js';
import { FOLDER_COLORS } from './constants.js';
import { toast } from './utils.js';
import { confirmModal } from './modals.js';
import { openFloatingMenu, closeFloatingMenu } from './floatingMenu.js';

// ---------------- Shared note actions ----------------
// Dùng chung cho cả nút trên Editor lẫn menu chuột phải trên note-card,
// nên không đụng tới state.editing trực tiếp — tự tra note theo id.

export async function toggleFavourite(id) {
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
export function openMoveModal(id) {
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
      closeModalRef();
      // updateNote đổi folder => file chuyển thư mục => id (đường dẫn) đổi theo.
      const moved = await db.updateNote(id, { folderId });
      await refresh();
      if (state.editing?.id === id) {
        state.editing.id = moved?.id ?? id;
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
  close.onclick = closeModalRef;
  foot.appendChild(close);
  $('#modal-root').hidden = false;
}

function closeModalRef() { $('#modal-root').hidden = true; }

export async function deleteNoteById(id) {
  const ok = await confirmModal({
    title: 'Delete note?',
    body: '<p>The note moves to Trash and can be restored within 30 days.</p>',
    confirm: 'Delete',
    danger: true,
  });
  if (!ok) return;

  abandonEditorFor(id);
  await db.softDeleteNote(id);
  await refresh();
  render();
  toast('Note moved to Trash');
}

export function openNoteContextMenu(id, x, y) {
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

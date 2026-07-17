import * as db from '../db.js';
import { $, $$ } from './dom.js';
import { state } from './state.js';
import { FOLDER_COLORS } from './constants.js';
import { fmtDate, plural, escapeHtml, displayTitle, htmlToText, toast } from './utils.js';
import {
  refresh, liveFolders, folderById,
  notesAll, notesInFolder, notesFavourite, visibleNotes, trashItems,
} from './queries.js';
import { confirmModal } from './modals.js';
import { openNoteContextMenu } from './noteActions.js';
import { openFolderContextMenu } from './folderActions.js';
import { openEditor, createNoteInCurrentView } from './editor.js';

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

export function render() {
  renderSidebar();
  renderHead();
  renderList();
}

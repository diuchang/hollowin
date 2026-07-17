import * as db from '../db.js';
import { $ } from './dom.js';
import { state } from './state.js';
import { refresh, folderById, notesInFolder } from './queries.js';
import { render } from './render.js';
import { promptModal, confirmModal, newFolderModal } from './modals.js';
import { plural, escapeHtml, toast } from './utils.js';
import { openFloatingMenu, closeFloatingMenu } from './floatingMenu.js';

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
export async function renameFolder(folderId) {
  const folder = folderById(folderId);
  if (!folder) return;
  const name = await promptModal({ title: 'Rename folder', label: 'Folder name', value: folder.name });
  if (name === null || !name.trim()) return;
  await db.updateFolder(folder.id, { name: name.trim() });
  await refresh();
  render();
}

// Xoá folder → modal cảnh báo rõ số note bị ảnh hưởng (spec bắt buộc)
export async function deleteFolderById(folderId) {
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

// Chuột-phải vào 1 folder trong sidebar
export function openFolderContextMenu(folderId, x, y) {
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

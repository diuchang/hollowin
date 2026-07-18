import { $ } from './dom.js';
import { escapeHtml } from './utils.js';
import { FOLDER_COLORS, FOLDER_ICONS } from './constants.js';
import { liveFolders } from './queries.js';

// ---------------- Modals ----------------

export function closeModal() { $('#modal-root').hidden = true; }

export function confirmModal({ title, body, confirm = 'Confirm', cancel = 'Cancel', danger = false }) {
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

export function promptModal({ title, label, value = '', confirm = 'Save', extra = '' }) {
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

// Dùng chung cho modal "New folder" (tạo mới) và "Edit folder" (đổi tên + màu/icon cùng lúc).
// Folder hiển thị bằng icon nếu người dùng chọn, không thì hiện chấm màu — nên icon là tuỳ chọn.
function folderFormModal({ title, confirm, name = '', color, icon = null }) {
  return new Promise((resolve) => {
    const colorIds = Object.keys(FOLDER_COLORS);
    let selectedColor = color ?? colorIds[liveFolders().length % colorIds.length];
    let selectedIcon = icon;

    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML =
      `<p>Folder name</p><input type="text" id="prompt-input" />` +
      `<p style="margin-top:16px">Color</p><div class="swatches" id="folder-form-colors"></div>` +
      `<p style="margin-top:16px">Icon <span class="hint">(optional)</span></p><div class="folder-icons" id="folder-form-icons"></div>`;

    const input = $('#prompt-input');
    input.value = name;

    const colorPicker = $('#folder-form-colors');
    for (const id of colorIds) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'swatch-btn' + (id === selectedColor ? ' is-active' : '');
      dot.style.background = FOLDER_COLORS[id];
      dot.title = id;
      dot.onclick = () => {
        selectedColor = id;
        colorPicker.querySelectorAll('.swatch-btn').forEach((d) => d.classList.remove('is-active'));
        dot.classList.add('is-active');
      };
      colorPicker.appendChild(dot);
    }

    const iconPicker = $('#folder-form-icons');
    const markIcon = () =>
      iconPicker.querySelectorAll('button').forEach((b) =>
        b.classList.toggle('is-active', (b.dataset.icon || null) === selectedIcon)
      );

    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'folder-icon-btn none';
    none.textContent = 'None';
    none.onclick = () => { selectedIcon = null; markIcon(); };
    iconPicker.appendChild(none);

    for (const ic of FOLDER_ICONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'folder-icon-btn';
      b.dataset.icon = ic;
      b.textContent = ic;
      b.onclick = () => { selectedIcon = ic; markIcon(); };
      iconPicker.appendChild(b);
    }
    markIcon();

    const foot = $('#modal-foot');
    foot.innerHTML = '';
    const no = document.createElement('button');
    no.className = 'ghost-btn';
    no.textContent = 'Cancel';
    no.onclick = () => { closeModal(); resolve(null); };
    const yes = document.createElement('button');
    yes.className = 'btn-primary';
    yes.textContent = confirm;
    yes.onclick = () => { closeModal(); resolve({ name: input.value, color: selectedColor, icon: selectedIcon }); };
    foot.append(no, yes);

    input.onkeydown = (e) => { if (e.key === 'Enter') yes.click(); };
    $('#modal-root').hidden = false;
    input.focus();
    input.select();
  });
}

export const newFolderModal = () => folderFormModal({ title: 'New folder', confirm: 'Create' });

export const editFolderModal = (folder) =>
  folderFormModal({ title: 'Edit folder', confirm: 'Save', name: folder.name, color: folder.color, icon: folder.icon });

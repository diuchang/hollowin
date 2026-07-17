import { $ } from './dom.js';
import { escapeHtml } from './utils.js';
import { FOLDER_COLORS } from './constants.js';
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

// Modal tạo folder mới — có chọn màu ngay lúc tạo, khỏi phải mở lại folder để đổi màu sau
export function newFolderModal() {
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

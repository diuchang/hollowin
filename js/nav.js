import * as db from '../db.js';
import { $, $$ } from './dom.js';
import { state } from './state.js';
import { render } from './render.js';
import { refresh, trashItems } from './queries.js';
import { confirmModal } from './modals.js';
import { plural, toast } from './utils.js';

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

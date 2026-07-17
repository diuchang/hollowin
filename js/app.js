import { seedIfEmpty } from '../seed.js';
import * as db from '../db.js';
import { refresh } from './queries.js';
import { render } from './render.js';

// Side-effect imports: các module này tự gắn event listener lên DOM ngay khi
// được load (nút New folder, Rename/Delete folder, nav/filter/search, toàn bộ Editor).
import './modals.js';
import './folderActions.js';
import './nav.js';
import './editor.js';

// ---------------- Boot ----------------

async function boot() {
  await db.purgeExpired();   // auto-purge Trash quá 30 ngày, chạy mỗi lần mở app
  await seedIfEmpty();       // nạp dữ liệu mẫu, chỉ ở lần mở app đầu tiên
  await refresh();
  render();
}

boot();

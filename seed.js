// Dữ liệu mẫu có sẵn — chỉ nạp MỘT LẦN, khi database còn hoàn toàn trống.
// Sau lần đầu, mọi thay đổi của người dùng là nguồn duy nhất; file này không ghi đè gì nữa.

import * as db from './db.js';

const FLAG = 'notes:seeded';
const DAY = 864e5;
const ago = (days) => Date.now() - days * DAY;

const FOLDERS = [
  { key: 'diary',   name: 'Diary',   color: 'blue' },
  { key: 'ideas',   name: 'Ideas',   color: 'purple' },
  { key: 'work',    name: 'Work',    color: 'green' },
  { key: 'reading', name: 'Reading', color: 'yellow' },
];

// days = số ngày trước tính từ lúc mở app lần đầu → Today/This Week/This Month luôn có dữ liệu hợp lý
const NOTES = [
  {
    folder: 'diary', days: 0, theme: 'blue', font: 'serif',
    title: 'First rain of the season',
    content:
      '<p>It rained all afternoon and the whole street smelled like wet earth. I sat by the window with a coffee and did <i>absolutely nothing</i> for an hour.</p>' +
      '<p>Days like this are worth writing down.</p>',
  },
  {
    folder: 'diary', days: 0, fav: true,
    title: 'A small win',
    content:
      '<p>Finally finished the thing I had been putting off for <b>three weeks</b>. It took forty minutes.</p>' +
      '<p>Note to self: the waiting is always heavier than the work. 🙏</p>',
  },
  {
    folder: 'diary', days: 3, font: 'hand',
    title: 'Sunday morning',
    content:
      '<p>Woke up early without an alarm. Walked to the market, bought too much fruit, came home and cooked properly for once.</p>' +
      '<p>Quiet weekend. No plans. ☕</p>',
  },
  {
    folder: 'ideas', days: 0, fav: true, theme: 'purple',
    title: 'App idea: habit tracker',
    content:
      '<p>Something <b>very small</b> — one screen, no accounts, no streaks-guilt.</p>' +
      '<ul><li>Tap a dot for the day, that is the whole interaction</li>' +
      '<li>Local storage only, no sync</li>' +
      '<li>Monthly grid view so you see the shape of a habit</li></ul>' +
      '<p>The market is crowded, but everything out there is bloated.</p>',
  },
  {
    folder: 'ideas', days: 10,
    title: 'Weekend project list',
    content:
      '<ul><li>Fix the squeaky drawer 🔧</li><li>Digitise the old photo box</li>' +
      '<li>Learn enough about bread to stop buying it</li><li>Repaint the bookshelf</li></ul>',
  },
  {
    folder: 'work', days: 0,
    title: 'Meeting notes — Q3 planning',
    content:
      '<p><b>Decisions</b></p>' +
      '<ul><li>Ship the onboarding rewrite before the end of August</li>' +
      '<li>Hold the pricing change until we have the survey back</li></ul>' +
      '<p><b>Open questions</b></p>' +
      '<ul><li>Who owns the migration script?</li><li>Do we need a second designer for Q4?</li></ul>',
  },
  {
    folder: 'work', days: 2, theme: 'green',
    title: 'Things to follow up',
    content:
      '<ul><li>Send the revised estimate to Mai</li><li>Book the room for Thursday</li>' +
      '<li>Ask about the laptop budget 💰</li></ul>',
  },
  {
    folder: 'reading', days: 0, fav: true, theme: 'yellow', font: 'serif',
    title: 'Quotes I liked',
    content:
      '<p><i>"The best time to plant a tree was twenty years ago. The second best time is now."</i></p>' +
      '<p>Kept coming back to this one all week. ✨</p>',
  },
  {
    folder: 'reading', days: 40,
    title: 'Books to read this year',
    content:
      '<ul><li>The Sense of Style — Steven Pinker</li><li>Piranesi — Susanna Clarke</li>' +
      '<li>The Design of Everyday Things (reread)</li><li>Project Hail Mary</li></ul>' +
      '<p>Four is realistic. Twelve was not. 📚</p>',
  },
  {
    folder: null, days: 0,
    title: 'Quick thought',
    content: '<p>If a note takes longer to file than to write, the filing system is wrong.</p>',
  },
  {
    folder: null, days: 5,
    title: 'Groceries',
    content: '<ul><li>Coffee beans</li><li>Rice</li><li>Eggs</li><li>Something green 🌱</li></ul>',
  },
  // 1 note nằm sẵn trong Trash để thấy được cơ chế khôi phục
  {
    folder: null, days: 1, trashedDaysAgo: 1,
    title: 'Old draft',
    content: '<p>Half a paragraph that went nowhere.</p>',
  },
];

/**
 * Nạp dữ liệu mẫu nếu đây là lần mở app đầu tiên.
 * Trả về true nếu vừa nạp, false nếu bỏ qua (đã có dữ liệu hoặc đã nạp trước đó).
 */
export async function seedIfEmpty() {
  // Đã nạp rồi → không bao giờ nạp lại, kể cả khi người dùng xoá sạch note.
  if (localStorage.getItem(FLAG)) return false;

  const [notes, folders] = await Promise.all([db.getAllNotes(), db.getAllFolders()]);
  if (notes.length || folders.length) {
    // notes/ đã có sẵn dữ liệu → đánh dấu để khỏi đụng vào.
    localStorage.setItem(FLAG, '1');
    return false;
  }

  // Sidebar sắp folder theo createdAt. Tạo liên tiếp trong cùng một mili-giây thì thứ tự
  // sẽ tuỳ hên xui, nên phải giãn mốc tạo ra để giữ đúng thứ tự khai báo ở trên.
  const folderId = {};
  const base = Date.now();
  for (const [i, f] of FOLDERS.entries()) {
    const created = await db.createFolder(f.name, f.color);
    await db.updateFolder(created.id, { createdAt: base + i });
    folderId[f.key] = created.id;
  }

  for (const n of NOTES) {
    const created = await db.createNote({ folderId: n.folder ? folderId[n.folder] : null });

    // updateNote có thể đổi tên/đường dẫn file khi title đổi → phải dùng id nó trả về
    // cho các lần cập nhật tiếp theo, không giữ id cũ.
    const at = ago(n.days ?? 0);
    const saved = await db.updateNote(created.id, {
      title: n.title,
      content: n.content,
      isFavourite: !!n.fav,
      theme: n.theme || 'default',
      font: n.font || 'sans',
      fontSize: n.fontSize || 16,
      lineHeight: n.lineHeight || 1.6,
      createdAt: at - 2 * 3600e3,
      updatedAt: at,
    }, { touch: false });

    // Note mẫu nằm sẵn trong Trash → chuyển file vào .trash/ đúng cơ chế thật.
    if (n.trashedDaysAgo != null) {
      await db.softDeleteNote(saved.id, { deletedAt: ago(n.trashedDaysAgo) });
    }
  }

  localStorage.setItem(FLAG, '1');
  return true;
}

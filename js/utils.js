import { $ } from './dom.js';

// ---------------- Utils ----------------

// Chèn khoảng trắng ở ranh giới block, nếu không "<p>a</p><p>b</p>" sẽ dính thành "ab"
// (ảnh hưởng cả preview trên card lẫn số từ trong Editor).
export const htmlToText = (html) => {
  const d = document.createElement('div');
  d.innerHTML = (html || '').replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote)\s*\/?>/gi, ' ');
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
};

export const displayTitle = (note) => {
  if (note.title.trim()) return note.title.trim();
  const text = htmlToText(note.content);
  return text ? text.slice(0, 60) : 'Untitled note';
};

export const fmtDate = (ts) => {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return `Today ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function rangeStart(range) {
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

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

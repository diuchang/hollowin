// ---------------- State ----------------

export const state = {
  view: 'all',        // 'all' | 'folder' | 'favourite' | 'insights' | 'trash'
  folderId: null,
  range: 'all',       // 'all' | 'today' | 'week' | 'month'
  query: '',
  notes: [],
  folders: [],
  insights: null,     // { html, updatedAt } | null — bản phân tích do skill ghi ra
  editing: null,      // note đang mở trong Editor
};

// ---------------- State ----------------

export const state = {
  view: 'all',        // 'all' | 'folder' | 'favourite' | 'trash'
  folderId: null,
  range: 'all',       // 'all' | 'today' | 'week' | 'month'
  query: '',
  notes: [],
  folders: [],
  editing: null,      // note đang mở trong Editor
};

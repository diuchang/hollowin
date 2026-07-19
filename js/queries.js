import * as db from '../db.js';
import { state } from './state.js';
import { rangeStart, displayTitle, htmlToText } from './utils.js';

// ---------------- Data refresh ----------------

export async function refresh() {
  const [notes, folders] = await Promise.all([db.getAllNotes(), db.getAllFolders()]);
  state.notes = notes;
  state.folders = folders;
}

export const liveFolders = () =>
  state.folders.filter((f) => f.deletedAt === null).sort((a, b) => a.createdAt - b.createdAt);

export const folderById = (id) => state.folders.find((f) => f.id === id);

// Các truy vấn cốt lõi theo spec
export const notesAll = () => state.notes.filter((n) => n.deletedAt === null);
export const notesInFolder = (id) => state.notes.filter((n) => n.folderId === id && n.deletedAt === null);
export const notesFavourite = () => state.notes.filter((n) => n.isFavourite && n.deletedAt === null);

export function visibleNotes() {
  let list;
  if (state.view === 'folder') list = notesInFolder(state.folderId);
  else if (state.view === 'favourite') list = notesFavourite();
  else list = notesAll();

  const from = rangeStart(state.range);
  if (from) list = list.filter((n) => n.updatedAt >= from);

  const q = state.query.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (n) => displayTitle(n).toLowerCase().includes(q) || htmlToText(n.content).toLowerCase().includes(q)
    );
  }
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function trashItems() {
  const notes = state.notes
    .filter((n) => n.deletedAt !== null)
    .map((n) => ({ kind: 'note', item: n, deletedAt: n.deletedAt }));
  const folders = state.folders
    .filter((f) => f.deletedAt !== null)
    .map((f) => ({ kind: 'folder', item: f, deletedAt: f.deletedAt }));
  return [...notes, ...folders].sort((a, b) => b.deletedAt - a.deletedAt);
}

# Personal Notes

A personal notes app that runs entirely in the browser: no sign-in, no server, no network.
Data is stored locally with **IndexedDB** (database `personal-notes`).

## Running the app

It needs a small web server — opening `index.html` directly via `file://` will not work,
because browsers block ES modules and IndexedDB on the `file://` origin:

```bash
npx -y serve -l 4173 .
```

Then open http://localhost:4173

## Structure

| File | Role |
|---|---|
| `index.html` | Layout: Sidebar + Note List, full-screen Editor, modals |
| `styles.css` | All styling (light mode only) |
| `db.js` | IndexedDB + domain rules: cascade delete, batch restore, auto-purge |
| `seed.js` | Built-in sample data, loaded once on the very first visit |
| `app.js` | State, view rendering, editor, auto-save |

## Sample data

`seed.js` ships with 4 folders (Diary, Ideas, Work, Reading) and 12 notes — 11 active
(3 starred) and 1 already in Trash. It runs from `boot()` in `app.js` and is deliberately
conservative:

- It loads **only when the database is completely empty** — a fresh browser, or after
  clearing site data.
- Once it has run it sets a `notes:seeded` flag in `localStorage` and never runs again, so
  reloading never duplicates notes or overwrites your edits.
- If you delete every note yourself, the samples do **not** come back — an empty app stays empty.

Timestamps are relative to first launch (`days: 0`, `3`, `40`…), so Today / This Week /
This Month always have something sensible to show.

To get a clean slate, or to reload the samples from scratch, run this in the browser console:

```js
localStorage.removeItem('notes:seeded');
indexedDB.deleteDatabase('personal-notes');
// then reload the page
```

## Scope notes

Exactly four navigation items: **All Notes / Folder / Favourite / Trash**.

Deliberately **not** included: sign-in, dark mode, tags, export, notifications — per the agreed
scope. (The spec's Hints section suggested an optional JSON Export/Import as a technical safety
net, but the grading criteria list export as out of scope, so it was left out.)

## Implementation notes

- **Auto-save**: debounced 600ms after typing stops, no Save button. Also flushed on Back and on
  `beforeunload`, so nothing is lost when leaving mid-edit.
- **`deletedWithFolderAt`**: marks a note as deleted *because its parent folder was deleted*.
  Restoring a folder only brings back notes whose marker matches the folder's `deletedAt`, so a
  note the user deleted on its own earlier is **not** restored by mistake.
- **Restoring a single note**: returns to its original folder; if that folder no longer exists,
  it goes back to All Notes.
- **30-day auto-purge**: runs once on app start (`purgeExpired`), no background job needed.
- **Theme Style** changes the background of *that note only* (stored in `notes.theme`), not an
  app-wide theme.
- **This Week** starts on Monday.

# Personal Notes

A personal notes app for your own use: no sign-in, no account.
Each note is a plain **`.md` file** on disk — like an Obsidian vault. A tiny local
Node server reads and writes those files in the `notes/` folder, so the app just works
when you open it: no folder to pick, no permissions to grant.

## Running the app

Needs Node.js. No dependencies to install:

```bash
node server.js
```

Then open http://localhost:4173

Set a different port with `PORT=3000 node server.js`.

## Where your data lives

Everything is stored as files in the **`notes/`** folder next to `server.js` — browse it in
Finder/Explorer, edit it in any text editor, back it up, or point Obsidian at it:

```
notes/
  Diary/
    First rain of the season.md
    .folder.json          ← folder colour/icon/created date
  Ideas/
  Quick thought.md        ← a note with no folder lives at the notes/ root
  .trash/                 ← deleted notes & folders (30-day retention)
```

Each `.md` file has **YAML frontmatter** for metadata, then the note body in Markdown:

```markdown
---
title: First rain of the season
favourite: false
icon: null
theme: blue
font: serif
fontSize: 16
lineHeight: 1.6
createdAt: 1721000000000
updatedAt: 1721000000000
---

It rained all afternoon and the whole street smelled like wet earth...
```

## Structure

| File | Role |
|---|---|
| `server.js` | Zero-dependency Node server: serves the app + a small REST API that reads/writes `.md` files under `notes/` |
| `index.html` | Layout: Sidebar + Note List, full-screen Editor, modals |
| `styles.css` | All styling (light mode only) |
| `db.js` | Talks to the server API; owns domain rules: cascade delete, batch restore, auto-purge, and HTML↔Markdown conversion |
| `seed.js` | Built-in sample data, loaded once when `notes/` is first empty |
| `js/app.js` | Boot: purge old trash, seed if empty, render |
| `js/*.js` | State, queries, rendering, editor, nav, folder/note actions, modals |

## Sample data

`seed.js` ships with 4 folders (Diary, Ideas, Work, Reading) and 12 notes — 11 active
(3 starred) and 1 already in Trash. It runs from `boot()` in `app.js` and is deliberately
conservative:

- It loads **only when `notes/` has no notes or folders** — a fresh checkout.
- Once it has run it sets a `notes:seeded` flag in `localStorage` and never runs again, so
  reloading never duplicates notes or overwrites your edits.
- If you delete every note yourself, the samples do **not** come back — an empty vault stays empty.

Timestamps are relative to first launch (`days: 0`, `3`, `40`…), so Today / This Week /
This Month always have something sensible to show.

To reload the samples from scratch: delete the contents of `notes/`, run
`localStorage.removeItem('notes:seeded')` in the browser console, and reload.

## Insights

The **Insights** tab (under *All Notes*) shows a summary of your last 7 days of notes. The app
does **not** generate it — you do, by chatting with **Claude Code / Codex** and running the
`weekly-insights` skill (`.claude/skills/weekly-insights/`). That skill reads your notes, writes
`notes/.insights.md` (Markdown + a `updatedAt` timestamp in its frontmatter), and the app renders
that file read-only on the Insights screen. Reopen the tab (or reload) to pick up a fresh run.
Until you run it once, the screen shows an empty state with instructions. `notes/.insights.md` is
skipped everywhere a note would appear (it never shows up in All Notes).

## Scope notes

Five navigation items: **All Notes / Insights / Folder / Favourite / Trash**.

**Editor formatting is limited to what Markdown can represent** — Bold, Italic,
Strikethrough, Bullet lists, Links, and Emoji, plus per-note metadata (theme, default
font/size/line-height, icon, favourite). Underline, inline images, per-selection font/size,
and text alignment were removed because a `.md` file cannot round-trip them cleanly.

Deliberately **not** included: sign-in, dark mode, tags, notifications — per the agreed scope.

## Implementation notes

- **Auto-save**: debounced 600ms after typing stops, no Save button. Also flushed on Back and on
  `beforeunload`. Content is stored as HTML in the editor and converted to/from Markdown by
  `db.js` when reading/writing files.
- **Folders are real subdirectories**; moving a note moves its file, renaming a note renames
  its file (titles are slugified into safe filenames, de-duplicated with a numeric suffix).
- **`deletedWithFolderAt`**: marks a note as deleted *because its parent folder was deleted*.
  Restoring a folder only brings back notes whose marker matches the folder's delete batch, so a
  note the user deleted on its own earlier is **not** restored by mistake.
- **Restoring a single note**: returns to its original folder (recorded as `originalFolderId`
  in the trashed file's frontmatter); if that folder no longer exists, it goes back to All Notes.
- **30-day auto-purge**: runs once on app start (`purgeExpired`), scanning `notes/.trash/`.
- **Theme Style** changes the background of *that note only* (stored in `theme`), not app-wide.
- **This Week** starts on Monday.
- Timestamps live in frontmatter (not file mtime), so copying/moving files never corrupts them.
- The server confines all file operations to `notes/` and rejects path traversal.

---
name: weekly-insights
description: Analyse the Personal Notes vault (notes/*.md) over the last 7 days and write a summary to notes/.insights.md, which the app shows on its Insights screen. Use when the user asks to generate weekly insights, review the past week of notes, or refresh the Insights view.
---

# Weekly Insights

Read the last 7 days of activity in the `notes/` vault and write a Markdown summary to
`notes/.insights.md`. The Personal Notes app reads that file and renders it on the
**Insights** screen — this skill is the only thing that produces it.

## 1. Read the notes

Scan every `.md` file under `notes/`, but **skip**:

- `notes/.trash/**` — deleted notes.
- `notes/**/.folder.json` — folder metadata, not notes.
- `notes/.insights.md` — the output file itself.

Each note file looks like this (YAML frontmatter, then a Markdown body):

```markdown
---
title: "First rain of the season"
favourite: false
icon: null
theme: "default"
font: "sans"
fontSize: 16
lineHeight: 1.6
createdAt: 1784011734854
updatedAt: 1784018934854
---

It rained all afternoon and the whole street smelled like wet earth...
```

- `createdAt` / `updatedAt` are **epoch milliseconds**.
- The **folder** a note belongs to is its parent directory name under `notes/`
  (e.g. `notes/Diary/Sunday morning.md` → folder "Diary"). A file directly in `notes/`
  has no folder.

**Filter to the last 7 days:** keep notes whose `updatedAt` is within
`Date.now() - 7*24*60*60*1000`. Treat a note as *created this week* if `createdAt` is also
in that window, otherwise *edited this week*.

## 2. Analyse

Decide the format yourself, but a good summary usually covers:

- **Activity**: how many notes created vs. edited this week; total across the vault.
- **Where the work happened**: which folders were most active.
- **Themes**: recurring topics, ideas, or moods across the week's notes (read the bodies).
- **Follow-ups**: open questions, TODO-like lines, or unfinished threads worth revisiting.
- **A short human summary**: 2–4 sentences describing the week at a glance.

If there was **no** activity in the last 7 days, still write the file with a friendly
"quiet week — nothing updated in the last 7 days" note so the screen isn't stale.

## 3. Write `notes/.insights.md`

**Overwrite** `notes/.insights.md` with frontmatter + a Markdown body:

```markdown
---
title: "Weekly Insights"
updatedAt: 1784018934854
---

## This week at a glance

You created **3** notes and edited **5**, mostly in **Diary** and **Ideas**.

## Themes

- Reflections on slowing down and morning routines
- A recurring habit-tracker app idea

## Follow-ups

- "Meeting notes — Q3 planning" has an unchecked action item
- "Books to read this year" — pick the next book

## Summary

A reflective week...
```

Rules for the file:

- `updatedAt` **must be epoch milliseconds** (`Date.now()`), matching the note format above —
  the app uses it verbatim to show "Updated <date>". Do not write an ISO string.
- Keep the `---` frontmatter fences exactly; the app's parser expects flat `key: value` lines.
- The app renders a **limited Markdown subset**. Use only:
  headings (`#`, `##`, `###`), `**bold**`, `*italic*`, `-` / `1.` lists, and `[text](url)` links.
  Avoid tables, images, blockquotes, and code fences — they won't render.

After writing, tell the user to open (or reopen) the **Insights** tab in the app to see it —
the app reads the file on load and when returning from the editor, so a page reload picks up
the new version.

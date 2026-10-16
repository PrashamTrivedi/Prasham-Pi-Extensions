# Spec 3 — Duck interactivity + panel

Parent: `taskNotes/mods-ui-polish/taskFindings.md`. Depends on Spec 1.

## Deliverable

`extensions/duck/index.ts`:

- `duckKeyAction(data)` using `matchesKey`:
  - `close` ← escape, ctrl+c, q
  - `lineUp` ← up, k; `lineDown` ← down, j
  - `pageUp` ← pageup; `pageDown` ← pagedown
  - `home` ← home, g; `end` ← end, G
- `handleInput` dispatches the action; no raw byte comparisons.
- Rendering through the shared `renderPanel`: title `duck`, right
  `provider/model · <spinner|in N / out M|error>`, footer hint
  `↑↓ scroll · PgUp/PgDn · g/G · esc close` plus `lines A–B of N`.
- Auto-follow while streaming; scrolling up pauses; `end`/`G` resumes.
- Module-level open-panel handle so `/duck` closes an open panel.

## Files

- Changed: `extensions/duck/index.ts`, `tests/duck/run.test.ts`.

## Tests

- `accumulateDuck` behavior unchanged (existing tests stay green).
- `duckKeyAction` maps legacy and Kitty sequences identically:
  `\x1b`/`\x1b[27u` → close; `\x1b[A`/`\x1b[1;1A` → lineUp;
  `\x1b[B`/`\x1b[1;1B` → lineDown; `\x1b[5~`/`\x1b[57362u` → pageUp;
  `\x1b[6~`/`\x1b[57363u` → pageDown; `g`/`G`/`j`/`k`/`q`.
- panel render contains the title, status, hint, and stays within width.

## Done

Typecheck clean; duck tests pass; manual item 14–17 re-verified on a
Kitty-capable terminal.

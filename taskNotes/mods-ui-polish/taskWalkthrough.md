# Walkthrough — mods-ui-polish

## What changed

- **New `extensions/shared/panel.ts`** — the shared overlay frame (rounded border,
  `toolPendingBg` background, accent title, muted right label, dim footer, pressure
  meter, ANSI-aware width fitting).
- **`extensions/workbench/cockpit.ts`** — renders through the panel kit; a pure
  `buildCockpitSections` model behind `renderCockpitPanel`.
- **`extensions/duck/index.ts`** — `duckKeyAction` via `matchesKey` (legacy +
  Kitty protocols), streaming panel with auto-follow and a line-range footer, and
  `/duck` now closes an open panel.

## 1. Automated verification

```sh
cd /root/Code/Projects/Prasham-Pi-Extensions
npm run check
```

Expect: typecheck clean, `158 pass, 0 fail`, `... validated (9 extensions).`,
`... enabled here.`, exit 0.

## 2. Cockpit (TUI)

```sh
pi -ne -e ./extensions/workbench/index.ts
```

- `/cockpit` → a framed panel on the right, visibly distinct from the transcript.
- Title bar `◈ cockpit` with the active model on the right.
- `CONTEXT` meter (green <50%, yellow <80%, red ≥80%) + token count.
- `USAGE` line from `formatUsage` (or `(unavailable)`).
- `RECENT DECISIONS` bulleted; `(none)` when the ledger is empty; a red
  `ledger: ...` row when the ledger server is unreachable.
- Footer `/cockpit to hide · refreshes each turn`.
- Keep typing while it is open — the overlay is non-capturing.
- Shrink below 120 columns → the overlay hides by itself.
- `/cockpit` again → it hides.

With the Jev ledger for real decisions:

```sh
PI_JEV_LEDGER_PORT=37650 bun run extensions/shared/ledger-server.ts   # terminal A
# then /cockpit in Pi
```

## 3. Duck (TUI)

```sh
pi -ne -e ./extensions/duck/index.ts
# /duck what am I missing?
```

- The panel opens immediately and streams; the header shows
  `provider/model · ⠋ asking…`, then `in N / out M` when done.
- **Arrows / `j` `k`** scroll one line; **PgUp/PgDn** scroll a page; **`g`/`G`**
  (or Home/End) jump to top/bottom. This is the fix: on Kitty-protocol terminals
  (`\x1b[1;1A`, `\x1b[27u`) these previously did nothing.
- New output auto-follows the tail. Scroll up to pause; `G` resumes.
- `esc`, `q`, or `ctrl+c` closes. Running `/duck` while it is open also closes it.
- The footer shows the key hints and, when scrolled, `lines A–B of N`.

## 4. Print-mode smoke (must not throw)

```sh
pi -ne -e ./extensions/workbench/index.ts -p --no-session 'say ok'
pi -ne -e ./extensions/duck/index.ts      -p --no-session 'say ok'
```

Expect `exit 0` and `ok` from both.

## 5. What a human should verify

- The two overlays read as one family and as panels, not as transcript text, on
  dark **and** light themes.
- Duck responds to arrows and `esc` on a Kitty-capable terminal (the original
  defect), and to `j/k/g/G/q` everywhere.
- Cockpit stays non-capturing; the editor keeps focus.
- `/cockpit` and `/duck` toggles both hide cleanly with no leftover spinner.

## 6. Commits

```
b609d03 ✨ feat: Add shared overlay panel kit
fbd40fd 🎨 style: Render cockpit as a themed panel
b543748 🐛 fix: Make duck panel respond to all terminals
<docs commit> 📝 docs: Record mods UI polish validation
```

`git log --oneline e064dc6..HEAD` should show the above.

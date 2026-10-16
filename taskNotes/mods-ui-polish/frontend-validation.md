# Frontend (TUI) validation — mods-ui-polish

This is TUI work: rendering and key handling cannot be asserted in print mode, so
the automated proof is the pure render/key-map tests plus a print-mode smoke, and
a human checklist covers live placement and theme rendering.

## 1. Automated gate

```sh
cd /root/Code/Projects/Prasham-Pi-Extensions
npm run check
```

Observed:

```
 158 pass
 0 fail
 808 expect() calls
Ran 158 tests across 25 files. [828.00ms]
Package manifest and public assets validated (9 extensions).
Local-first enablement validated (9 extensions enabled here).
exit 0
```

This proves acceptance criteria 5 and 6 (width invariant + tests new/changed in
the diff, suite green).

## 2. Targeted tests, by criterion

```sh
bun test tests/shared/panel.test.ts tests/workbench/cockpit.test.ts tests/duck/run.test.ts
```

Observed: `31 pass, 0 fail, 234 expect() calls`.

| Criterion | Test | Proves |
|---|---|---|
| 1 — cockpit panel | `cockpit.test.ts > renderCockpitPanel` | frame, title, model label, `62%`, usage and decision rows |
| 1 — cockpit content model | `buildCockpitSections` tests | context/tokens/usage/decisions, `(none)`, ledger-error row |
| 2 — duck key map | `duckKeyAction` tests | identical actions for legacy (`\x1b`, `\x1b[A`, `\x1b[5~`) and Kitty (`\x1b[27u`, `\x1b[1;1A`, `\x1b[57421u`) encodings |
| 3 — duck follow/range | `buildDuckPanel > windows a long body` | tail-follow offset `30`, `lines 31–40 of 40` |
| 3 — duck usage/error | `buildDuckPanel` tests | `in 10 / out 20`, `duck failed: boom`, `esc close` |
| 5 — width invariant | `panel.test.ts` + overlay render tests | every line exactly `width` for 40/80/120/200, ANSI + long word + narrow width |

## 3. Print-mode smoke (must not throw)

```sh
pi -ne -e ./extensions/workbench/index.ts -p --no-session 'say ok'
pi -ne -e ./extensions/duck/index.ts      -p --no-session 'say ok'
```

Observed: both `exit 0`, each printing `ok` (plus the pre-existing "No models
match pattern" warnings for the configured model list).

## 4. Manual TUI checks (human, one real session)

Run in this directory: `pi -ne -e ./extensions/workbench/index.ts` and
`pi -ne -e ./extensions/duck/index.ts`.

| # | Check | Expected |
|---|---|---|
| 1 | `/cockpit` (≥120 cols) | rounded, background-filled panel; distinct from the transcript |
| 2 | Cockpit title bar | `◈ cockpit` left, `provider/model` right |
| 3 | Cockpit body | `CONTEXT` + colored meter + token count; `USAGE`; `RECENT DECISIONS` with `•` rows |
| 4 | Cockpit footer | `/cockpit to hide · refreshes each turn` |
| 5 | Ledger server down | a red `ledger: …` row, no crash |
| 6 | Type while cockpit is open | editor still receives keys (`nonCapturing`) |
| 7 | Narrow terminal (<120 cols) | cockpit overlay hidden |
| 8 | Theme switch (dark ↔ light) | panel stays readable, no stray color |
| 9 | `/duck …` on a Kitty terminal (Ghostty/Kitty/WezTerm) | panel opens; **arrows and PgUp/PgDn scroll**, `g/G` jump, `esc` closes |
| 10 | `/duck …` streaming | body auto-follows; scrolling up pauses follow; `G` resumes |
| 11 | `/duck` again while open | panel closes |
| 12 | Duck title bar | `duck` left, `provider/model · <spinner|in/out|error>` right |

The manual checklist is the only proof for criteria 1–4's live placement and
theme rendering; items 5, 9, 10, and 11 have partial automated coverage above.

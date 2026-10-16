# Frontend (TUI) validation — mods-cockpit-duck

TUI work: pure logic is unit-tested; live placement and rendering need the human
checklist.

## 1. Automated gate

```sh
cd /root/Code/Projects/Prasham-Pi-Extensions
npm run check
```

Observed:

```
 152 pass
 0 fail
 798 expect() calls
Ran 152 tests across 25 files. [877.00ms]
Package manifest and public assets validated (9 extensions).
Local-first enablement validated (9 extensions enabled here).
exit 0
```

Proves criteria 1, 2, 4, 5, 6. This is the final run, after the review fix.

## 2. Targeted tests, by criterion

```sh
bun test tests/duck/prompt.test.ts tests/duck/run.test.ts tests/workbench/cockpit.test.ts
```

Observed: `35 pass, 0 fail, 185 expect() calls`.

| Criterion | Test | Proves |
|---|---|---|
| 1 — prompt cap | `prompt.test.ts > caps the answer at five questions` | prompt contains `at most 5 questions` and `never more than 5` |
| 2 — display cap | `run.test.ts > capDuckQuestions` | 8 questions → first 5 + `omitted: 3`; ≤5 unchanged; bullets and `Qn:` counted; prose untouched |
| 2 — cap row | `run.test.ts > shows the cap row …` | panel contains `…and 3 more questions (capped at 5)` and not the 6th |
| 4 — usage windows | `cockpit.test.ts > emits one window row per window` | rolling → weekly → monthly, in order |
| 4 — tokens/spend/note | `cockpit.test.ts > shows tokens, spend and note` | `1200 in / 300 out today`, `$1.50 MTD`, note |
| 4 — error visible | `cockpit.test.ts > surfaces a usage error` | red `HTTP 401` row instead of a blank |
| 5 — reset labels | `cockpit.test.ts > formatReset` | `30m`, `3h`, `2d`, `now`, `undefined` |
| 3, 6 — width | `cockpit.test.ts` + `panel.test.ts` | every line exactly `width` for 40/80/120 |

## 3. Print-mode smoke (must not throw)

```sh
pi -ne -e ./extensions/workbench/index.ts -p --no-session 'say ok'
pi -ne -e ./extensions/duck/index.ts      -p --no-session 'say ok'
```

Observed: both `exit 0`, each printing `ok`.

## 4. Manual TUI checks (human)

```sh
pi -ne -e ./extensions/workbench/index.ts
pi -ne -e ./extensions/duck/index.ts
```

| # | Check | Expected |
|---|---|---|
| 1 | `/cockpit` (≥120 cols) | panel docks in the **top-right corner**, clearing the mid-screen transcript |
| 2 | Cockpit while working | typing and other commands keep working; typing still lands in the editor |
| 3 | Scrolling the transcript | the panel no longer sits over the lines you are reading (only the top-right corner) |
| 4 | Cockpit USAGE | `rolling` / `weekly` / `monthly` rows with meters and `resets …` |
| 5 | Cockpit with no key | a visible usage error row, never a blank section |
| 6 | `/duck …` | at most five questions; a sixth+ is replaced by `…and N more questions (capped at 5)` |
| 7 | `/duck` scrolling/close | arrows + `esc` behave as before |

The manual checklist is the only proof for the occlusion fix (criterion 3) and
live theme rendering; items 2 and 6 have automated coverage above.

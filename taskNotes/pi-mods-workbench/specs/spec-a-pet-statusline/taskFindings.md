# Spec A — workbench entry, pet, statusline

Parent: `taskNotes/pi-mods-workbench/taskFindings.md`.

## Purpose

Create the `workbench` entry with feature flags and the two always-on display
features: the animated **pet** and the rewritten two-line **statusline**.

## Original Ask

`workbench/index.ts` (config + flags + per-feature `try`), `pet.ts` + `verbs.ts`
(animated indicator, themed per-turn verbs, `/pet`), `statusline.ts` + `stats.ts`
(two-line footer), `workbench.config.json` example, tests.

## Complexity

**4 / 5.** Footer/indicator APIs are manual-check-only; two features share one
entry and must be isolated.

## Backend changes required

- `workbench/config.ts` — `WorkbenchConfig = { pet: {enabled, theme}, statusline:
  {enabled, showCost}, cockpit: {enabled} }` via `shared/config.ts`.
- `workbench/verbs.ts` — themed verb lists (`starwars`, `marvel`, `barca`, `auto`)
  and `pickVerb(theme, turn, rand)` (pure).
- `workbench/pet.ts` — `setWorkingIndicator({frames, intervalMs})`,
  `setWorkingMessage(pickVerb(...))` per turn, `moodFrom(contextPercent, recentErrors)`
  (pure); `/pet` → state, `/pet theme <t>`, `/pet badges`; restore defaults on
  shutdown.
- `workbench/stats.ts` — `duration(entries)` and `cost(entries)` from assistant
  message usage (pure, tested); running sum (aggregate API unresolved).
- `workbench/statusline.ts` — `setFooter(factory)`; line 1 `branch · ctx% ·
  duration · cost`, line 2 provider usage via `shared/usage.ts` + `usage/opencode-go`
  (read-only reuse); `footer.getGitBranch()` + `onBranchChange()`; restore
  `undefined`.
- `workbench/index.ts` — load config; register each feature in its own `try`;
  `notify` once per feature failure.

## Acceptance Criteria

1. All features `false` → entry loads and does nothing.
2. One feature throwing → others still register; one `notify`.
3. `pickVerb` rotates per turn and honours a pinned theme; `moodFrom` and
   `duration`/`cost` pure and tested.
4. Indicator and footer render in TUI; footer restored on shutdown (manual check).
5. No `ctx.ui.*` in print mode.

## Validation

```sh
bun test tests/workbench
npm run check
pi -ne -e ./extensions/workbench/index.ts    # /pet, footer
```

# Specs — btw-window

Breakdown of `taskNotes/btw-window/taskFindings.md` (complexity 3). Order matters:
Spec 1 is the shared screen contract, Spec 2 the nested stream contract, Spec 3 the
pure BTW core, Spec 4 the window, and Spec 5 the command/registration.

| # | Spec | Files | Depends on | Verify |
|---|------|-------|-----------|--------|
| 1 | Shared full-screen lock | `extensions/shared/full-screen.ts`, `extensions/fabric/index.ts`, `tests/shared/full-screen.test.ts` | — | height/fit unit tests, lock nesting, Fabric imports compile |
| 2 | Shared nested stream | `extensions/shared/nested.ts`, `extensions/duck/index.ts`, `tests/duck/run.test.ts` | — | existing Duck stream/header tests stay green |
| 3 | Pure BTW core | `extensions/btw/{transcript,model,prompt,summary,text}.ts`, `tests/btw/{transcript,model,prompt,summary,text}.test.ts` | — | block serialization, budget truncation, free-model order, prompt shape, summary format, escape stripping |
| 4 | BTW window | `extensions/btw/{view,screen}.ts`, `tests/btw/{view,screen}.test.ts` | Spec 1 | exact-height render, width safety, scroll, keys, editor forwarding |
| 5 | Command, registration, docs | `extensions/btw/index.ts`, `package.json`, `README.md`, `CHANGELOG.md`, `docs/btw.md`, `docs/shared.md`, `tests/btw/extension.test.ts` | Specs 2–4 | `/btw` registered in main, skipped in a worker, non-TUI notify, package check |

## Spec 1 — Shared full-screen lock

Deliverable: `windowHeight`, `fitScreen`, `beginFullScreen`, `endFullScreen`,
`fullScreenOpen`, `FABRIC_AGENTS_WIDGET`; Fabric uses them instead of its local
copies and checks the lock in `updateAgents`.

Done when: unit tests cover sizing, padding/trimming, width truncation, and lock
nesting; Fabric’s tests still pass.

## Spec 2 — Shared nested stream

Deliverable: `accumulateNested`, `nestedHeaders`, `textOfMessage`, `usageOf`,
`errorOf`; Duck imports them and re-exports the old names so its tests and callers
keep working.

Done when: Duck’s stream/header tests pass unchanged and typecheck is green.

## Spec 3 — Pure BTW core

Deliverable:

- `transcriptFromMessages` / `renderTranscript` / `transcriptBudget` with
  system/thinking exclusion, per-block caps, newest-first truncation, and citable
  `[mN]` labels.
- `resolveBtwModels` with `PI_BTW_MODEL`, the free preference list, any `free` id,
  the current-model fallback, and a warning when no free model is used.
- `buildBtwSystemPrompt`, `buildBtwQuestion`, `buildSummaryPrompt` with the
  transcript-only contract.
- `shortAnswer`, `parseSummary`, `formatSummaryBlock`, `appendToDraft`,
  `stripCitations`.
- `stripControls` for terminal escape hygiene.

Done when: tests cover every bullet, including empty/malformed inputs and a long
tool result.

## Spec 4 — BTW window

Deliverable: `renderBtwView` (pure) and `BtwScreen` (Editor, keys, height fitting,
scroll follow). Keys are Enter, `Alt+S`, PageUp/PageDown, and Esc.

Done when: tests prove exact height, width safety, header/footer, streaming caret,
notice/error rows, scroll state, editor forwarding, and focus propagation.

## Spec 5 — Command, registration, docs

Deliverable: `/btw`, `/btw <question>`, `/btw send`, `/btw help`; `PI_FABRIC_AGENT`
guard; non-TUI notify; `package.json` registration; README, CHANGELOG, `docs/btw.md`,
`docs/shared.md`.

Done when: the extension test proves registration/skip/non-TUI/empty-chat paths,
`npm run check` passes, and the live TUI smoke test shows a free-model answer and a
staged editor summary.

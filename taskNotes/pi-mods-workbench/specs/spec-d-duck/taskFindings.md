# Spec D — duck (Increment 4b)

Parent: `taskNotes/pi-mods-workbench/taskFindings.md`.
Source: `docs/pi-mods-plan.md` Phase 4.

## Purpose

`/duck <prompt>` puts the current plan in front of a model that must return
**questions only**, using an in-process nested call (no subprocess).

## Original Ask

`extensions/duck/index.ts`: extract the latest assistant message as the plan, call
`ctx.modelRegistry.streamSimple(model, { messages })` with a questions-only
instruction, show the nested call's `input`/`output` usage in the header, and
render in a right-anchored overlay (or widget when the rail is unavailable).
`buildDuckPrompt(plan, question)` pure and tested.

## Complexity

**3 / 5.** Verified `streamSimple`; rendering is manual-check-only.

## Backend changes required

- `duck/prompt.ts` — `buildDuckPrompt(plan, question)` (pure, tested): instruct
  questions-only, no answers, no edits.
- `duck/index.ts` — `/duck [question]`: latest assistant text from
  `ctx.sessionManager.getBranch()`; `streamSimple`; accumulate text; read
  `usage.input`/`output`; render overlay (`anchor:"right-center"`,
  `nonCapturing`, `visible:(w)=>w>=120`) or `setWidget` fallback; visible error on
  failure or no model.
- `package.json` — add `./extensions/duck/index.ts`.

## Acceptance Criteria

1. `/duck` loads; the response contains questions only (no answers/edits).
2. Header shows nested `input`/`output` usage.
3. No subprocess; `streamSimple` only.
4. Failure / no model → visible message, no throw.
5. Print mode: no UI calls, no throw.

## Validation

```sh
bun test tests/duck
pi -ne -e ./extensions/duck/index.ts     # /duck <prompt>
```

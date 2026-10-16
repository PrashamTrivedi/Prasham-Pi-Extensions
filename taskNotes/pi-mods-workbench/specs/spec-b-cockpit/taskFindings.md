# Spec B — cockpit

Parent: `taskNotes/pi-mods-workbench/taskFindings.md`.

## Purpose

Add the right-anchored, non-capturing **cockpit** overlay showing context, cost,
provider usage, and recent Jev decisions.

## Original Ask

`workbench/cockpit.ts`: `/cockpit` toggles a `custom()` overlay with
`anchor:"right-center"`, `width:"38%"`, `maxHeight:"80%"`, `nonCapturing:true`,
`visible:(w,h)=>w>=120`; recompute on `turn_end` + `tool_result`; read recent Jev
decisions via `shared/ledger.ts`; visible message when the ledger server is absent.

## Complexity

**4 / 5.** Overlay lifetime/placement is manual-check-only; `nonCapturing` may not
hold input (fallback to `setWidget`).

## Backend changes required

- `workbench/cockpit.ts`:
  - `renderCockpit(ctx)` builds the string array from `getContextUsage()`,
    `stats.cost(entries)`, the usage reporter, and `recentCalls(5)`.
  - `/cockpit` toggles; overlay via `ctx.ui.custom(factory, { overlay: true,
    overlayOptions: { anchor: "right-center", width: "38%", maxHeight: "80%",
    nonCapturing: true, visible: (w) => w >= 120 } })`.
  - Recompute on `turn_end` and `tool_result`; close on `session_shutdown`.
  - Ledger absent → a line `ledger: server not running (bun run
    extensions/shared/ledger-server.ts)`, never a throw.
- Pure `buildCockpitLines(sections)` (tested).

## Acceptance Criteria

1. `/cockpit` opens the overlay; hidden below 120 columns.
2. Shows context %, cost, usage windows, and up to 5 Jev decisions.
3. Ledger server absent → visible line, no throw.
4. `nonCapturing` keeps the keyboard in the editor (manual); fall back to
   `setWidget` if it does not.
5. Print mode: no UI calls, no throw.

## Validation

```sh
bun test tests/workbench
bun run extensions/shared/ledger-server.ts &   # then /cockpit
pi -ne -e ./extensions/workbench/index.ts
```

# fabric-ui-rework — spec breakdown

Complexity 4. Five slices, each ending with a green tree. Order matters: the model first, then the
surfaces, then the removals, then the docs.

## Spec A — presentation model (pure)

`extensions/fabric/agents.ts`: `AgentRow`, `buildTree(agents, main, collapsed)`, `assignHues`,
group derivation from `batchId`, elapsed formatting. No fs, no TUI imports beyond types.

Deliverable: main first, spawn order, `depth`, `groupId`, group rows only for batches with two or
more live members; collapse hides descendants; hues deterministic and distinct among visible ids.

Tests: `tests/fabric/agents.test.ts` — nesting, collapse, group formation, hue determinism and
sibling distinctness, elapsed formatting boundaries.

## Spec B — agent rows below the prompt

`renderAgentRows(rows, theme, width)` in `ui.ts` + `updateAgents` in `index.ts` (`setWidget`
`belowEditor`, cleared when at most one live agent). Remove the status line in the same commit; the
rows are now the only always-on surface.

Deliverable: `◆ main · model · activity · 12m` first, `├─`/`└─` children, icon by status, colored
names, cap of six plus `+N more`, every line width-bounded.

Tests: renderer width safety at 1/2/3/20/80/160, cap and truncation, colored name presence; an
integration test asserting the widget is set with two agents and cleared with one.

## Spec C — `/agents` screen

`AgentsScreen` (`ui.ts`) + the `/agents` command replacing `/team`. Full-window tree with
collapse/expand, group rows, inline cancel confirmation, Esc to chat. Non-TUI mode falls back to a
`notify` tree.

Deliverable: arrows navigate, `→`/space expand, `←` collapse, Enter opens, `x` → `y/n` → cancel,
Esc closes; the list always includes main when two or more agents exist; expired agents are absent.

Tests: navigation and collapse state, group row rendering, cancel confirm (declined + accepted),
empty state, width safety; integration: entry/exit chain and `cancelTree` invocation.

## Spec D — transcript screen with panes

`TranscriptPane` (extracted from `TranscriptViewerOverlay`: parse, incremental append, scroll,
width-safe render) + `AgentTranscriptOverlay` (1–2 panes, per-pane hue header, shared footer, focus
routing, `s` toggle, narrow fallback). `showTranscript` accepts `main` and opens one or two ids.

Deliverable: a child opens with its hue in the header, rule and message bands; main opens from the
live session file; a group opens two columns; `tab` switches focus; `s` toggles; panes scroll
independently; every line bounded to its column width.

Tests: pane width safety per column, focus switching and per-pane offsets, toggle behaviour, narrow
fallback, header/band content, live append; integration: open child, open group, open main, Esc
chain, `s` toggle.

## Spec E — removals, docs, and the walkthrough

Delete `LiveTeamInspectorOverlay`, `TranscriptPickerOverlay`, `TranscriptViewerOverlay`, the
`/team` and `/transcript` commands, `alt+t`, `matchRuns`, `PRUNE_AFTER_MS`/`isPruned`, and the
status line wiring; update the comparison card's "open /team" copy. Update `README.md`,
`docs/fabric.md`, `extensions/fabric/README.md`, `CHANGELOG.md`, and write `taskWalkthrough.md` with
the manual TUI checklist and the validation artifacts.

Deliverable: no references to the removed surfaces anywhere (`grep` proof), docs describe the new
UI, `npm run check` green with the suite also green under a simulated Fabric-child env.

Tests: the integration suite is rewritten to the new surfaces; no test asserts a removed command.

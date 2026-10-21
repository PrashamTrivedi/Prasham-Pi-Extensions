# fabric-full-view — walkthrough

Implemented 2026-10-21. All three specs, plus the human's `/team all` addition.

## What changed

### Spec A — persist a full session per child

- `buildChildArgs(entry, model, instruction, session?)` drops `--no-session` and adds
  `--session-dir <fabricDir>/<rootId>/sessions --session-id <agentId>`. Called without a
  session it still emits `--no-session`, so the helper stays total.
- `startQueued` creates `sessions/` and records `agent.sessionDir` before launching.
- `agent.sessionPath` is filled three ways, cheapest first:
  1. the child, at `session_start`, writes its own `ctx.sessionManager.getSessionFile()` into
     `state.json` (works while the run is still going);
  2. `agent_settled` re-checks the same value before finishing;
  3. `resolveSessionFile(dir, id)` suffixes-matches `<timestamp>_<id>.jsonl` for older runs.
- Pi names sessions `<timestamp>_<session-id>.jsonl` with `--session-dir` used flat (no
  per-cwd subfolder), verified against the installed CLI and `dist/core/session-manager.js`.
  A path guess would have been wrong, so the parent never guesses.

### Spec B — full-window transcript viewer

- `parseSessionLine()` / `parseSessionText()` in `ui.ts`: pure, unit-testable, one JSONL line →
  zero or more blocks (user, assistant, thinking, toolCall, toolResult, note). System prompts
  and extension custom entries are skipped; `model_change`, `thinking_level_change`, and
  `branch_summary` become notes; unparsable lines are ignored so a truncated file still replays.
- Every block is control-stripped and bounded (8 000 chars of text, 400 of tool args) with an
  explicit `… truncated N characters` marker, so one huge tool result cannot swamp the run.
  `clean()`'s own 4 000-char default cap is bypassed deliberately (`stripControls`) — otherwise
  the truncation marker never appeared.
- `TranscriptViewerOverlay`: full-window replay, wrapped to `width`, cached by `width` + text and
  cleared on `invalidate()`. `pgup/pgdn` (or `j`/`k`/space), `home/end` (or `g`/`G`), `esc` closes.
  `refresh()` re-reads the file and follows the tail only when the reader was already at the tail.
- `/team`: the inspector closes with the selected id, then the transcript opens with
  `overlayOptions { width: "100%", maxHeight: "100%" }`. Esc in the transcript returns to the
  inspector (a loop), Esc there closes the dashboard. No transcript → a warning notify instead of
  an empty viewer.

### Spec C — widget removed, list pruned

- `setWidget("pi-fabric", …)` is gone; `updateUI` only sets the status line
  (`◆ fabric 2 running · 1 archived`). `widgetVisible` became `statusVisible`, and
  `/team hide`/`show` now toggle the status line.
- `isPruned()` / `visibleAgents()` hide terminal agents more than `PRUNE_AFTER_MS` (5 min) past
  `finishedAt`. Applied to the inspector data and the non-TUI `/team` tree. `state.json`,
  `agent_status`, `await_agents`, and result entry recording are untouched.
- `/team all` (and `a` inside the inspector) lists pruned runs again; the inspector title says
  `all runs`. `agent_status` appends a note naming how many runs are hidden.
- `treeLines()` takes an optional `include` filter (default: everything).

## Evidence

- `npm run check` → `189 pass, 0 fail`, `tsc --noEmit` clean, 11 extensions, local-first rule OK.
- Real CLI check: `pi -p --session-dir /tmp/fabric-verify --session-id fabricverify-1 …` wrote
  `2026-10-21T07-14-20-453Z_fabricverify-1.jsonl` flat in that dir; `resolveSessionFile` found it
  and `parseSessionText` produced `note, note, user, assistant` — the exact shape the viewer renders.
- Tests: `tests/fabric/core.test.ts` (child args, session lookup, prune window, bounded reads),
  `tests/fabric/ui.test.ts` (parser, bounds, viewer scroll/width/refresh, inspector enter + `a`),
  `tests/fabric/integration.test.ts` (status line instead of widget, pruned list, `/team all`,
  Enter → transcript → back, `/team hide|show`, missing transcript warning).

## Manual TUI check list

Run in this repo after `/reload`.

1. `spawn_agents` two runs, one low-rank model. The `◆ PI FABRIC` panel must **not** appear above
   the editor; only the accent status line appears (`◆ fabric 2 running`).
2. `/team` → select a running run → `Enter`. The transcript fills the window and grows while the
   run works (about once a second). `pgup`/`pgdn`, `Home`/`End`, `j`/`k` scroll without wrapping
   or bleeding past the frame edge.
3. `Esc` from the transcript returns to the inspector; `Esc` there closes it and the chat returns.
   Workers keep running in both cases.
4. Let a run finish. It stays listed for five minutes, then disappears from `/team` while the
   status line shows `· 1 archived`. `agent_status` still lists it and prints the "hidden from the
   live /team views" note.
5. `/team all` (or `a` in the inspector) shows the finished run again; the title reads `all runs`.
   `Enter` on it still opens the full transcript.
6. `/team hide` removes the status line without stopping workers; `/team show` restores it.
7. Terminal width 40 columns: the inspector and the transcript must not overflow the frame.

## Revision — full window, and no `/team` detour

Human feedback: the transcript "isn't fullscreen", it "should render within the pi window", and it
"must be accessible without team". Three changes.

1. **A real screen, not an overlay.** `ctx.ui.custom()` is now called without `overlay`, so the
   component owns Pi's interactive area instead of floating above the chat. A full-window screen
   shares the terminal with Pi's own footer (cwd/branch, context+model, one status row — every
   extension status shares that single row), so the view renders `rows - 3` lines and pads to
   exactly that height. Filling `rows` pushed the title off the top: verified in a live TUI, fixed,
   re-verified.
2. **`/transcript [id|prefix|label]`.** No argument opens `TranscriptPickerOverlay`: every run
   newest first, with model, status, relative age, and "no transcript yet" when a run has no saved
   session. Enter opens, Esc closes, and Esc in a transcript returns to the list. An argument
   accepts a full id, an id prefix, or a label fragment (`matchRuns`); several matches are listed
   instead of guessed.
3. **`alt+t`** registers the same picker as a shortcut, so a transcript never requires `/team`.

`/team` keeps its framed overlay and its `Enter` now opens the same full-window view.

### Verified in a live Pi TUI (Herdr pane, not a mock)

- 104x30 pane: title on row 1, 29 body rows, hint, padding, then Pi's 3-row footer — no clipping,
  no chat visible.
- 64x24 pane: wrapped to 62 columns, every line ≤ 64, `End` jumped to the result packet.
- `/transcript` and `alt+t` both opened the picker; `Enter` opened the transcript; `Esc` stepped
  transcript → picker → chat; `g`/`G`/space scrolled and clamped.
- Status line read `◆ fabric 1 running · 1 archived` with a 15-minute-old finished run, proving the
  prune filter against a real state file.

## Revision 3 — audit findings fixed

A `qwen` Fabric agent audited commits `c31b79b` + `14bb3ea` against the acceptance criteria
(transcript `552515`). Criteria 1-5 MET; 6 NOT MET, with three real defects. One was mine and
reproduced independently before fixing:

```
PI_FABRIC_ROOT=<live> PI_FABRIC_AGENT=fake bun test tests/fabric/integration.test.ts
  before → 1 pass, 3 fail        after → 5 pass, 0 fail
```

1. **Tests were not hermetic.** `restoreEnv()` ran in every test's `finally`, handing the real
   `PI_FABRIC_ROOT`/`PI_FABRIC_AGENT` to the next test; `fabric()` then bound to the live root, so
   the suite went red inside any Fabric child — exactly where this repo runs it. Isolation now
   lives in `harness()` (both variables are cleared before `fabric()`), env is restored once in
   `afterAll`, and a regression test sets both variables and asserts the extension still binds the
   harness root.
2. **Following a live run re-read and re-parsed the whole session every second.** `readSessionChunk`
   now reads only appended bytes (whole lines only, cut on `\n` so a multi-byte character is never
   split), and `TranscriptViewerOverlay.appendText` parses only the new complete lines, buffering a
   trailing partial line. The TUI timer reads from the last complete line at open, so a run written
   mid-open is not skipped; a truncated first load stops following.
3. **The viewer height was frozen at construction.** `setHeight(rows)` is now called from the
   render path, so a terminal resize immediately re-sizes the body (the notice line is counted in
   the chrome).

### Verification

- Real 236 783-byte, 68-entry session replayed **in 137-byte steps** through the exact reader +
  parser loop: 68 entries, 236 783 of 236 783 bytes consumed, no duplication or loss; initial
  bounded load also 68 entries; `setHeight(24)` renders exactly 24 lines.
- `npm run check` → `198 pass, 0 fail`, 1 247 assertions, 11 extensions.
- Same suite with `PI_FABRIC_ROOT`/`PI_FABRIC_AGENT` set (child environment) → `198 pass, 0 fail`.

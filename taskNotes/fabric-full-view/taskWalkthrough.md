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

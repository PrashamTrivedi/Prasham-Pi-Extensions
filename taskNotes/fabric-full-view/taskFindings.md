# Purpose

Rework the Pi Fabric run UI: discard the compact "◆ PI FABRIC" widget, show a selected fabric
run's **complete transcript** in a full-window view, and automatically drop finished subagents
from the Fabric list five minutes after they complete.

## Original Ask

Fabric - Since each agent is it's own full run. I need to show it fully, so when I select the
fabric run, it should show me the full window instead of that pane. The blue pane should be
discarded. Also each subagent should be automatically removed from fabric pane 5 minutes after
it's gone idle and done.

Clarified (human answers, 2026-10-18):

- "The blue pane" = the compact `◆ PI FABRIC` widget placed above the editor. Discard it.
- "Show the full run" = the **complete agent transcript** (every message, tool call, and tool
  result), full-screen — like a normal Pi session.

## Complexity and the reason behind it

**3 / 5.** Single extension (`extensions/fabric/`), but three coordinated changes: (a) change how
children are launched so a full transcript is persisted, (b) a new full-screen transcript viewer
over the saved session, (c) a timed list-pruning sweep. Rendering a session JSONL faithfully is
the trickiest part and needs a written manual-check list.

## Architectural changes required

Children are currently launched `pi -p --no-session …`, so their full transcript is never saved —
only bounded activity snapshots and a final result packet. Change the launch to persist a real
session per agent, then render that session as the "full run".

- **Child launch:** drop `--no-session`; pass `--session-dir <fabricDir>/<rootId>/sessions` and a
  deterministic `--session-id <agentId>` so the parent can compute the transcript path. Record
  `sessionPath` on the `FabricAgent` in `state.json`.
- **Compact widget:** remove the `setWidget("pi-fabric", …)` call (and its `widgetVisible`
  toggle). The status line (`setStatus`) stays as the only persistent Fabric surface.
- **Full-window viewer:** a new `TranscriptViewerOverlay` (full-screen overlay) that replays the
  agent's session JSONL — user/assistant text, tool calls (name + bounded args), and tool results
  (bounded output), in order, with scroll and escape-to-close. Opened from the `/team` inspector
  when a run is selected (Enter). The existing detail tabs (activity/tools/result/patch) remain
  available but the transcript becomes the primary "show me the run" surface.
- **Auto-prune:** terminal agents (`done`/`error`/`cancelled`) disappear from list/tree views 5
  minutes after `finishedAt`. This is display-level filtering (the `views()`, `treeLines()`, and
  `/team` data), not deletion of `state.json` agents or their transcript/patch files, so
  `await_agents` and result cards keep working.

## Backend changes required

1. **`extensions/fabric/index.ts`**
   - `buildChildArgs`: remove `--no-session`; add `--session-dir <sessionsDir>` and
     `--session-id <agentId>` (order/arg names per Pi CLI; verify `--session-dir` + `--session-id`
     coexist with `-p`).
   - `startQueued`: create the `sessions/` dir; compute and store `agent.sessionPath`
     (e.g. `<sessionsDir>/<agentId>.jsonl`) after launch; also update the `FabricAgent` type.
   - `updateUI`: stop calling `setWidget("pi-fabric", …)`; keep the status line. Remove the
     `widgetVisible` flag and its `/team hide|show` handling (or repurpose `hide`/`show` to the
     status line only).
   - `views()` / `treeLines()`: add a `pruneCutoff` filter — hide `terminal(status)` agents whose
     `finishedAt` is more than 5 minutes old. `agent_status` keeps reporting everything (with a
     note) so forensics stay possible.
   - `/team` handler: open `TranscriptViewerOverlay` full-screen when the selected agent has a
     `sessionPath` (Enter key), and pass the new overlay `overlayOptions` `width: "100%",
     maxHeight: "100%"` (or the closest full-window equivalent).
2. **`extensions/fabric/ui.ts`**
   - Add `TranscriptViewerOverlay` implementing `Component`: parses the session JSONL (v3) and
     renders entries in order with width-bounded wrapping; pageUp/pageDown scroll, Home/End,
     Escape closes (via an `onClose`). Reuse `readPreview`/`clean` for safe output; bound each
     tool result block and add "… truncated" markers. Keep rendering pure/width-safe per tui.md.
   - Optionally add a `TranscriptData`/`TranscriptEntry` shape and a pure `parseSessionLine()`
     helper that is unit-testable without a terminal.
3. **`extensions/fabric/activity.ts`** — no change required; activity snapshots remain for the
   inspector tabs.

No dependency changes.

## Frontend changes required

The full-window transcript viewer (described above) is the frontend change. Keep a keyboard path
for every action (`↑/↓` select, `Enter` open transcript, `pgup/pgdn` scroll, `esc` close) since
regular TUI mode leaves mouse to the terminal.

## Acceptance Criteria

1. The compact `◆ PI FABRIC` widget no longer renders above the editor.
2. Selecting a fabric run and pressing Enter opens a full-window view of that agent's complete
   transcript (user/assistant messages, tool calls, and tool results), not just a summary pane.
3. Each finished subagent disappears from the `/team` list and tree views 5 minutes after its
   `finishedAt`; running/waiting/queued agents and agents finished < 5 minutes ago remain visible.
4. `await_agents` still resolves against the full `state.json` (pruning is display-only).
5. Transcript/patch/result files remain on disk for review after an agent is pruned from the list.
6. `npm run check` stays green with new/changed tests for the prune filter and the session-line
   parser.

## Validation

- Unit tests: `parseSessionLine`/prune-filter pure logic with a fake session JSONL fixture (no
  network, no terminal). A changed test file proves the criteria.
- Manual TUI check (written list): spawn two agents, watch the widget absence + status line,
  open `/team`, Enter on a finished agent to see its full transcript, scroll/esc, then confirm
  the agent drops from the list after 5 minutes.
- `npm run check` exit code and test summary line echoed into the transcript.

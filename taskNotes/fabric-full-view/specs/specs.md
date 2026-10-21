# fabric-full-view — spec breakdown

Complexity 3. Three independent spec items, each leaving the tree green.

## Spec A — persist a full session per child

Change child launch so each agent saves a real session the parent can replay.

- `buildChildArgs`: drop `--no-session`; add `--session-dir <fabricDir>/<rootId>/sessions` and
  `--session-id <agentId>`.
- `startQueued`: mkdir `sessions/`, compute `agent.sessionPath`, store it in `state.json`.
- Verify `-p` + `--session-dir` + `--session-id` produce a JSONL at `sessionPath`.

## Spec B — full-window transcript viewer

`TranscriptViewerOverlay` (full-screen) replays the saved session JSONL.

- Pure `parseSessionLine(line)` → typed entry (message text / tool call / tool result / other).
- Component renders entries in order, width-bounded, `clean()`ed, with scroll (pgup/pgdn,
  home/end) and `esc` close.
- `/team`: Enter on a selected agent with a `sessionPath` opens it with `overlayOptions`
  `width: "100%", maxHeight: "100%"`.

## Spec C — remove widget + auto-prune list

- `updateUI`: delete the `setWidget("pi-fabric", …)` call; keep the status line; drop
  `widgetVisible` and `/team hide|show`.
- `views()`/`treeLines()`/`/team` data: hide terminal agents whose `finishedAt` is > 5 min old
  (display-only; `state.json`, `agent_status`, `await_agents`, and result cards unaffected).

See `taskFindings.md` for the full acceptance criteria and validation.

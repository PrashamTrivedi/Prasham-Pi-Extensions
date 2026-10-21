# fabric-ui-rework — walkthrough

Implemented 2026-10-21. Requirements: `requirements.md`; plan: `taskFindings.md`; slices:
`specs/specs.md`.

## What the UI is now

**Rows below the prompt** (`extensions/fabric/agents.ts`, `renderAgentRows`) — the always-on surface:

```
◆ main · deepseek-v4.1-flash · idle · 12m
└─ ▸ 2 agents · api-refactor, tests · running · 8m
```

- One bounded line per agent: marker, colored name, model, live activity, elapsed time.
- Main first, children indented, one spawn batch collapsed into a single group row.
- Six rows maximum, then `+N more agents`; nothing renders when the main chat is alone.
- No status line, no legacy widget: the rows are the only persistent surface.

**`/agents`** (`AgentsScreen`) — the only keyboard path to a transcript: a full-window tree of main
plus every live agent, with `→`/`←` expand-collapse, group rows, `Enter` to open, `x` to cancel (a
`y/n` confirmation; a group row cancels every member), and `Esc` back to the chat. The header counts
agents, not rows.

**Agent transcripts** (`TranscriptPane` + `AgentTranscriptOverlay`) — a full-window custom screen, not
an overlay. Each pane has a hue-tinted header, a hue rule, and tinted message-header bands; the body
text keeps normal colors. `tab` switches focus, `s` toggles one/two columns, page keys scroll the
focused column, `Esc` returns to `/agents`. Below 80 columns two columns fall back to one with an
explicit note. The main chat opens through the same screen, read from the live session file.

**Colors** (`assignHues`, `paintAgent`, `agentBand`) — FNV-1a hash of the agent id → hue, nudged so
visible agents stay apart, rendered with `okhslColor` at a theme-appropriate lightness (dark/light)
and mixed into a readable band. Without `theme.style` (unit tests) it falls back to theme tokens.

**Idle sweep** (`IDLE_GONE_MS = 10 * 60_000`, `isGone`, `liveAgents`) — replaces the five-minute
finished-run prune. It is display-only: `state.json`, result cards, `agent_status`, and every file
stay.

**Removed:** the `◆ fabric …` status line, `/team`, `/transcript`, `alt+t`, `matchRuns`,
`LiveTeamInspectorOverlay`, `TranscriptPickerOverlay`, `TranscriptViewerOverlay`,
`PRUNE_AFTER_MS`/`isPruned`, and the framed-overlay helper. `spawn_agents` stamps a `batchId` per
call. Tool result cards are untouched.

## Live TUI verification (Herdr pane, not a mock)

A synthetic root (`ui-demo`) held two running agents from one spawn call plus one agent finished 15
minutes earlier, with real saved session files.

| Step | Observed |
| --- | --- |
| Pi starts | `◆ main · … · idle · 0s` / `└─ ▸ 2 agents · api-refactor, tests · running · 8m` — stale agent absent, batch on one line |
| `/agents` | `Agents  3 live`, main selected, the group row collapsed, key footer |
| `↓`, `→` | group expands to both members, each indented, header count unchanged (agents, not rows) |
| `Enter` on the group, narrow pane | one column plus `one column: too narrow for two` |
| pane zoomed to full width | `api-refactor … │› tests …` — two columns, focus marker, separator |
| `s` | single column; `s` again restores two |
| `tab` | focus moves to the right column (`› tests`) |
| `Esc`, `Esc` | back to `/agents`, then the chat with the rows restored |
| `↓`, `x`, `y` on the group | `Cancel all 2 agents in this group (and their descendants)? y/n` → both cancelled |

Two layout bugs were found and fixed only because of this run:

1. A full-window screen left the rows widget resident, which clipped the screen's **top** (the
   `/agents` title vanished). Screens now hide the rows while open (`withScreen`), and the rows
   return when the last one closes.
2. `/agents` claimed `4 live` / `1 live` because it counted rows; it now counts agents, summing a
   collapsed group's members.

## Manual checklist (repeat after `/reload`)

1. With no children: no rows, no status line.
2. `spawn_agents` one agent: a row appears within a second, main first, activity streaming.
3. `spawn_agents` two agents in one call: they collapse into one group row.
4. `/agents`: navigate, `→`/`←`, open the child, read it, `Esc` back, `Esc` to chat.
5. Open the main row: the coordinator transcript appears with the accent header.
6. Zoom to ≥80 columns and open a group: two columns; `s` toggles, `tab` switches, page keys scroll
   one column only.
7. `x` on a child and on a group, with `n` then `y`.
8. Leave a finished agent for ten minutes: it disappears from the rows and `/agents`, while
   `agent_status` still reports it.

## Evidence

- `npm run check` → `199 pass, 0 fail`, 829 assertions, 32 files, 11 extensions, local-first green.
- Same suite with `PI_FABRIC_ROOT`/`PI_FABRIC_AGENT` set (child environment) → `199 pass, 0 fail`.
- Fabric tests: `tests/fabric/agents.test.ts` (tree, groups, collapse, hues, rows), `ui.test.ts`
  (panes, scroll, columns, screen keys, cancel confirm), `integration.test.ts` (rows appear/clear,
  `/agents` chain, group columns, idle sweep, group cancel, env hermeticity), `core.test.ts`
  (idle boundary, session tail reads).

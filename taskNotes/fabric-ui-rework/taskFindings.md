# Purpose

Rework the Fabric UI/UX: agents become visible as a persistent tree of one-line rows below the
prompt, and each agent (including the main chat) can be opened as a full-window, color-identified
transcript. This replaces the status line, the `/team` dashboard, and `/transcript`.

## Original Ask

Verbatim from the human:

> A new agent: As soon as it spawns, it shows somewhere prominently (Claude does it below the
> prompt, I think that is better way because it doesn't intrude the way it looks. OTher way is a
> sidebar that doesn't obstruct the transcript view. So we have main agent and other agents. All
> agents (as long as there are >1) listed in that prominent sidebar
>
> Opening that agent: Will open that agent in main transcript window. With a different color and
> identification that tells me I am in a different agent.
>
> Each agent is color coded, so that we can identify the agent's message. Claude uses the agent name
> in color, we may use backgrounds or text colors as long as the text is readable.
>
> When agent is idle and remains idle for more than 10 minutes. The agent is gone.
>
> This is how I want UI UX of fabric....
>
> If there are comparision agents, The side pane shows this side by side. And main pane can open it
> side by side or separately. Think similarly about other way of running them.
>
> The UI UX is almost a complete rework, so treat it like that.

Clarified in `taskNotes/fabric-ui-rework/brainstorm.md` and captured as requirements in
`taskNotes/fabric-ui-rework/requirements.md`. Where this plan and `requirements.md` disagree,
`requirements.md` wins; where both are silent, the assumptions listed there apply.

## Complexity and the reason behind it

**4 / 5.** One extension, but a surface replacement rather than an addition: a new persistent
widget, a new navigable tree screen, a rewrite of the transcript renderer into a 1–2 column
composer, a per-agent color system, a spawn-group model, and the deletion of three existing
surfaces with their tests. Rendering must stay width-safe at tiny sizes, colors must work in light
and dark themes, and the main chat itself becomes an entry whose transcript is the live session
file. Verification is TUI-heavy, which is why it is not a 3.

## Architectural changes required

**1. A presentation model separated from the extension.** New `extensions/fabric/agents.ts` holds
pure, testable pieces:

- `AgentRow` — `{ id, label, model, status, depth, isMain, batchId?, groupId?, activity, elapsedMs, sessionPath? }`.
- `buildTree(agents, main)` — main first, then spawn order, with `depth` and `collapse` applied;
  children are grouped by `batchId`.
- `assignHues(ids)` — deterministic golden-angle hue per id, with collision nudging so visible
  agents stay distinguishable; stable across sessions because it derives from the id.
- `IDLE_GONE_MS = 10 * 60_000` lives with the policy in `index.ts` (it filters state, not layout).

**2. Main is an agent.** The coordinator is synthesized at render time: id `main`, current model,
status from `agent_start`/`agent_settled` (`"running"` while working, `"idle"` otherwise), activity
from the last tool, `sessionPath` from `ctx.sessionManager.getSessionFile()` (undefined for
ephemeral sessions, in which case the row shows no transcript). Its transcript is replayed by the
same renderer as a child's.

**3. Spawn groups.** `spawn_agents` stamps every agent it creates with a `batchId` (one per call).
A batch with two or more members renders as a group row in `/agents` and opens as a two-column
transcript.

**4. Colors.** `agentColor(theme, id)` returns a foreground color and a tinted background color:
hue from the id, saturation fixed, lightness from `theme.appearance` (dark → light tint, light →
dark tint), background mixed against the theme's own background. Rendered through `theme.style`;
when a theme adapter has no `style` (unit tests), it falls back to a small semantic-token palette
by hue bucket, so tests still see stable, distinct output.

**5. One screen primitive for transcripts.** `TranscriptViewerOverlay` is replaced by
`TranscriptPane` (parse + incremental append + scroll + render one column) and
`AgentTranscriptOverlay` (1–2 panes, per-pane header, shared footer, focus routing). The parse,
incremental-read, and width-safety logic is reused, not rewritten.

**6. Surfaces removed.** `updateUI` no longer sets a status line; `/team`, `/transcript`, and
`alt+t` are deleted along with `LiveTeamInspectorOverlay` and `TranscriptPickerOverlay`.
`renderComparisonResultCard` and the tool result cards stay untouched.

See `specs/specs.md` for the five implementable slices.

## Backend changes required

**`extensions/fabric/index.ts`**

1. `FabricAgent` gains `batchId?: string`; `spawn_agents` assigns one per execute call.
2. `updateUI` → `updateAgents(ctx)`:
   - gather state agents + synthesize main,
   - filter with `liveAgents(state, now)` (terminal and `finishedAt` older than `IDLE_GONE_MS`),
   - if the live count is ≤ 1 → `ctx.ui.setWidget("pi-fabric-agents", undefined)`,
   - else `setWidget(..., { placement: "belowEditor" })` rendering `renderAgentRows(...)`,
   - no `setStatus` anywhere.
   - Keep the 750 ms timer; it also records `pi-fabric-result` entries exactly as today.
3. `/agents` command replaces `/team`: opens `AgentsScreen` as a **full-window custom screen**
   (consistent with the transcript screens), loops so Esc from a transcript returns to the list and
   Esc in the list returns to the chat. Non-TUI mode prints a plain tree via `notify`.
4. `showTranscript(ctx, agentId)` accepts `main` and resolves the session file from
   `ctx.sessionManager.getSessionFile()`; child agents keep `sessionPath` + suffix fallback.
   Group opens pass two ids.
5. Cancellation: `x` in `AgentsScreen` → inline confirm → `cancelTree` (unchanged semantics:
   descendants included, worktrees preserved). Replaces `/team cancel`.
6. Delete `PRUNE_AFTER_MS` / `isPruned` in favour of `IDLE_GONE_MS` / `liveAgents`; keep
   `agent_status` reporting **all** agents with a note on how many are hidden.
7. `matchRuns` and the transcript command go away with `/transcript`.

**`extensions/fabric/ui.ts`**

- Keep: `parseSessionLine`, `parseSessionText`, `TranscriptEntry`, `clean` usage, comparison cards.
- Add: `AgentRow` renderer, `AgentsScreen`, `TranscriptPane`, `AgentTranscriptOverlay`, hue helpers.
- Remove: `LiveTeamInspectorOverlay`, `TranscriptPickerOverlay`, `TranscriptViewerOverlay`,
  `InspectorData`, `relativeAge` only if the new rows do not use it (they do — keep).

## Frontend changes required

**Rows below the prompt** (`renderAgentRows`, pure, width-bounded):

```
◆ main · deepseek-v4.1-flash · thinking · 12m
├─ ● api-refactor · qwen · running npm test · 2m
└─ ○ tests · qwen · queued · —
```

- Status icon, colored name, model, live activity (truncated), elapsed.
- Main first; descendants indented with `├─`/`└─`; cap six rows then `+N more agents`.
- Never wraps: every line is `truncateToWidth`-bounded; no line counts on the transcript.

**`/agents` screen** (full window):

- Tree with collapse markers (`▸`/`▾`), selection cursor, group rows (`▸ 2 agents · api-refactor,
  tests`), status icons, elapsed, and a footer of keys.
- Keys: `↑↓` select, `→`/`space` expand, `←` collapse, `Enter` open, `x` cancel (inline `y/n`
  confirm), `Esc` close.
- Default expansion: parents with a running descendant expanded; others collapsed.

**Agent transcript screen** (full window, 1–2 panes):

- Per-pane header: `‹api-refactor› · qwen · running · 2m` in the agent's hue, then a rule in the
  same hue; message header bands use the tinted background; body text keeps normal colors.
- Footer: `tab focus · s single/two columns · pgup/pgdn scroll · esc back`, plus the pair position
  when a batch has more than two members (`[1-2 of 3 · [ ] cycle]`).
- Narrow terminals (< 80 columns) force one column with a dim note; `s` then explains why.
- Live runs stream in (incremental tail read, 1 Hz) exactly as today; the main pane follows the
  session file.

## Acceptance Criteria

1. With zero children, Fabric renders **no** widget and **no** status line.
2. When a child spawns, a one-line row appears below the prompt within one refresh tick, before the
   child produces output, and the main agent is listed first.
3. Rows show colored name, model, activity, status and elapsed, never wrap, and cap at six rows plus
   `+N more`.
4. `/agents` lists main plus every live agent, nests descendants under their spawning agent,
   collapses/expands with the keyboard, and closes back to the chat.
5. Opening an agent replaces the chat with its full transcript (user/assistant/thinking/tool
   call/tool result), headed by its name, status and hue; `Esc` returns to `/agents`, `Esc` again to
   the chat.
6. The main agent opens as a transcript too, read from the live session file.
7. A batch of two or more agents opens as two columns with per-column headers; `s` toggles to a
   single column; focus switches with `tab`; each pane scrolls independently.
8. Every live agent has a stable, distinct color that is readable on the tinted bands in both dark
   and light themes.
9. An agent idle for more than ten minutes disappears from the rows and from `/agents`; running,
   queued and waiting agents never disappear; the files and `agent_status` still report it.
10. `x` in `/agents` cancels an agent and its descendants after an inline confirmation.
11. `/team`, `/transcript`, `alt+t` and the status line no longer exist; tool result cards are
    unchanged.
12. `npm run check` is green, with new or changed tests for the rows, the tree, hues, the idle
    filter, the two-pane screen, and the `/agents` flow.

## Validation

- **Unit (pure):** `buildTree` (nesting, collapse, groups), `assignHues` (determinism, sibling
  distinctness), `liveAgents` (10-minute boundary, non-terminal agents), rows renderer (width
  safety at 1/2/3/20/80/160 columns, cap, truncation), transcript panes (1–2 columns, width safety,
  independent scroll, narrow fallback), screen footer/key routing.
- **Integration (fake host as today):** no widget with one agent; widget appears/clears; `/agents`
  navigation, expand/collapse, cancel confirm path; Enter opens a child and main; Esc chain
  transcript → list → chat; `s` toggles columns; pruned agent absent from rows and list but present
  in `agent_status`.
- **Manual TUI checklist** in `taskWalkthrough.md`: spawn two agents in one call, watch the rows
  appear/stream, open the group (two columns), toggle, switch focus, open main, cancel one, and
  leave a finished agent for ten minutes to watch it disappear.
- **Commands:** `npm run check` (typecheck + tests + package/local checks), echoed with its summary
  line; the same suite with `PI_FABRIC_ROOT`/`PI_FABRIC_AGENT` set, since these tests are env
  sensitive.
- A live Herdr-pane run of the manual checklist before promotion.

# fabric-ui-rework — brainstorm

## Raw idea (human, verbatim)

> A new agent: As soon as it spawns, it shows somewhere prominently (Claude does it below the
> prompt, I think that is better way because it doesn't intrude the way it looks. Other way is a
> sidebar that doesn't obstruct the transcript view. So we have main agent and other agents. All
> agents (as long as there are >1) listed in that prominent sidebar.
>
> Opening that agent: Will open that agent in main transcript window. With a different color and
> identification that tells me I am in a different agent.
>
> Each agent is color coded, so that we can identify the agent's message. Claude uses the agent name
> in color, we may use backgrounds or text colors as long as the text is readable.
>
> When agent is idle and remains idle for more than 10 minutes. The agent is gone.
>
> If there are comparison agents, The side pane shows this side by side. And main pane can open it
> side by side or separately. Think similarly about other way of running them.
>
> The UI UX is almost a complete rework, so treat it like that.

## Current understanding (before answers)

- **Agents are first-class in the UI**, not tool output. The coordinator conversation is itself an
  agent ("main"); children appear alongside it as soon as they spawn — no tool result needed.
- The list is persistent while there is more than one agent, placed where it does not cover the
  transcript (below the prompt, or a non-obstructing side column).
- Selecting an agent replaces the main transcript area with that agent's conversation, visually
  distinct (color + identity marker) so it is never mistaken for the main chat.
- Every agent has a stable color used for its name/marker; message rendering may use tinted
  backgrounds as long as text stays readable.
- Idle for 10 minutes → the agent is gone from the UI.
- Comparison runs appear side by side in the side pane, and the main area can show them side by
  side or one at a time.
- This replaces the current Fabric surfaces (status line + `/team` overlay + on-demand transcript),
  not an incremental tweak to them.

## Assumptions — to confirm or correct

1. **No vertical split outside a custom screen.** Pi extensions can place horizontal widgets above
   or below the editor, or take over the whole window with a custom component; there is no
   persistent left/right pane API. A true sidebar therefore exists only inside a Fabric screen.
2. **Colors can be generated per agent** (`theme.style` + `okhslColor`, hue from the agent id) so
   agents are distinguishable without inventing a theme.
3. **Transcripts stay read-only.** The main transcript window shows an agent; it is not an input
   channel to that agent.
4. **The 10-minute rule is about visibility**, not deletion — files/state stay on disk.

## Questions and answers

### Batch 1

1. **Where the agent list lives** → *Rows below the prompt.* Claude-style: one row per agent under
   the prompt, always visible, never covering the transcript; widens to two columns when there are
   many agents. Not the left-column-inside-a-screen option.
2. **What "open in the main transcript" does** → *Replace the chat; Esc returns.* Selecting an
   agent takes the whole window (tinted, named); Esc goes back to the main chat.
3. **The 10-minute rule** → *Replace the 5-minute finished rule.* An agent idle for 10 minutes
   disappears (done, error, or cancelled). One rule, not two.
4. **Agent colors** → *Generated hue per agent: colored name + tinted band behind its message
   headers.* Hue from the agent id, theme-tuned lightness, readable text.

### Batch 2

1. **What a row shows** → *Both of the first two options combined:* colored name, model, current
   activity, status and elapsed — `● api-refactor · qwen · running npm test · 2m`.
2. **How you open an agent** → *`/agents` list only.* The rows below the prompt are display-only;
   `/agents` opens a focusable list (arrows, Enter, Esc).
3. **Comparison** → *Group by spawn call.* Agents from one `spawn_agents` call form a group, shown
   as one row in the list; opening the group shows their transcripts in two columns.
4. **Old surfaces** → *Replace both.* `/team` and `/transcript` go away; the rows + the full-window
   viewer are the only Fabric surfaces.

## Current understanding (after batch 1)

- The UI is a persistent stack of agent rows **below the prompt**, plus a full-window transcript
  view per agent. The old status line + `/team` dashboard are not the design target any more.
- Selecting an agent replaces the chat with that agent's transcript; the screen carries the
  agent's hue and identity; Esc restores the main chat.
- Colors: one stable generated hue per agent, used on its name and on a tinted header band for its
  messages.
- Visibility: an agent idle for more than 10 minutes leaves the list. Running/working agents never
  expire. (Files remain on disk — to confirm.)
- The main chat is itself an agent in that list, and the list only appears when more than one
  agent exists.

### Batch 3

1. **Row shape** → *One line, activity truncated:* `● api-refactor · qwen · running npm test · 2m`.
2. **Viewer identity** → *Hue in the header, a rule, and the message header bands.* No full-screen
   background tint; the transcript text stays normally coloured.
3. **Expired agents** → *Gone everywhere.* After 10 minutes idle an agent leaves the rows **and**
   `/agents`; files stay on disk and remain reachable through the `agent_status` tool.
4. **Main chat while viewing a child** → *The main chat is an entry you can jump to whenever two or
   more agents exist,* so you can move main ↔ child from `/agents`. (No auto-return, no banners.)

## Open after batch 2

- Row shape: with name + model + activity + status + elapsed, does it stay one truncated line?
- How strongly the viewer signals "you are in a different agent".
- Whether `/agents` lists expired agents (the rows cannot).
- What happens to new main-chat output while you are inside a child. (Answered: jumping via
  `/agents`, which lists main whenever there are 2+ agents.)

### Batch 4

1. **Esc from a child** → *Child → `/agents` → chat.* One consistent back-step; main is selected at
   the top of the list.
2. **Tool cards** → *Keep them exactly as they are.* The new rows are additive to the chat trace.
3. **Grandchildren** → *Collapsible sub-groups.* Agents spawned by an agent live under that agent
   as an expandable sub-list. (The row stack shows the nesting with an indent marker; collapsing
   happens in `/agents`, which can take keys.)
4. **Reading one member of a group** → *Two columns by default; a key toggles to one at a time*
   inside that group.

## Open after batch 1 (history)

- A widget below the prompt cannot take keyboard focus, so "select an agent" needs an explicit
  entry point (command / shortcut).
- How much each row shows.
- What a comparison run looks like, and what defines one.
- Fate of `/team` and `/transcript`.

## Current understanding (final)

- **Rows below the prompt** are the always-visible surface, only while more than one agent exists
  (main + at least one child): one line each — status icon, colored name, model, live activity,
  elapsed. Main first, then spawn order, indentation for grandchildren. Never reflow the chat.
- **`/agents` is the single entry point** for opening agents, and it lists main whenever there are
  two or more agents, so main ↔ child is a few keys away. Nested agents collapse/expand there.
- **Opening an agent replaces the chat** with its full conversation. A header (name, status) and
  the agent's hue on the name, a rule and message header bands say "you are not in main". Esc goes
  to `/agents`, Esc again to the chat. Reading only; no input to the child.
- **Colors**: one stable hue per agent, readable in dark and light themes, siblings distinguishable.
- **Comparison groups** (one `spawn_agents` call) open as two columns with per-column headers;
  a key toggles to single-column reading within the group.
- **10-minute idle → gone**, everywhere, replacing the 5-minute finished rule. Files stay on disk;
  `agent_status` still reports the agent.
- **The old surfaces disappear**: no status line, no `/team`, no `/transcript`.
- **Tool cards stay unchanged**; delegation policy, ranks, worktrees, patches and scheduling are
  untouched.

### Assumptions carried into the requirements (correct me if wrong)

1. Two-column mode scrolls each column independently, with the focused column indicated (not synced).
2. The row stack is capped (about six rows) with a `+N more` line rather than growing without bound.
3. The main agent uses the theme accent rather than a generated hue, so children are the colorful
   ones.
4. The `◆ fabric …` status line is removed, since the rows carry the same information.
5. Cancelling an agent (and its descendants) moves into `/agents` with a confirmation, because
   `/team cancel` disappears with `/team`.

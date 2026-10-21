# fabric-ui-rework — requirements

## Goal

Make the running agents part of Pi itself: a persistent stack of agent rows under the prompt, and
each agent's full conversation readable in the main window under that agent's own identity and
color.

## Who and why

For a single operator coordinating several delegated agents in one session. Today the agents are
visible only through a status line, a `/team` dashboard, and an on-demand transcript: agents that
are running are easy to forget, opening one is a command away, and once opened every agent looks
identical to the main chat. The result is lost orientation — which agent am I reading, which one is
still working, and how do I get back.

## Requirements

### Visibility

- When more than one agent exists (the main agent plus at least one child), a stack of agent rows
  appears below the prompt. When only the main agent exists, Fabric shows nothing.
- A row appears as soon as an agent spawns, before it produces any output.
- Each row is one line: status icon, the agent's colored name, its model, what it is doing right
  now (truncated to fit), and how long it has been running or since it finished.
- The stack lists the main agent first, then agents in spawn order. Agents spawned by another agent
  are indented to show that relationship.
- Rows never cover, reflow, or shrink the transcript, and they never take keyboard focus.
- Rows update on their own while agents work.

### Opening an agent

- `/agents` is the only entry point to the agent views. It lists the main agent whenever two or more
  agents exist, so moving between main and a child is always a few keys.
- The list is navigable with the arrow keys, opens an entry with Enter, collapses and expands nested
  agents, and closes with Esc.
- Opening a single agent replaces the chat with that agent's full conversation — every message, tool
  call, and tool result, in order.
- Esc inside an agent returns to `/agents`; Esc in `/agents` returns to the chat.
- The open screen identifies the agent: a header with its name and status, and the agent's color on
  the name, on a rule, and on the bands behind its message headers. The transcript body keeps the
  normal text colors.
- The agent view is read-only. There is no way to send a message to a child from it.
- A comparison group (the agents from one spawn call) opens as two columns, each with its own
  header and color. A key toggles between two columns and reading one member at a time.

### Color

- Every agent has one stable color, derived from the agent itself, so it is the same every time it
  appears.
- Colors are readable in both dark and light themes, on the text and on the tinted bands.
- Agents visible at the same time are distinguishable from each other.

### Lifecycle

- An agent that has been idle for more than ten minutes disappears from the rows and from
  `/agents`. Idle means it has finished, failed, or been cancelled.
- Agents that are running, queued, or waiting never disappear.
- Leaving the UI does not delete anything: the transcript, result, patch, and state files stay on
  disk, and the agent is still reported by `agent_status`.
- The ten-minute idle rule replaces the current five-minute finished-run pruning.

### Reconciliation with what exists

- The `◆ fabric …` status line, `/team`, and `/transcript` are removed; the rows, `/agents`, and the
  agent views take over their jobs.
- Cancelling an agent and its descendants stays available from `/agents`, since `/team cancel` goes
  away with `/team`.
- The `spawn_agents` and `await_agents` result cards in the chat stay exactly as they are.
- Recursive delegation keeps working, and agents spawned by an agent appear under it.

## Non-goals

- No change to delegation policy, model ranks, worktrees, patch capture, or scheduling.
- No vertical side pane outside `/agents` and the agent views: the platform offers horizontal bands
  or full-window screens, nothing that reserves a persistent column beside the chat.
- No input channel to a child agent (no messaging, no interrupting a child from its view).
- No auto-return, banner, or notification when the main agent produces output while a child is open.
  You jump back with `/agents`.
- No agent timeline, cost dashboard, transcript search, or export.
- No per-agent settings, prompts, or limits in the UI.

## Open questions

These are assumed; they are not blockers, and any of them can be reversed cheaply:

- Two-column comparison scrolls each column independently, with the focused column marked, rather
  than scrolling both together.
- The row stack is capped at roughly six rows and ends with a `+N more` line instead of growing
  without bound.
- The main agent uses the theme accent color rather than a generated color, so children are the
  colorful ones.
- Cancelling from `/agents` asks for confirmation before it kills a subtree.

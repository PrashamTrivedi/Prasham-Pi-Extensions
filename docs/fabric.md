# Fabric configuration and operation

## No configuration required for same-model work

When no model hierarchy is configured, a worker may spawn only the exact current model ID (`provider/model`). The default concurrency limit is six running workers per Fabric root. The interactive parent is not counted as a worker. This is a concurrency limit, not a budget or total task limit.

## Configuration lookup

1. `PI_FABRIC_CONFIG`, if set (relative paths resolve from the launching process's working directory).
2. `~/.pi/agent/pi-fabric.config.json`.
3. Legacy `config.json` beside Fabric's entry point, if present.
4. Built-in same-model defaults.

An explicit missing file, invalid JSON, or invalid configuration fails clearly rather than silently changing policy. User config should live outside the installed package. Config is read when the extension loads. A root keeps the policy it was created with, but a reload re-applies the resolved config to the existing root, so a hierarchy edit takes effect on the next spawn without starting a new session.

`peekPanel` (default `false`) adds the peek spike: a right-docked, non-capturing panel showing one live run's tail while typing continues in the main chat. `ctrl+alt+f` toggles it (the same key closes it), and it follows the working run, then a waiting one, then the newest failure. It is off until it has been judged in a real terminal; enable it and `/reload` to try it. When it is off, the shortcut is not registered at all.

The [example configuration](../examples/fabric.config.json) uses placeholder model IDs. Replace them with IDs available in your Pi installation (`pi --list-models`). The aliases are yours to choose. A model's numerical rank determines which models it can delegate to; larger ranks may delegate to equal or smaller ranks. The current root model does not have to appear in the hierarchy: models you do not name are unrestricted — they can be spawned from any caller and can delegate to any model. Naming a model is what puts it in the ordered hierarchy.

Example order:

```text
astra (5) → astra, sol, terra, luna, qwen
sol   (4) → sol, terra, luna, qwen
terra (3) → terra, luna, qwen
luna  (2) → luna, qwen
qwen  (1) → qwen
```

## Child loading

Workers launch a real Pi process with `--no-extensions --extension <exact Fabric entry>`, so Fabric works from a global package, project-local package, or explicit path without loading duplicate discovered extensions. Other automatically discovered extensions, including MCP adapters, are **not loaded in workers**. Workers still have Pi's built-in tools and normal configured model authentication. This deliberate policy favors reproducible workers; it is not a permissions sandbox. `PI_FABRIC_PI_BIN` can select the Pi executable.

Each worker also persists a real session (`--session-dir .../sessions --session-id <agent-id>`) instead of running ephemerally, so its complete transcript can be replayed after it finishes or while it still works. Pi names the file `<timestamp>_<agent-id>.jsonl`; Fabric finds it by that suffix and records the path on the agent.

## Evidence and worktrees

Each worker gets a new Git worktree based on the coordinator repository's committed HEAD at launch. Neither uncommitted parent edits nor dirty parent worktrees are copied. Commit or explicitly describe any context the child needs before delegation.

Result packets, stderr, patches, and bounded activity snapshots live in the system temporary directory under `pi-fabric/<root-id>/`. Patches compare the worker's final working tree with its launch commit. A temporary Git index includes new non-ignored files and changes committed by the worker without altering its own index. Ignored files are not included automatically. A patch error is recorded in agent metadata; never assume a successful final message guarantees a usable patch.

The root never auto-applies a patch. Workers remain ordinary processes with filesystem access, so worktree isolation is a convention for edits, not a security barrier.

## UI and lifecycle

- **Agent rows below the prompt** are the always-on surface. They appear the moment a child spawns
  (main first, children indented, groups marked) and disappear when the main chat is alone. Each row
  is one bounded line: its number, status icon, the agent's color, name, model, current activity, and
  elapsed time. A group row counts every member (`2● 1×`), so a failure cannot hide behind a running
  sibling. Past three live agents the tree collapses to `◆ fabric 3● 1◌ 2✓ 1× · /agents`, and each
  failed run keeps its own line.
- **`/agents`** is the only keyboard path to a transcript: a tree of main plus every live agent with
  expand/collapse, group rows, `x` to cancel (inline `y/n`), and `Esc` back to the chat. Rows carry
  the same numbers, so `/agents 3` opens the third row without the list and `/agents api` opens the
  run whose label or id matches (`api` exact, then prefix, then substring). `Alt+1`..`Alt+9` are the
  same jump from the editor; they register only when `<agent-dir>/keybindings.json` claims none of
  those keys, and `PI_FABRIC_ALT_JUMP=0` turns them off.
- **Opening an agent takes the whole window** (a custom screen, not an overlay) and renders with
  Pi's own chat components: `UserMessageComponent`, `AssistantMessageComponent` and
  `ToolExecutionComponent`, with the built-in tool renderers. Markdown, thinking runs, bash/read/edit
  cards, collapsed read results and `ctrl+o` expansion match the window the run came from; the same
  `outputPad` setting is read from the agent settings. Fabric adds one header line
  (`◆ api · qwen · done · $0.04 · 12k · read`) and the footer keys. The screen is an opaque
  full-width overlay: the chat is not visible behind it (only Pi's footer stays), and it owns the
  mouse wheel and the paging keys, so scrolling moves the transcript rather than the chat.
  `Esc` steps back to `/agents`, then to the chat. The main chat opens the same way from the live
  session file.
- **Transcripts follow the run.** A pane opens at the end and stays pinned to the newest lines while
  new bytes arrive. Scrolling up pauses it and the header counts what arrived meanwhile (`+2 new`);
  `f` or `End` resumes, and scrolling back to the bottom resumes by itself. A session file over 4 MB
  replays its tail (with a header note) instead of its head, and keeps following from there.
- **`o` and `y`** in a transcript write `outputs/<id>.transcript.md` and open it in `zed`
  (`PI_FABRIC_EDITOR` overrides; a missing editor is reported instead of failing silently), or copy
  the raw session JSONL path to the clipboard.
- **Comparison groups** (one `spawn_agents` call) open one member at a time, full width; `tab`
  switches members and each keeps its own scroll position and search. The `/agents` list also owns
  the viewport keys and the wheel, so a long list scrolls instead of the chat.
- **Result cards are one line per run by default** (`✓ api · qwen · first finding`); `ctrl+o` expands
  them to the comparison cards. A single result is one full-width card, never a placeholder.
- **Colors** are generated per agent from its id (theme-tuned for dark and light), so an agent keeps
  its color across sessions and siblings stay distinguishable.
- **Idle sweep:** a done or cancelled agent that stays idle for ten minutes leaves the rows and
  `/agents`. A failed run stays until its transcript is opened, so a failure inside a finished batch
  is still visible, and each failure toasts exactly once (the marker is persisted, so a reload does
  not repeat it). Pruning is display-only: `state.json`, result cards, `agent_status`, and every file
  on disk keep working.
- Result previews and transcript blocks are bounded; the saved session file keeps the rest.
- `/team` and `/transcript` no longer exist; their jobs are the rows, `/agents`, and the transcript
  screen.
- Reload restores a run reference saved in the active Pi session branch. Old pre-package sessions
  may lack that reference.
- Temporary run files must still exist to reconnect; they are not a durable archive.

There is no automatic inter-agent debate or message mailbox. Use the parent to assign independent investigations, await their evidence, and synthesize the conclusion.

## Known operational limits

The scheduler is local and filesystem-based, not a durable job service. Crashes, stale locks, interrupted waits, orphaned descendants, and platform-specific process termination may require manual recovery. Slots are released by waiting workers; resuming workers are not a hard OS resource quota. Total spending, recursion depth, and disk use are not capped. Review active processes before deleting a run directory.

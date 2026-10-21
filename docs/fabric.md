# Fabric configuration and operation

## No configuration required for same-model work

When no model hierarchy is configured, a worker may spawn only the exact current model ID (`provider/model`). The default concurrency limit is six running workers per Fabric root. The interactive parent is not counted as a worker. This is a concurrency limit, not a budget or total task limit.

## Configuration lookup

1. `PI_FABRIC_CONFIG`, if set (relative paths resolve from the launching process's working directory).
2. `~/.pi/agent/pi-fabric.config.json`.
3. Legacy `config.json` beside Fabric's entry point, if present.
4. Built-in same-model defaults.

An explicit missing file, invalid JSON, or invalid configuration fails clearly rather than silently changing policy. User config should live outside the installed package. Config is read when the extension loads. A root keeps the policy it was created with, but a reload re-applies the resolved config to the existing root, so a hierarchy edit takes effect on the next spawn without starting a new session.

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

- The live surface is the accent status line; finished agents stop counting five minutes after `finishedAt`.
- Comparison cards grow during `await_agents`; detailed final packets remain available on disk.
- `/team` opens a framed inspector. Pin two agents with `p`, then choose Compare. `Enter` replays the selected run's full transcript; `a` (or `/team all`) includes finished runs that have already left the live list.
- Result previews are bounded. An empty patch from a read-only worker is normal. Transcript blocks are bounded too, and the saved session file keeps the rest.
- Pruning is display-only: `agent_status` still lists every run and notes how many are hidden from the live views.
- `/team hide` / `/team show` toggle the status line only. `/team cancel <full-id>` requests cancellation of a subtree.
- Reload restores a run reference saved in the active Pi session branch. Old pre-package sessions may lack that reference.
- Temporary run files must still exist to reconnect; they are not a durable archive.

There is no automatic inter-agent debate or message mailbox. Use the parent to assign independent investigations, await their evidence, and synthesize the conclusion.

## Known operational limits

The scheduler is local and filesystem-based, not a durable job service. Crashes, stale locks, interrupted waits, orphaned descendants, and platform-specific process termination may require manual recovery. Slots are released by waiting workers; resuming workers are not a hard OS resource quota. Total spending, recursion depth, and disk use are not capped. Review active processes before deleting a run directory.

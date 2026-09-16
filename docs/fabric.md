# Fabric configuration and operation

## No configuration required for same-model work

When no model hierarchy is configured, a worker may spawn only the exact current model ID (`provider/model`). The default concurrency limit is six running workers per Fabric root. The interactive parent is not counted as a worker. This is a concurrency limit, not a budget or total task limit.

## Configuration lookup

1. `PI_FABRIC_CONFIG`, if set (relative paths resolve from the launching process's working directory).
2. `~/.pi/agent/pi-fabric.config.json`.
3. Legacy `config.json` beside Fabric's entry point, if present.
4. Built-in same-model defaults.

An explicit missing file, invalid JSON, or invalid configuration fails clearly rather than silently changing policy. User config should live outside the installed package. Config is read when the extension loads and snapshotted when a run is created; reload after changes and use a new session for a new hierarchy.

The [example configuration](../examples/fabric.config.json) uses placeholder model IDs. Replace them with IDs available in your Pi installation (`pi --list-models`). The aliases are yours to choose. A model's numerical rank determines which models it can delegate to; larger ranks may delegate to equal or smaller ranks. The current root model must appear in an explicitly configured hierarchy.

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

## Evidence and worktrees

Each worker gets a new Git worktree based on the coordinator repository's committed HEAD at launch. Neither uncommitted parent edits nor dirty parent worktrees are copied. Commit or explicitly describe any context the child needs before delegation.

Result packets, stderr, patches, and bounded activity snapshots live in the system temporary directory under `pi-fabric/<root-id>/`. Patches compare the worker's final working tree with its launch commit. A temporary Git index includes new non-ignored files and changes committed by the worker without altering its own index. Ignored files are not included automatically. A patch error is recorded in agent metadata; never assume a successful final message guarantees a usable patch.

The root never auto-applies a patch. Workers remain ordinary processes with filesystem access, so worktree isolation is a convention for edits, not a security barrier.

## UI and lifecycle

- The compact widget prioritizes unfinished agents and caps visible rows.
- Comparison cards grow during `await_agents`; detailed final packets remain available on disk.
- `/team` opens a framed inspector. Pin two agents with `p`, then choose Compare.
- Result previews are bounded. An empty patch from a read-only worker is normal.
- `/team hide` changes visibility only. `/team cancel <full-id>` requests cancellation of a subtree.
- Reload restores a run reference saved in the active Pi session branch. Old pre-package sessions may lack that reference.
- Temporary run files must still exist to reconnect; they are not a durable archive.

There is no automatic inter-agent debate or message mailbox. Use the parent to assign independent investigations, await their evidence, and synthesize the conclusion.

## Known operational limits

The scheduler is local and filesystem-based, not a durable job service. Crashes, stale locks, interrupted waits, orphaned descendants, and platform-specific process termination may require manual recovery. Slots are released by waiting workers; resuming workers are not a hard OS resource quota. Total spending, recursion depth, and disk use are not capped. Review active processes before deleting a run directory.

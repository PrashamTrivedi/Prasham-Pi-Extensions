# Pi Fabric extension

Pi Fabric adds recursively delegated Pi workers in isolated Git worktrees. Workers may delegate again, wait without consuming an active slot, and return result packets plus reviewable binary patches. Nothing is merged automatically.

## Install

Install the containing Pi package, or load this exact entry directly:

```sh
pi --extension /path/to/extensions/fabric/index.ts
```

Pi Fabric launches children with `--no-extensions --extension <this-entry>`. This prevents auto-discovered copies from registering duplicate Fabric tools and works whether the package is installed globally, project-locally, or loaded by path.

## Configuration

Configuration is optional. Resolution order is:

1. the path in `PI_FABRIC_CONFIG` (if set);
2. `~/.pi/agent/pi-fabric.config.json`;
3. legacy `config.json` beside `index.ts`, when present;
4. built-in defaults: six active agents and no explicit hierarchy.

An explicitly selected missing file, malformed JSON, or invalid value fails with a path-specific error. The package intentionally ships no user config or credentials.

With no model hierarchy, a worker may spawn only the exact model currently running it. To configure aliases and ranks:

```json
{
  "maxActiveAgents": 6,
  "models": {
    "large": { "id": "provider/model-large", "rank": 2 },
    "small": { "id": "provider/model-small", "rank": 1 }
  }
}
```

Higher ranks may spawn equal or lower ranks. Aliases and full IDs are accepted. Each configured `id` is passed to `pi --model`. Models absent from the hierarchy are unrestricted: they may be spawned from any caller and may themselves delegate to any model, so ranks only order delegation among the models you name.

## Safety and patches

A Git repository is required. Each worker starts from a recorded commit in its own temporary worktree. Patch capture uses a temporary Git index, so it includes tracked, deleted, binary, committed-after-launch, and untracked non-ignored files without staging or otherwise changing the worker's real index. Worktrees and outputs remain under the platform temporary directory in `pi-fabric/<root-id>/` for review.

The extension shows delegated agents as one-line rows below the prompt (colored per agent, main first, indented nesting, capped with `+N more`) and opens any of them — main included — as a full-window transcript from `/agents`, with comparison groups side by side and `s` to toggle columns. An agent idle for ten minutes leaves the UI, but its files and `agent_status` entry remain. The status line, `/team`, and `/transcript` are gone; spawn/await result cards are unchanged.

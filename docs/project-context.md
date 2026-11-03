# Project context

Injects the working directory, a bounded `tree` listing, and the Git state (branch, remote, and
uncommitted files) into the system prompt, so the model knows where it is, roughly what the project
contains, and what is currently in flight.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `PI_TREE_DEPTH` | 2 | `tree` depth |
| `PI_TREE_MAX` | 8000 | Maximum characters before truncation |
| `PI_GIT_STATUS_MAX` | 20 | Maximum uncommitted-file lines before truncation |

## Git state

Inside a repository the block also reports:

```
## Git
- branch: pi-mods-workbench
- remote: origin git@github.com:PrashamTrivedi/Prasham-Pi-Extensions.git (fetch)
- uncommitted: 2 files
```

Outside a repository, no Git section is added at all.

## When it activates

- `session_start` builds and caches the tree (one `tree`/`find` call).
- `before_agent_start` injects the block on every run, so it survives compaction, retries, and
  steering.
- The tree is cached per `cwd` until the next `session_start` (`/new`, `/resume`, `/fork`,
  `/reload`). Git state is deliberately **not** cached: branch, remote, and status are re-read on
  each run, so uncommitted changes are always current.

## Notes

- Injection is into the system prompt, not the visible chat.
- The tree and the status list are bounded, so neither can flood the context window.
- No files are read beyond the directory listing and Git metadata.
- `workbench`'s `/context` reports the tree's 8,000-character ceiling.

# Memory

Gives every project a local, file-based memory so next steps and project knowledge survive a
session. The layout mirrors Claude Code's project memory, one memory per Markdown file, plus an
index. The extension injects **only the location and a short protocol** — never memory bodies —
so the model reads and writes memories with its normal `read` / `write` / `edit` tools.

## Layout

```
~/.pi/agent/projects/<escaped-cwd>/memory/
  MEMORY.md                 # index: - [file](file) — one-line description
  next_<slug>.md            # what is in flight, what to do next, blockers
  project_<slug>.md         # durable facts: architecture, commands, gotchas, decisions
  feedback_<slug>.md        # corrections and preferences, with how to apply them
  reference_<slug>.md       # external docs, dashboards, tickets
```

`<escaped-cwd>` replaces every non-alphanumeric character with `-`
(`/root/Code/app` → `-root-Code-app`), the same escaping Claude uses, so one project keeps one
stable directory.

Each memory file is frontmatter (`name`, `description`, `type`) plus the content, and ends with
**Why:** and **How to apply:**. `next_*` is a living handoff — it is updated in place, not
duplicated per session.

## When it activates

| Hook | What happens |
| --- | --- |
| `session_start` | Creates the memory directory and an empty `MEMORY.md` when missing. Never rewrites an existing index. |
| `before_agent_start` | Appends the protocol block (absolute path, file shape, read/write triggers) to the system prompt on every run, so it survives compaction and retries. |

The tree and Git state from [project-context](project-context.md) follow the same pattern: the
tree is cached per session, Git state is re-read each run.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `PI_MEMORY_ROOT` | `~/.pi/agent/projects` | Base directory; `<root>/<escaped-cwd>/memory` is the per-project directory |

`PI_CODING_AGENT_DIR` also moves the default root, since it relocates the agent directory.

## Interplay with jev-harness

The `memory/<file>.md` shape is deliberate: when jev-harness is installed, its `memory-hygiene`
decision matches writes to `/memory/<file>.md` and asks Jev whether the new memory duplicates or
contradicts an existing one. `MEMORY.md` is exempt, so index updates are never gated.

## Notes

- No memory content enters context unless the model reads a file.
- Only Markdown under the memory directory is written; nothing else is touched.
- Secrets, tokens, and credentials are explicitly out of scope (the injected protocol says so).
- Memories are global per project, so they are not committed to the repository. Copy a file into
  the repo (or into `AGENTS.md`) when a fact belongs in version control.

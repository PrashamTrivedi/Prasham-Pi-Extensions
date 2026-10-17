# Recursive context

Pi already loads `AGENTS.md` / `CLAUDE.md` from the global agent dir, the cwd, and parent
directories. This extension fills in everything **below** the cwd (depth ≥ 1), respecting
`.gitignore`, so there is no duplication with what Pi loads itself.

Within a directory `CLAUDE.md` is ordered before `AGENTS.md`; across directories, files are
ordered root-to-leaves.

## Configuration

| Env var | Meaning |
| --- | --- |
| `PI_RECURSIVE_CONTEXT_MAX` | Maximum characters injected |
| `PI_RECURSIVE_CONTEXT_NAMES` | Comma-separated file names to collect |

## Notes

- Intended for trusted projects: it reads instruction files throughout the subtree.
- Content is injected into the system prompt.

# Project context

Injects the working directory and a bounded `tree` listing into the system prompt at the start
of every session, so the model knows where it is and roughly what the project contains.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `PI_TREE_DEPTH` | 2 | `tree` depth |
| `PI_TREE_MAX` | 8000 | Maximum characters before truncation |

## Notes

- Injection is into the system prompt, not the visible chat.
- The tree is bounded in both depth and total size, so it cannot flood the context window.
- No files are read beyond the directory listing.

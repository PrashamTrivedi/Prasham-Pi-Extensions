# Claude commands

Exposes Claude Code's markdown slash commands (`~/.claude/commands/**/*.md`) as Pi commands, so
`/name args` behaves the same in both tools.

## Behaviour

- **Discovery** is recursive. A subfolder is a namespace: `git/blame.md` becomes `/git:blame`.
  Symlink loops (for example a `commands` link back to the root) are skipped by real path.
- **Frontmatter**: `description` and `argument-hint` are used; `allowed-tools`, `model` and
  everything else is ignored. Without a description the first body line is used.
- **Expansion**: `$ARGUMENTS` is the raw argument string; `$1`..`$9` are quote-aware positional
  arguments (empty when missing). If the body references neither, the arguments are appended as
  `ARGUMENTS: ...`, as Claude does. The result is sent as a user message.
- **Shell injection** (`` !`cmd` ``) is never executed. The text stays and a note tells the model
  nothing was run.
- **Collisions**: a command whose name matches a Pi built-in, a prompt template (this package,
  `~/.pi/agent/prompts`, `.pi/prompts`) or another registered command is skipped. Skips are
  reported once per session with `ctx.ui.notify`.
- **Reload**: commands are registered at load and re-scanned on `session_start`; the body is
  re-read on every invocation, so edits apply immediately and new files after `/reload`.

## Config

| Env var | Default | Meaning |
| --- | --- | --- |
| `PI_CLAUDE_COMMANDS_DIR` | `~/.claude/commands` | Directory to scan |

## Limits

No `@file` expansion and no per-command `model` or tool restrictions.

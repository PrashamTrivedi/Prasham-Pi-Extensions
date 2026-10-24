# Walkthrough — sandbox-prompts

## Setup

1. This package is loaded locally (`.pi/settings.json` → `"packages": [".."]`), so nothing to install.
2. `/reload` in Pi so the edited `extensions/sandbox-dev/*` is live.
3. Optional: `export PI_SANDBOX_ALLOW_ROOTS=/some/scratch/dir` to add a write root.

## Verify the prompts are gone

Run these in this repository. Each should proceed with **no confirmation dialog**:

```
read ~/.pi/agent/skills/brainstorm/SKILL.md     # skill read
read ~/.claude/skills/jev-harness/SKILL.md      # outside-cwd read
write /tmp/pi-scratch.txt  "hello"              # /tmp write
bash: npm install --dry-run                     # install no longer confirms
bash: curl -sI https://example.com              # network no longer confirms
bash: grep -r curl src/                         # a mention is not a command
```

## Verify the floor still bites

These should still ask (or be blocked) — `jev-gate` may auto-approve a safe one, and a deny is
immediate:

```
bash: sudo ls                                   # confirm tier → Jev
bash: rm -rf /tmp/pi-scratch-dir                # confirm tier → Jev / human
bash: git push --force origin main              # deny
read ~/.ssh/id_rsa                              # deny
write /etc/hosts                                # confirm (outside cwd and every root)
read ~/.pi/agent/anything.env                   # deny (protected name wins)
```

## Verify the instrument

```
/dev-status
```

With no plan anchored it prints `policy: N confirm(s), M auto-approved (Jev)`; after the commands
above it should show a small N and an M covering the shell commands Jev settled. `/dev-reset`
returns both to `0`.

## What to check for a human reviewer

- No dialog appears for the first block; at most one dialog per command in the second block.
- `/dev-status` counts move only for commands in the second block.
- `PI_SANDBOX_ALLOW_ROOTS=/tmp/x` then writing `/tmp/x/a.txt` proceeds without a dialog, while
  `/tmp/y/a.txt` still confirms.

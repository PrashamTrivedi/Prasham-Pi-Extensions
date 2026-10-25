# Walkthrough — decision-first

## Setup

1. This package loads locally (`.pi/settings.json` → `"packages": [".."]`), so there is nothing to
   install.
2. `/reload` in Pi — the old permission floor is still live in the running process until you do.
3. Make sure the jev-harness adapter exists: `~/.claude/skills/jev-harness/adapters/pi/run.ts`
   (override with `PI_JEV_HARNESS_DIR`). Without it every call fails closed into a prompt.

## Verify the single gate

Every one of these should now be judged by the decision server, and run **without a prompt** when it
approves:

```
read src/index.ts                       # plain read
bash: ls                                # harmless command
bash: npm test                          # test run
write /tmp/pi-decision-first.txt        # scratch write
mcp__<server>__<tool>                   # mcp call
```

Then trigger a rejection and confirm you get exactly **one** prompt carrying the server's reason:

```
read ~/.ssh/id_rsa                      # or: bash: sudo rm -rf /tmp/x
```

- Answer **no** → the tool call is blocked with `sandbox-dev: denied by you`, and the agent continues
  without the result.
- Ask the same call again → you are prompted **again** (no memory, by design).

## Verify there are no double prompts

Watch for a second dialog from `jev-gate` right after answering one. It no longer has a `tool_call`
handler, so a second prompt means something else is gating.

## Verify fail-closed behaviour

- `bash: env PI_JEV_HARNESS_DIR=/nonexistent pi ...` — or briefly rename the adapter — then make a
  tool call: it must prompt with "the decision server is unavailable", not run silently.
- In `--print` mode (no UI), a non-approved call must be blocked, never run.

## Verify the counters

```
/dev-status
```

Prints `policy: N judged, M server-approved, P prompted`. `N` should equal roughly the number of tool
calls in the session, `P` the number of dialogs you actually saw, and `M + P = N`. `/dev-reset`
returns all three to `0`.

## What to check for a human reviewer

- No dialog for ordinary reads/writes/tests when the server approves.
- Exactly one dialog per rejected call, with the server's reason and a 300-char input preview.
- No silent execution of a rejected call, with or without a UI.
- `/dev-status` arithmetic holds, and no approval survives a new session.

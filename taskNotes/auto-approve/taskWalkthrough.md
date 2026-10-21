# taskWalkthrough — auto-approve

## Setup

Nothing special. The change is an extension behavior in this package; reload Pi (`/reload`) to pick
up the edits, or start a fresh session. Jev must be reachable at the configured endpoint
(`~/.jev-harness/config.json` → `endpoint`, with `DECISIONS_TOKEN` set), and the jev-harness adapter
must exist at `~/.claude/skills/jev-harness/adapters/pi/run.ts`.

## Verify end-to-end

### Shell auto-approval

1. In the repo, ask the agent to run a benign flagged command, e.g.:
   `curl -s https://example.com | head -c 40`
2. Observe a `sandbox-dev: auto-approved bash (Jev: safe)` notify line and the command executing
   with no approval prompt.
3. Ask the agent to run a genuinely risky command, e.g.:
   `rm -rf /tmp/jev-walkthrough-fixture && mkdir /tmp/jev-walkthrough-fixture`
   Observe a single permission prompt. Approve; the command runs. Confirm there is no second prompt.

### Plan-gate auto-approval

1. Create a low-risk plan under `taskNotes/<task>/taskFindings.md` (e.g. "add a unit test").
2. Have the agent run `dev_request_approval { "task": "<task>" }`.
3. Observe `Auto-approved <task> (Jev judged it safe)` and the agent proceeding to implement without
   a chat reply. `/dev-status` shows `outcome met` / `turn N/8` with the anchored `Original Ask`.

### Plan-gate escalation

1. Create a plan with an irreversible step (e.g. "delete the production database").
2. `dev_request_approval` on it.
3. Observe the `sandbox-dev gate` message; the agent stops and waits for the human reply.

### Fail-closed check

1. Temporarily `export PI_JEV_HARNESS_DIR=/tmp/nonexistent`.
2. Run a benign flagged shell command.
3. Observe the human permission prompt instead of a silent auto-approve.
4. Unset the variable and `/reload`.

## What to verify as a reviewer

- Safe shell commands and low-risk plans no longer interrupt you.
- Risky commands/plans still prompt exactly once, and destructive commands are blocked.
- Jev outage never silently auto-approves.
- `npm run check` is green: typecheck exit 0, `178 pass / 0 fail`.

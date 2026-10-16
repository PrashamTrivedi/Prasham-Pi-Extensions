# sandbox-dev (Pi)

Native Pi port of the three ideas behind Claude Code's `sandbox-dev` workflow. The prose lives in
`skills/sandbox-dev/SKILL.md` and `prompts/*.md`; this extension supplies the executable guarantees
that markdown cannot.

## Targets

1. **Minimal permission model.** A short allow/confirm/deny policy enforced on `tool_call` and
   `user_bash`, fail-closed when there is no UI. Not a classifier and not a sandbox.
2. **Explicit plan approval.** `dev_request_approval` (or `/dev-approve`) reads the plan from disk
   and presents the original typed gate: **`g`** (approve) / **`t: <feedback>`** (tweak) / **`r`**
   (reject/show the full plan). Only `g` approves, and approval is bound to the plan hash.
3. **Single-outcome anchoring.** The plan's `Original Ask` becomes the anchored outcome; the
   supervisor restates it each turn, enforces a turn budget, and stops when `dev_outcome_met` records
   evidence.

## Commands and tools

| Name | Kind | Purpose |
|---|---|---|
| `/dev-approve <task>` | command | Run the typed gate (g / t / r) and start `/startWork` on `g` |
| `/dev-status` | command | Show the anchored outcome and turn budget |
| `/dev-reset` | command | Clear the in-session anchor |
| `dev_request_approval` | tool | Blocking typed plan gate: g / t / r |
| `dev_outcome_met` | tool | Declare the outcome met with evidence |

## Configuration

`<agentDir>/sandbox-dev.json` then `<cwd>/.pi/sandbox-dev.json` (project wins). Missing files are
skipped; malformed files are reported and ignored so a bad project config cannot weaken the
built-in defaults. See `examples/sandbox-dev.json`.

A pattern is a case-insensitive substring, or a `/regex/` when slash-delimited.

## Session entries

- `sandbox-dev-approval` — `{ task, planHash, outcome, budget, approvedAt }`
- `sandbox-dev-outcome` — `{ task, met, evidence, at }`
- `sandbox-dev-anchor` (custom message) — the restated anchor, also counted to restore turn usage

## Limits

This is policy, not a security boundary: a permitted `bash` call can do anything the Pi process can.
Fabric workers run headless with `--no-extensions`, so none of this is active inside a worker.

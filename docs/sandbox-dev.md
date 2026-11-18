# sandbox-dev

A native Pi port of the ideas behind Claude Code's `sandbox-dev` workflow. The prose lives in
`skills/sandbox-dev/SKILL.md` and `commands/*.md`; the extension supplies only the executable
parts that markdown cannot. See [extensions/sandbox-dev/README.md](../extensions/sandbox-dev/README.md)
for the full reference.

## Targets

1. **Decision-server gate** — every `tool_call` is sent to the decision server; an approval runs it,
   and a reject, an "ask", or an unreachable server becomes one plain yes/no prompt. Failed closed
   with no UI. Nothing is blocked or pre-approved locally.
2. **Conversational plan gate** — `dev_request_approval` appends the gate to the chat; the human's
   reply in the transcript is the record. A typed `g` / `g: <note>` writes the work goal and arms
   the anchor; a model tool call can never approve.
3. **Stage goals** — approval writes `taskNotes/<task>/goal.md` (the plan's `Original Ask` inside
   the work template) and re-injects it every turn. `dev_stage { "to": "complete" }` validates the
   work, then switches the live goal to the complete goal with the mode-dependent file list.
4. **Stop-hook validation** — when the model settles, the current stage's validator runs: fs/git
   checks (artifacts, review terminal line, one-line commit, pushed branch, tests in the diff,
   paths inside the root) plus decision-server judgement over facts. Misses continue the run with
   names; three consecutive failures escalate to the human; an unreachable server never passes.

## Commands and tools

| Name | Kind | Purpose |
| --- | --- | --- |
| `dev_request_approval` | tool | Read the plan and present the gate (Jev-safe plans auto-approve) |
| `dev_stage` | tool | Work → complete: validate, rewrite the goal, reset the budget |
| `dev_outcome_met` | tool | Run the complete validator; record `met` with evidence, `not_run`, `waive` |
| `/dev-approve <task>` | command | Explicit human approval; writes the goal, anchors, starts `/startWork` |
| `/dev-status` | command | Stage, failures, `met`/`exhausted`, turn budget, waived/not-run counts, counters |
| `/dev-reset` | command | Clear the in-session gate and anchor |

## Limits

The gate's judgement is the decision server's — this package adds none of its own. Every tool call
costs one adapter subprocess plus the harness request, and each settle in an anchored run costs one
more decision-server request. A failing validator never widens scope; it returns `NOT READY` with
named misses, and `dev_outcome_met` records `met` only after a pass (or a waiver with a reason).
Which decisions are enabled, what they cover, and what is still unjudged is recorded in
[decision-server.md](decision-server.md). Fabric workers run headless with `--no-extensions`, so
none of this is active inside a worker.

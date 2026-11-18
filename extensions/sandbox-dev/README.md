# sandbox-dev (Pi)

Native Pi port of the ideas behind Claude Code's `sandbox-dev` workflow. The prose lives in
`skills/sandbox-dev/SKILL.md` and `commands/*.md`; this extension supplies the executable parts
markdown cannot.

## Targets

1. **Decision-server gate.** Every `tool_call` is mapped to the neutral jev-harness tool shape and
   sent to the decision server (`shared/jev.ts` `runJevDecision`). Approval (`{}` or no `gate`) runs
   the call silently — the tool call is its own feedback, and a line per read would be noise. Anything else — `deny`, `ask`, or an unreachable server — becomes
   exactly one plain yes/no prompt for the human, and with no UI it fails closed. Nothing is blocked
   or pre-approved locally: this package holds no dangerous-command list and no protected-path list,
   and it remembers no approval between calls. `dev_request_approval`, `dev_stage`, and
   `dev_outcome_met` are the only exempt tools. Commands the human types with `!cmd` are not judged —
   they are human actions, not tool calls.
2. **Conversational plan gate.** `dev_request_approval` reads `taskNotes/<task>/taskFindings.md`
   from disk, asks Jev (`shared/jev.ts` `askJev`) whether the plan is safe to implement autonomously,
   and either auto-approves or appends the gate to the chat for the human. The human answers in the
   transcript (**`g`** / **`t: <feedback>`** / **`r`**); the chat is the record. Any Jev failure
   fails closed to the human gate. `/dev-approve <task>` is the explicit command path.
3. **Stage goals.** Approval writes the **work goal** to `taskNotes/<task>/goal.md` — the goal
   template around the plan's verbatim `Original Ask`, plus the human's `g: <note>`. The goal is
   re-injected every turn. `dev_stage { "to": "complete" }` runs the **work validator** and only
   then rewrites the goal to the **complete goal** (procedure path + mode-dependent file list).
4. **Stop-hook validation.** When the model tries to settle, the validator for the current stage
   runs: deterministic fs/git checks plus the decision server over facts (goal, `git diff --stat`,
   artifact line counts, HEAD commit, evidence lines). A failure continues the run with the named
   misses; three consecutive failures in one stage stop it and escalate to the human. An
   unreachable server never passes. `dev_outcome_met` runs the complete validator itself and records
   `met` only on a pass.

## Commands and tools

| Name | Kind | Purpose |
|---|---|---|
| `dev_request_approval` | tool | Read the plan and present the gate (or auto-approve when Jev says safe) |
| `dev_stage` | tool | Work → complete: validate the work, rewrite the goal, reset the budget |
| `dev_outcome_met` | tool | Run the complete validator; record `met` with evidence, `not_run`, `waive` |
| `/dev-approve <task>` | command | Explicit human approval; writes the goal, anchors, starts `/startWork` |
| `/dev-status` | command | Stage, failures, `met`/`exhausted`, turn budget, waived/not_run counts, policy counters |
| `/dev-reset` | command | Clear the in-session gate and anchor |

## Checks

Deterministic (work stage): `goal.md` and `taskFindings.md` exist and are non-empty.

Deterministic (complete stage): every artifact in the mode's file list exists and is non-empty;
`review-passes.md` ends with `0 findings` | `cap (5 passes)` | `escalated`; HEAD is one line
`emoji type: subject`; the branch is 0 commits ahead of its upstream; at least one test file is in
`git diff <currentCommitHash>..HEAD`; every changed path stays inside the repo root.

Decision server (both stages): work — plan followed, work finished. Complete — evidence echoed
with exit codes and 0 failures, plan followed, every acceptance criterion (max 8, one `noul`
each), and whether any `not_run` item matters.

Miss ids are stable: `goal`, `plan`, `files`, `review-passes`, `commit`, `pushed`,
`tests-in-diff`, `diff-in-repo`, `stage`, `semantics`, `evidence`, `plan_followed`,
`work_finished`, `not_run`, `criterion_N`. `waive` accepts all of them except `semantics` (the
decision server is unreachable) and `stage` (the work stage was skipped): those must be fixed, not
excused.

## Approval flow

1. The model calls `dev_request_approval`, or the human starts the flow with `/codePlanner`.
2. The extension asks Jev whether the plan is safe to implement autonomously. If safe, it
   auto-approves: writes the work goal, arms the anchor, records an audit message, and tells the
   model to proceed. If risky, uncertain, or Jev is unavailable, it appends a `sandbox-dev gate`
   message to the transcript and stops.
3. The human replies **in the chat** for the risky case: `g` or `g: <note>` (typed input only —
   `source: "interactive"`), or runs `/dev-approve <task>`. Only then is `goal.md` written and the
   anchor armed; `t: …` and `r` leave the gate open, and a model tool call can never approve it.
4. The `g` reply stays in the transcript as the approval record the model reads.

## Goal templates

The work goal names the plan, requires tests, and ends with
`dev_stage { "to": "complete" }`; the complete goal names the plan, the absolute
`commands/completeWork.md`, and the mode-dependent `Files present` list. `goal.md` is temporary: on
`session_start` it is regenerated from the plan + artifacts (the last non-escalated
`sandbox-dev-stage` session entry supplies the task/stage/note), never read back for decisions.

## Configuration

None. There is no policy to configure, no pattern list, and no environment variable: the decision
server owns every judgement, and this extension only relays it and asks the human when the server
does not approve.

`/dev-status` prints `policy: N judged, M server-approved, P prompted` — the before/after instrument
for the gate — plus the stage, validator failures, waived/not-run counts, and the goal head.
Counters reset on session start and `/dev-reset`.

## Session entries

- `sandbox-dev-stage` — `{ task, stage, note?, mode?, escalated?, misses? }`; the resume source.
- `sandbox-dev-outcome` — `{ task, met, evidence, not_run, waive, criteria, misses, waived, at }`
  (one entry per declaration attempt; `met` is false when the validator refused).
- `sandbox-dev-stage-switch` (custom message) — settle continuations, validator misses, the stage
  announcement, and the escalation notice.
- `sandbox-dev-gate` (custom message) — the chat gate prompt and the budget-exhausted notice.

## Limits

The gate's strength is the decision server's: this package adds no judgement of its own. Every tool
call costs one Bun subprocess spawn plus the harness's own request, and a server that is down or slow
produces a prompt per tool call with no memory to quieten it. Each settle in an anchored run costs
one decision-server request (4 s timeout) and the complete stage adds git calls. Policy, not a
security boundary: an approved `bash` call can do anything the Pi process can. The plan gate is
conversational — nothing mechanically refuses a source write before approval, but a write cannot
approve the gate, and without an anchor the settle hook never supervises. Fabric workers run headless
with `--no-extensions`, so none of this is active inside a worker.

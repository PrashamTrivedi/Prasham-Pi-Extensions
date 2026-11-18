# sandbox-dev: stage goals + stop-hook validator

Extension: `extensions/sandbox-dev/` (index.ts, state.ts, policy.ts).
Why: audit of 5 complete DeepSeek runs in meta-agent-system (2026-11-13..17) showed the
skill's skeleton was followed but evidence steps were skipped (checklist echo 2/5,
verbatim outcome ~2/5, outcome declared before commit/push, "not run" items declared met).
Today `dev_outcome_met` only records a string; nothing verifies.

## Design

The **goal** is the stage. One live goal at a time, re-injected every turn, validated at
`agent_before_settle`. Source of truth for scope stays `## Original Ask` in
`taskNotes/<task>/taskFindings.md`. `taskNotes/<task>/goal.md` is a TEMPORARY copy of the live
goal; on resume/session_start it is regenerated from taskFindings.md + artifacts, never trusted.

### 1. Writing the work goal (at `g`)
- Hook `pi.on("input")`. Act only when `source` is the human (verify the InputSource value for
  typed input) AND a gate is open (`pendingAnchor`). A model-called tool must never approve.
- Parse with `/^\s*g(\s*:\s*(.*))?\s*$/is` (bare `g` is the dominant case, ~always; the note is
  optional). Match only while a gate is open, so a stray `g` later in the session is ignored.
  `t...`/`r` do not approve (gate stays open).
  `/dev-approve <task>` approves too (existing command).
- On approve, write goal.md and arm the anchor with this goal:

```
From {taskFindingFile}, implement the task mentioned below... with added tests, read and
follow approved plan from {taskFindingFile} rigorously. Once you are done, call
dev_stage { "to": "complete" }.

# Task
{verbatim ## Original Ask}
{if g had a note: "## Human note\n<note>"}
```

### 2. Stage switch (model-triggered, hook-validated)
- New tool `dev_stage { task, to: "complete" }`.
- Hook runs the WORK validator (below). Pass: rewrite goal.md + anchor goal to the complete
  goal, announce the switch in chat, reset turn budget. Fail: return `NOT READY: <misses>`.

Complete goal:
```
Verify that current software builds successfully without error, then verify task is completed
and the plan is followed from {taskFindingFile}. If it is, verify new tests are added to
validate the behavior. And confirm all the files and evidence mentioned in the skill are
present in the given format. Follow {completeWork.md path} (review loop, security review,
one-line commit, push). Then call dev_outcome_met.

# Task
{verbatim ## Original Ask}

## Files present
{mode-dependent list, see below}
```

Files list by work mode (mode = backend | frontend | both, from the plan or the human; default
backend if unspecified):
- always: `taskWalkthrough.md`, `review-passes.md` (must end with a terminal line:
  `0 findings` | `cap (5 passes)` | `escalated`), `currentCommitHash`
- backend: `backend-validation.md`; frontend: `frontend-validation.md`; both: both
- optional: task evidence (per branch rules / Parakh availability), never blocks

### 3. Validators (stop hook, `agent_before_settle`)
Run only when the model tries to settle and the outcome is not met.

Deterministic (fs/git, no model call):
- files in the goal exist and are non-empty; review-passes.md terminal line present
- complete stage: HEAD subject is one line `emoji type: subject` with no body; branch is pushed
  (0 ahead of upstream, or "not a git repo"); at least one test file in
  `git diff <currentCommitHash>..HEAD --name-only`
- diff stays inside repo root

Decision server (Jev, semantic), given FACTS not just transcript: goal text, `git diff --stat`,
file line counts, HEAD commit message, last N turns, evidence lines:
- work stage: "is the approved plan followed, is the work finished?"
- complete stage: "build/typecheck/test exit codes + 0 failures echoed? new tests cover the
  acceptance criteria / business decisions? anything in evidence marked 'not run' that the
  Original Ask needs?" Return a criterion -> evidence map; store in goal.md for the human.

### 4. Loop control
- Validator failure => `continue: true` with the specific misses (replaces generic anchor msg).
- Max 3 consecutive validator failures per stage, then stop and escalate to the human.
- Existing turn budget stays.
- Decision server unreachable => stay in stage, notify, do not pass.
- `dev_outcome_met` gains `waive: [{check, reason}]` and `not_run: string[]` (required, may be
  empty). Waivers/not_run are persisted via `pi.appendEntry` and shown in the status line.
  It runs the complete validator itself; `met` is set only on pass (or fully waived).

### 5. Non-goals
- Never auto-approve the human gate, push to a protected branch, or deploy.
- No LLM judge for things fs/git can check.
- Do not rewrite the skill/procedure files; update SKILL.md only to mention `dev_stage` and the
  new `dev_outcome_met` params.

## Acceptance
- Unit tests (extension has vitest/tests dir): input parsing (`g`, `g: note`, `t:`, `r`,
  model-source ignored), goal template rendering, mode-dependent files list, one-line commit
  regex, review-passes terminal-line parser, failure-count cap, waiver recording.
- `dev_stage` refuses while validator fails; passes rewrite goal.md.
- Typecheck + full suite 0 failures.
- Dry run on a real task dir fixture (copy from meta-agent-system `88-skills-commands-import`).

## Verified API facts
- `pi.on("input", (event: {text, source, streamingBehavior?}))` exists
  (node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:929).
- `agent_before_settle`, `before_agent_start`, `tool_call` already used in index.ts.
- Unverified: exact `InputSource` enum values; whether `input` fires for `/dev-approve`.

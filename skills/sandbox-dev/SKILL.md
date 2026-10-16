---
name: sandbox-dev
description: End-to-end autonomous development in the current session - plan, digest and get human approval, implement, complete, and finalize a task in this repository. Use when the user says "sandbox dev", "dev this", "implement this", or hands over a task, issue, or ticket to be implemented autonomously.
---

# Sandbox Dev - In-Session Autonomous Development

Everything runs end-to-end in this session. There is no Docker and no tmux, and
there is no sandbox mode, auto mode, or permission-mode setting to detect. A Pi
extension owns tool permissions: it gates every tool call as **allow**,
**confirm**, or **deny**, and it fails closed (denies) when no interactive UI is
present to ask a human. Your job is to stay inside the repo, respect a deny, and
never try to route around the gate.

**Flow:** Plan → Digest & Approval → Implement → Complete → Finalize

---

## Extension Surface

This skill is driven by a Pi extension. Know these names precisely:

| Kind | Name | Purpose |
|------|------|---------|
| Tool | `dev_request_approval` | Args `{ task: "<task-dir-name>" }`. Reads `taskNotes/<task>/taskFindings.md` from disk and blocks on the typed plan gate: `g` (go/approve), `t: <feedback>` or `t` (tweak), `r` (reject/show the full plan). |
| Tool | `dev_outcome_met` | Args `{ task, evidence }`. Declares the single stated outcome achieved. `evidence` must be raw transcript-visible output (exit codes, test summary lines), not a claim. |
| Command | `/dev-approve <task>` | Human-side plan gate - the same `g` / `t: <feedback>` / `r` prompt. |
| Command | `/dev-status` | Print the extension's current approval/outcome state for the session. |
| Command | `/dev-reset` | Clear approval/outcome state and start the supervision cleanly. |

The extension records approvals as `sandbox-dev-approval` session entries. After
approval it supervises the run against one stated **single outcome** with a turn
budget. Do not promise any sandbox, auto, or unattended mode; there is none.

The extension also reports the absolute paths of the three native procedure files
(`codePlanner.md`, `startWork.md`, `completeWork.md`) in the system prompt. Use
those paths with the `read` tool; do not guess a relative path.

---

## PHASE 0: PREFLIGHT

Do **not** probe environment variables, settings files, or permission modes -
there is nothing to detect, and promising a mode would be wrong. Do only this:

1. **Confirm the repo root.** Every write must stay inside it.

   ```bash
   pwd
   git rev-parse --show-toplevel 2>/dev/null || echo "not a git repository"
   ```

2. **Confirm the task token.** The task token is exactly the directory name under
   `taskNotes/`, kebab-case, at most 3 words. Use the name the user supplied; if
   none was supplied, derive it from the request and state it in one line. If the
   token is ambiguous, ask before continuing. You will pass this same token to
   `dev_request_approval` and `dev_outcome_met`.

3. **Note who owns permissions.** The extension gate - not you, not a sandbox -
   decides what is allowed. If a call is denied, read the message, change the
   plan, and never reword, encode, or indirect a command to slip past the gate.
   If the plan genuinely requires an operation the gate denies, stop and ask the
   human rather than fighting it.

4. **Resume check.** If `taskNotes/<task>/taskFindings.md` already exists, the
   task is already planned. If this session has no approval yet, skip to PHASE 2
   to get approval; otherwise skip to PHASE 3. Use `read` to inspect the task
   directory when unsure.

---

## PHASE 1: PLANNING

produce a plan unless one already exists. Two equivalent ways:

- The human runs the `/codePlanner` command with a ticket id and/or description.
- You load the planner procedure yourself and execute it: `read` the
  `codePlanner.md` path reported by the extension, and follow it with the
  requirement as its argument.

Either way the deliverable is `taskNotes/<task>/taskFindings.md` in the plan
shape described below. Do not ask the human to review yet, and do not wait for
approval here - approval happens in PHASE 2 through the extension.

If the requirement list is empty, ask for one concrete requirement before
planning.

---

## PHASE 2: PLAN DIGEST & HUMAN APPROVAL

**Step 2.1 - Build the digest table first.** Read
`taskNotes/<task>/taskFindings.md` with the `read` tool. The `## Original Ask`
section holds the user's requirements; everything else is the implementation
plan. Compare the two and extract **facts only** - no opinions, no
recommendations. Print this exact format to the transcript:

---
**📋 Plan Digest: {task-name}**

| Signal | Value |
|--------|-------|
| Complexity | Score and summarized reason |
| Gaps found | {list} OR "None" |
| Edge cases | {list} OR "None" |
| Potential bugs | {list} OR "None" |
| Simplifications possible | {yes/no} + brief explanation |
| External deps added | {list} OR "None" |
| Highest risk | {single riskiest part of the plan} |
| Files touched | {count}: {comma-separated list} |
| New abstractions | {count}: {names} OR "None" |
| Existing code modified | {Yes - what / No - additive only} |

**Rejected alternatives:** {simpler approaches considered but skipped, with the stated reason - or "None mentioned"}

**Watch for:** {schema migrations, auth changes, new patterns, broad refactors - or "Nothing unusual"}
---

Echo the digest into the transcript before the next step: it is the human's only
summary of what they are about to approve.

**Step 2.2 - Request approval with the tool.** Call:

```
dev_request_approval { "task": "<task-dir-name>" }
```

The tool reads `taskNotes/<task>/taskFindings.md` from disk and presents the typed
gate: **`g`** (go - approve), **`t: <feedback>`** (tweak; `t` alone opens a
multi-line editor), or **`r`** (reject - show the full plan, then choose again).
The human can also run `/dev-approve <task>`.

**Step 2.3 - Act on the result.**

| Result | Action |
|---|---|
| Approved | Proceed to PHASE 3. Only now may you implement. |
| Approved (`g`) | Proceed to PHASE 3. Only now may you implement. |
| Rejected / feedback (`t` or a plain message) | The human's text comes back **verbatim** in the tool result. Update `taskNotes/<task>/taskFindings.md`, re-run Step 2.1 (new digest), and call `dev_request_approval` again. |
| No response / blocked | Do not implement. Wait. If the session was interrupted, ask the human to run `/dev-status`. |

Only `g` (or `go`/`yes`) approves. Any other text - with or without a `t:`
prefix - is a revised requirement: fold it into the plan and request approval
again. `r` only re-reads the plan; it never approves. A cancelled gate is not
approval.

Never implement a plan that has not been approved in this session. If you are
unsure of the state, ask the human to run `/dev-status`; if the state is stale or
corrupted, the human can `/dev-reset`. Do not call `dev_request_approval` more
than once in a row without new feedback; it blocks and would just spin.

---

## PHASE 3: IMPLEMENTATION

Load the implementation procedure and follow it: `read` the `startWork.md` path
reported by the extension, and run it for `<task>`, selecting the branch strategy
from the complexity score.

### Single-outcome anchoring (mandatory)

After approval the extension supervises this run against exactly one outcome and
a turn budget. Anchor to it before touching code:

1. **State the outcome verbatim.** Copy the `## Original Ask` section of
   `taskFindings.md` into the transcript as the single outcome. Do not paraphrase
   and do not add goals.
2. **Work only toward that outcome.** Everything you do in PHASE 3 must trace to
   it. Do not opportunistically fix unrelated things, expand scope, or refactor
   beyond the plan.
3. **Echo evidence as you go.** Command output is the only proof the supervisor
   and the human can see: print exit codes and the test summary line after each
   meaningful command. A green state that exists only on disk does not count.
4. **When the outcome is met, declare it** by calling:

   ```
   dev_outcome_met {
     "task": "<task-dir-name>",
     "evidence": "<raw transcript-visible output: exit codes and test summary lines>"
   }
   ```

5. **If you conclude more work is needed outside the outcome, stop and ask for a
   new plan.** Do not silently widen the task. Say what is needed, why it is
   outside `Original Ask`, and let the human re-plan (a new
   `dev_request_approval` cycle).

### Parallel tracks

Work that splits into genuinely independent, parallel tracks may be delegated
with the Fabric tools `spawn_agents` (model-invoked) and gathered with
`await_agents`. Use them only when the tracks are truly independent. Workers run
headless with no UI and do **not** inherit your uncommitted context, so every
task string must be self-contained: include the repo, the task token, the file
paths, the exact deliverable, and how to verify it. Review the returned evidence
and patches yourself before trusting them.

---

## PHASE 4: COMPLETION

Load the completion procedure and follow it: `read` the `completeWork.md` path
reported by the extension, and run it for `<task>`.

Completion owns the evidence: build/typecheck/test must pass, tests covering the
criteria must be **new or changed in this diff**, the full suite must show 0
failures, the bounded review loop must terminate, the walkthrough and validation
artifacts must exist, and the work must be committed with a conventional one-line
message. Do not call `dev_outcome_met` before those proofs are in the transcript.

---

## PHASE 5: FINALIZE

Summarize what was done:

- Files created and modified.
- Key decisions and any rejected alternatives.
- Test results, including the exact suite summary line and exit codes.
- Evidence echoed for the outcome, and the outcome statement itself.
- Caveats, follow-ups, and any work explicitly deferred as outside the outcome.

---

## Preservation Rules

These identifiers are part of the state machine and must not be renamed or
invented:

- `taskNotes/<task>/taskFindings.md` - the plan. `## Original Ask` is the single
  source of truth for scope.
- `taskNotes/<task>/currentCommitHash` - the commit the work started from.
- `taskNotes/<task>/taskWalkthrough.md` - human setup and verification steps.
- `taskNotes/<task>/review-passes.md` - finding counts per review pass.
- `taskNotes/<task>/specs/specs.md` - spec breakdown for complexity >= 3.
- `taskNotes/<task>/triageReport.md` - bug investigation output.
- `taskNotes/<task>/backend-validation.md` and `frontend-validation.md` -
  validation artifacts when those modes apply.

Branch-per-task-by-complexity, conventional one-line commits, the bounded
review-fix loop, and the "tests new or changed in the diff, 0 failures" bar are
defined in the `startWork.md` and `completeWork.md` procedures; keep them
consistent.

---

## Anti-Patterns

- Detecting or promising a permission mode. There is none; the extension gate is
  the only permission authority.
- Implementing before `dev_request_approval` returns approved.
- Treating a plan on disk as approval. Approval is a session event, recorded as a
  `sandbox-dev-approval` entry.
- Declaring an outcome with a claim instead of raw output.
- Expanding scope beyond `Original Ask` instead of stopping to ask for a new plan.
- Creating a TODO list. Capture the plan in `taskFindings.md` instead.

# Purpose

Turn the sandbox-dev anchor into a validated two-stage goal (work → complete) so the skill's
evidence steps cannot be skipped: `g` writes the goal, `dev_stage` switches only after the work
validator passes, and `dev_outcome_met` records `met` only after the complete validator passes
(fs/git checks + decision-server judgement).

## Original Ask

*(Quoted verbatim from `spec.md`; embedded headings are blockquoted so this section stays one anchored block.)*

> # sandbox-dev: stage goals + stop-hook validator

Extension: `extensions/sandbox-dev/` (index.ts, state.ts, policy.ts).
Why: audit of 5 complete DeepSeek runs in meta-agent-system (2026-11-13..17) showed the
skill's skeleton was followed but evidence steps were skipped (checklist echo 2/5,
verbatim outcome ~2/5, outcome declared before commit/push, "not run" items declared met).
Today `dev_outcome_met` only records a string; nothing verifies.

> ## Design

The **goal** is the stage. One live goal at a time, re-injected every turn, validated at
`agent_before_settle`. Source of truth for scope stays `## Original Ask` in
`taskNotes/<task>/taskFindings.md`. `taskNotes/<task>/goal.md` is a TEMPORARY copy of the live
goal; on resume/session_start it is regenerated from taskFindings.md + artifacts, never trusted.

> ### 1. Writing the work goal (at `g`)
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

> # Task
{verbatim ## Original Ask}
{if g had a note: "## Human note\n<note>"}
```

> ### 2. Stage switch (model-triggered, hook-validated)
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

> # Task
{verbatim ## Original Ask}

> ## Files present
{mode-dependent list, see below}
```

Files list by work mode (mode = backend | frontend | both, from the plan or the human; default
backend if unspecified):
- always: `taskWalkthrough.md`, `review-passes.md` (must end with a terminal line:
  `0 findings` | `cap (5 passes)` | `escalated`), `currentCommitHash`
- backend: `backend-validation.md`; frontend: `frontend-validation.md`; both: both
- optional: task evidence (per branch rules / Parakh availability), never blocks

> ### 3. Validators (stop hook, `agent_before_settle`)
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

> ### 4. Loop control
- Validator failure => `continue: true` with the specific misses (replaces generic anchor msg).
- Max 3 consecutive validator failures per stage, then stop and escalate to the human.
- Existing turn budget stays.
- Decision server unreachable => stay in stage, notify, do not pass.
- `dev_outcome_met` gains `waive: [{check, reason}]` and `not_run: string[]` (required, may be
  empty). Waivers/not_run are persisted via `pi.appendEntry` and shown in the status line.
  It runs the complete validator itself; `met` is set only on pass (or fully waived).

> ### 5. Non-goals
- Never auto-approve the human gate, push to a protected branch, or deploy.
- No LLM judge for things fs/git can check.
- Do not rewrite the skill/procedure files; update SKILL.md only to mention `dev_stage` and the
  new `dev_outcome_met` params.

> ## Acceptance
- Unit tests (extension has vitest/tests dir): input parsing (`g`, `g: note`, `t:`, `r`,
  model-source ignored), goal template rendering, mode-dependent files list, one-line commit
  regex, review-passes terminal-line parser, failure-count cap, waiver recording.
- `dev_stage` refuses while validator fails; passes rewrite goal.md.
- Typecheck + full suite 0 failures.
- Dry run on a real task dir fixture (copy from meta-agent-system `88-skills-commands-import`).

> ## Verified API facts
- `pi.on("input", (event: {text, source, streamingBehavior?}))` exists
  (node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:929).
- `agent_before_settle`, `before_agent_start`, `tool_call` already used in index.ts.
- Unverified: exact `InputSource` enum values; whether `input` fires for `/dev-approve`.

## Complexity and the reason behind it

**4/5.** Two new modules (pure stage/template logic + fs/git/Jev validators) and a behaviour
change in every existing entry point (input hook, dev_stage, dev_outcome_met, settle, status).
The git checks and the fixture dry run are the verification-heavy part; there is no schema,
auth, or migration risk. Complexity 4 → separate branch `sandbox-dev-stage-goals`.

## Architectural changes required

Verified API facts the design depends on (read from the installed Pi 1.5.0 types and dist):

- `InputSource` is `"interactive" | "rpc" | "extension"`; a typed prompt is `interactive`, and
  `pi.sendUserMessage` is `extension`. The input handler must return `{ action }`; returning
  `undefined` is treated as `continue` by the runner.
- **The `input` hook does not fire for extension commands**: `AgentSession.prompt()` dispatches
  `/dev-approve` before `_preparePrompt()` → `_runInputHandlers()`. So `/dev-approve` is the
  explicit path and `input` only sees ordinary prompts. The spec's unverified item is resolved.
- Decision-server question types are only `noul`, `choice`, `score` (jev-harness
  `core/types.ts`). There is no structured map answer, so the "criterion → evidence map" is
  implemented as one `noul` per acceptance criterion (max 8), rendered as
  `- [0.93] criterion` in goal.md.
- The human's `g` reply is **not consumed** (`{ action: "continue" }`): it stays in the
  transcript as the approval record the model reads, exactly like `t:` feedback. The hook only
  arms the anchor and writes goal.md.
- **Human decision (this session): keep Jev auto-approve.** When Jev judges the plan safe, the
  extension arms immediately and writes the work goal from the plan (no human note). Every
  path that arms — `g`, `/dev-approve`, Jev auto-approve — goes through one `approve()` helper,
  so the goal is always written.

New modules:

- `extensions/sandbox-dev/stage.ts` — pure, no fs/network: stage/work-mode types, gate-reply
  parser, work/complete goal templates, `detectMode`, `requiredArtifacts`, one-line commit regex,
  `review-passes` terminal parser, `MAX_STAGE_FAILURES`, waiver application, acceptance-criteria
  extraction, criterion questions/render, `goalMessage` for re-injection.
- `extensions/sandbox-dev/validate.ts` — facts + checks: `git()` helper (execFileSync, no shell),
  `collectFacts`, deterministic checks (files non-empty, review terminal line, HEAD one-line
  commit, pushed, test file in diff, paths inside repo root), Jev questions (work: plan followed
  / work finished; complete: evidence echoed, per-criterion, not-run matters, plan followed),
  `validateWork` and `validateComplete`. Jev is injected as a dependency object so tests stub it.

`index.ts` wiring:

- Anchor gains `stage: "work" | "complete"`, `goal: string`, `note?: string`, `failures: number`,
  `escalated: boolean`, `waived`/`notRun`/`criteria` snapshots.
- `approve(ctx, task, note?)`: read plan → outcome → `workGoal()` → write goal.md (atomic-ish
  write, guarded task name) → arm anchor at `work` → `appendEntry("sandbox-dev-stage", …)` →
  status/notify. Used by the input hook, `/dev-approve`, and the Jev-safe auto-approve path.
- `pi.on("input")`: only `source === "interactive"` (and gate open) → `parseGateReply` → approve.
- `dev_stage { task?, to }`: work validator → on fail `NOT READY: …` (+ failure count, escalate
  at 3) → on pass write `completeGoal()`, set stage, reset budget/failures, append entry,
  `pi.sendMessage` announcement.
- `dev_outcome_met { task, evidence, waive?, not_run }`: complete validator (regardless of stage,
  plus a `stage` check when still in work) → apply waivers (need non-empty reason) → persist
  `{ met, evidence, waive, not_run, criteria, misses }` via `appendEntry`; `met` only on pass.
- `agent_before_settle`: budget → validator for the current stage → failure adds a specific
  `NOT READY` message and a failure; 3rd failure stops and escalates; pass in work → "call
  dev_stage"; pass in complete → "call dev_outcome_met"; Jev unreachable counts as a failure
  named `semantics` and never passes.
- `before_agent_start`: inject `LIVE GOAL (stage …)` + goal text (capped 8 KB) alongside the
  existing procedure-path line.
- `session_start`: re-arm from the last `sandbox-dev-stage` session entry by **regenerating**
  the goal from `taskFindings.md` + artifacts (mode detection), never reading goal.md.
- `state.ts` `extractOutcome`: ignore headings inside fenced code blocks. The planner gate
  refused this very plan because the quoted ask contains its own `#`/`##` headings; real tickets
  do too. Fence-awareness fixes it instead of requiring hand-mangled plans.
- `/dev-status`: stage, failures/escalated, met/exhausted/turn, waived/not_run counts, policy line.

`goal.md` is written only by the extension (plan/tool stage) and is listed as temporary; it is
never read back for decisions.

## Backend changes required

None (extension + tests only). No API, schema, or dependency change.

## Frontend changes required

None. Chat/TUI output only: stage announcement, status line, validator miss messages.

## Acceptance Criteria

- [ ] AC1 `parseGateReply`: `g`, `g: <note>`, `G : note`, and multi-line `g` approve; `t: …`, `r`,
      arbitrary text do not. Only `source === "interactive"` while a gate is open.
- [ ] AC2 Work goal renders the verbatim `## Original Ask` and appends `## Human note` only when
      the approval carried a note; approve writes `taskNotes/<task>/goal.md` and arms the anchor.
- [ ] AC3 Complete goal lists the mode-dependent files (`backend` → `backend-validation.md`;
      `frontend` → `frontend-validation.md`; `both` → both; always walkthrough, review-passes,
      currentCommitHash) and names the absolute `completeWork.md` path.
- [ ] AC4 `isOneLineConventionalCommit` accepts `✨ feat: Add X` (incl. ZWJ emoji like `🧑‍💻`)
      and rejects a body, a missing emoji, and an unknown type; `terminalReviewLine` accepts only
      `0 findings`, `cap (5 passes)`, `escalated` as the last non-empty line (markdown bullet and
      backticks tolerated).
- [ ] AC5 3 consecutive validator failures in one stage stop the run and escalate; a pass resets
      the counter; `dev_stage` resets it too.
- [ ] AC6 `dev_outcome_met` persists `waive` + `not_run` via `appendEntry`; a failed check is only
      bypassed by a waiver with a non-empty reason; `/dev-status` shows both counts.
- [ ] AC7 `dev_stage` returns `NOT READY: <misses>` while the work validator fails, and on pass
      rewrites `goal.md` with the complete goal, announces the switch, and resets the budget.
- [ ] AC8 Settle-time failure continues with the specific misses (not the generic anchor text);
      an unreachable decision server stays in stage and never passes.
- [ ] AC9 `dev_outcome_met` runs the complete validator and sets `met` only on pass or full
      waiver; early (work-stage) declaration fails with a `stage` miss.
- [ ] AC10 Fixture dry run: `tests/fixtures/taskNotes/88-skills-commands-import` copied into a
      temp git repo (committed + pushed) passes `validateComplete`; removing
      `review-passes.md`'s terminal line or a validation artifact fails it.
- [ ] AC11 `npm run typecheck` exit 0; `npm test` 0 failures.
- [ ] AC12 `skills/sandbox-dev/SKILL.md` mentions `dev_stage` and the new `dev_outcome_met` params;
      extension README + `docs/sandbox-dev.md` updated.
- [ ] AC13 `extractOutcome` returns the full section when the ask contains fenced `#` headings,
      and still stops at the next real same-or-higher heading.

## Validation

Commands (all from the repo root):

- `npm run typecheck` → exit 0.
- `bun test tests/sandbox-dev` → 0 fail (unit: stage + validators + extension harness).
- `npm test` → full suite 0 fail.
- `node scripts/check-package.mjs && node scripts/check-local.mjs` → exit 0 (local-first rule:
  the extension is already in `pi.extensions` and `.pi/settings.json`).

Behavioural proof, in order:

1. **Fixture dry run** — build a temp git repo from the fixture, commit with a valid one-line
   message, push to a temp bare origin; `validateComplete` → `ok: true`, criterion map non-empty.
   Mutate one artifact → `ok: false` with the named miss.
2. **Gate to goal** — harness (no UI): present the gate, send `input {text:"g: prefer tests
   first", source:"interactive"}` → `goal.md` exists and contains the note; `source:"extension"`
   with a fresh gate writes nothing; `t: …` keeps the gate open.
3. **Plan extraction** — a plan whose `## Original Ask` embeds a fenced markdown heading
   (`# Task`) yields the whole section, not an empty anchor.
4. **Stage switch** — `dev_stage` with stubbed Jev "not finished" → `NOT READY`; with "finished"
   → `goal.md` rewritten with `## Files present`, chat announcement sent, turn budget reset.
5. **Settle** — in work stage with a failing validator, `agent_before_settle` → `continue: true`
   with `NOT READY`; 3 in a row → no continue + escalation notification. In complete stage with
   everything green but the outcome undeclared → continue pointing at `dev_outcome_met`.
6. **Outcome** — `dev_outcome_met` with missing artifacts → `met: false` recorded; after adding
   them (or waiving each miss with a reason) → `met: true`, `not_run` persisted, `/dev-status`
   shows the counts.
7. **Live end-to-end (this session)** — after `/reload`, `dev_request_approval` arms the new
   work goal, `dev_stage` passes against this repo once artifacts/commit/push exist, and the
   final `dev_outcome_met` records the typecheck + suite lines.

Manual UI check: `/dev-status` prints the stage, goal file path, failures, waived/not_run.

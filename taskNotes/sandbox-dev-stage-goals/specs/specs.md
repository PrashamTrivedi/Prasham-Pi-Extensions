# Specs — sandbox-dev stage goals

Breakdown of `taskFindings.md` into independently verifiable slices. Each slice lands with its
own tests; the order is the dependency order.

## S1 — `stage.ts` (pure stage logic)

- Types: `Stage = "work" | "complete"`, `WorkMode = "backend" | "frontend" | "both"`.
- `parseGateReply(text)` using the spec regex `^\s*g(\s*:\s*(.*))?\s*$/is`; `t…`/`r`/anything else
  is not an approval.
- `workGoal({ taskFindingFile, outcome, note? })` and
  `completeGoal({ taskFindingFile, outcome, completeWorkPath, mode })` — verbatim template text
  from the spec.
- `detectMode(planText, note?)` (explicit `work mode: …` / `mode: …` wins; default `backend`).
- `requiredArtifacts(mode)` + `optionalEvidence`.
- `isOneLineConventionalCommit(message)`, `COMMIT_SUBJECT_RE`.
- `terminalReviewLine(text)` + `REVIEW_TERMINAL_RE`.
- `MAX_STAGE_FAILURES = 3`, `applyWaivers(misses, waive)`.
- `extractCriteria(planText)`, `criterionQuestions(criteria)`, `renderCriteria`.
- `goalMessage({ goal, stage, turn, budget, failures })` for re-injection.
- Verification: `tests/sandbox-dev/stage.test.ts`, pure, no fs.

## S2 — `validate.ts` (facts + fs/git/Jev checks)

- `git(cwd, args)` via `execFileSync` (no shell), returns trimmed stdout or `undefined`.
- `collectFacts(cwd, task)` → goal, plan, `git diff --stat`, artifact line counts, HEAD message,
  last-N-turn text, evidence lines.
- Deterministic checks with stable ids: `goal`, `plan`, `files`, `review-passes`, `commit`,
  `pushed`, `tests-in-diff`, `diff-in-repo`.
- Jev checks: work (`plan_followed`, `work_finished`), complete (`evidence_echoed`,
  `criterion_N` ≤ 8, `not_run_matters`, `plan_followed`). Threshold 0.6; the criterion score map
  is returned for goal.md. Unreachable Jev → miss `semantics`, never a pass.
- `validateWork` / `validateComplete` inject `askJev` so tests never touch the network.
- Verification: `tests/sandbox-dev/validate.test.ts` with real temp git repos (bare origin).

## S3 — `index.ts` wiring

- `approve()` shared by `input`, `/dev-approve`, and the kept Jev auto-approve path: reads the
  plan, writes `goal.md`, arms `{stage:"work", goal, note}`, appends a `sandbox-dev-stage` entry.
- `pi.on("input")` gate: `source === "interactive"` + `pendingAnchor` only; returns `continue`.
- `dev_stage` tool + work validator + stage switch + chat announcement + budget reset.
- `dev_outcome_met` gains `waive`/`not_run`, runs `validateComplete`, persists outcome.
- Settle: stage-specific validator, specific misses, 3-failure escalation, budget unchanged.
- `before_agent_start`: live goal; `session_start`: regenerate (never read `goal.md`).
- `/dev-status` extended.
- Verification: `tests/sandbox-dev/extension.test.ts`, `autoprocess.test.ts` updated harness
  (needs `getBranch`, git fixture helpers).

## S4 — fixture + dry run

- `tests/fixtures/taskNotes/88-skills-commands-import/` copied (trimmed) from
  `~/Code/meta-agent-system/taskNotes/88-skills-commands-import`: `taskFindings.md`,
  `requirements.md`, plus synthesized `taskWalkthrough.md`, `review-passes.md`,
  `currentCommitHash` placeholder, `backend-validation.md`.
- Integration test builds a temp repo from it (git init, commit, bare origin push) and asserts
  `validateComplete` passes; then mutates one artifact per case and asserts the named miss.
- Verification: `tests/sandbox-dev/validate.test.ts` dry-run describe block.

## S5 — docs

- `skills/sandbox-dev/SKILL.md`: `dev_stage`, new `dev_outcome_met` params, stage wording.
- `extensions/sandbox-dev/README.md`, `docs/sandbox-dev.md`: tools table, flow, checks, limits.
- Verification: `node scripts/check-package.mjs` + manual read; no test.

## Out of scope (explicit)

- Rewriting `commands/*.md` (startWork/completeWork/codePlanner).
- Removing Jev auto-approve (human chose to keep it).
- Auto-push, protected branches, deploys.
- Any change to `herdr-agent-state.ts`.

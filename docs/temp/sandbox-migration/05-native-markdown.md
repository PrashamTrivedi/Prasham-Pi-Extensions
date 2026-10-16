# 05 - Native Pi Markdown Port

Port of Claude Code's `sandbox-dev` skill and its `codePlanner`, `startWork`,
and `completeWork` commands into native Pi markdown (skill + prompt templates).

## Files

| File | Type | Lines |
|------|------|-------|
| `skills/sandbox-dev/SKILL.md` | Skill | 244 |
| `prompts/codePlanner.md` | Prompt template (`/codePlanner`) | 225 |
| `prompts/startWork.md` | Prompt template (`/startWork`) | 211 |
| `prompts/completeWork.md` | Prompt template (`/completeWork`) | 199 |

No other repository file was touched. `package.json` is unchanged; `skills/` and
`prompts/` are the conventional Pi package resource directories, so no manifest
entry is required.

## What was preserved

- The `PHASE 0..5` structure of the skill: preflight, planning, digest &
  approval, implementation, completion, finalize.
- The `taskNotes/<task>/` state machine and exact filenames:
  `taskFindings.md`, `currentCommitHash`, `taskWalkthrough.md`,
  `review-passes.md`, `specs/specs.md`, `triageReport.md`, plus
  `backend-validation.md` / `frontend-validation.md`.
- The plan-document shape: Purpose, Original Ask, complexity and reason,
  architectural/backend/frontend change plan, Acceptance Criteria, Validation.
- Branch-per-task-by-complexity (same branch at <= 3, separate branch at >= 4).
- Conventional one-line commit messages (emoji + type + subject, no body).
- The bounded review-fix loop (deep pass 1, confirm passes 2+, stop at zero, stop
  at 5 passes or two non-decreasing counts, then escalate).
- The "tests covering the criteria must be new or changed in the diff, full suite
  0 failures" bar, plus the walkthrough and validation artifacts.

## Design targets

1. **Minimal permission model.** PHASE 0 no longer probes environment variables or
   settings files. It only confirms the repo root, confirms the task token, and
   states that the Pi extension gate (`allow` / `confirm` / `deny`, fails closed
   without UI) owns permissions. No sandbox or auto mode is promised anywhere.
2. **Explicit plan approval.** The free-text gate is replaced by
   `dev_request_approval { task }`, which reads and prints
   `taskNotes/<task>/taskFindings.md` and blocks until the human types `approve`
   (or runs `/dev-approve <task>`). The skill builds and echoes the digest table
   first, then calls the tool, and implements only after approval.
3. **Single-outcome anchoring.** After approval the skill restates the plan's
   `Original Ask` verbatim, restricts work to it, echoes transcript-visible
   evidence, and calls `dev_outcome_met { task, evidence }` when met. Work outside
   the outcome stops the run and requests a new plan.

Extension surface documented in the skill: tools `dev_request_approval` and
`dev_outcome_met`; commands `/dev-approve <task>`, `/dev-status`, `/dev-reset`;
session entry type `sandbox-dev-approval`.

## Substitutions applied

- Frontmatter reduced to `name`/`description` for the skill and
  `description`/`argument-hint` for prompts. All `allowed-tools` and the
  `codePlanner` `PreToolUse` hook were dropped.
- The singular `$ARGUMENT` was replaced with `$ARGUMENTS` everywhere.
- `@taskNotes/...` file inlining was replaced with explicit `read` tool
  instructions for each state file.
- Claude tools mapped to native Pi tools: `Bash` -> `bash`, `Read` -> `read`,
  `Write` -> `write`, `Edit`/`MultiEdit` -> `edit` (with an `edits[]` array when
  multiple), `Grep` -> `grep`, `Glob`/`find` -> `find`.
- GitHub integration is the `gh` CLI via `bash` (no GitHub integration server is
  registered).
- Subagents use the Fabric `spawn_agents` / `await_agents` tools, reserved for
  genuinely independent tracks; task strings are required to be self-contained
  because workers are headless and do not inherit uncommitted context.
- Deleted the local cockpit HUD calls (the `hud` binary), the slash-command goal
  envelope (the `/goal` mechanism), and references to `/sandbox`, `/permissions`,
  `/code-review`, and `/security-review`.
- The `checkpoint-validator`, `dependency-auditor`, `conventional-commit`,
  `code-review`, `testcase`, and `parakh-testing` behaviors were inlined as
  concrete native instructions instead of being ported, since those skills are
  out of scope for this task.

## Behavior deliberately dropped

- **Permission-mode probing** (`CLAUDE_CODE_SANDBOXED`, `settings.json`
  `defaultMode`): the extension gate supersedes it, so probing would be both dead
  and misleading.
- **`/goal` evaluator loops**: replaced by the extension's single-outcome
  supervision and `dev_outcome_met`. The transcript-provable-evidence rule was
  retained as a first-class instruction.
- **HUD cockpit updates**: no HUD exists in Pi.
- **Non-Pi slash commands** (`/sandbox`, `/permissions`, `/code-review`,
  `/security-review`): replaced by concrete instructions (run typecheck/build/
  tests and report exit codes and summary lines; perform the bounded review loop
  and a diff security review directly).
- **`memory-server` lookups and the web-search/triage/qa-validator/
  documentation-updater subagents**: no equivalent is registered, so each was
  replaced either with repository reading, the `gh` CLI, or direct native
  instructions (`triageReport.md`, integration/browser verification, doc edits,
  optional `spawn_agents`).

## Grep confirmation

Command run against the four ported files:

```bash
grep -nE 'allowed-tools|\$ARGUMENT([^S]|$)|@taskNotes|/goal|hud|TodoWrite|WebSearch|MultiEdit|mcp__' \
  skills/sandbox-dev/SKILL.md prompts/codePlanner.md prompts/startWork.md prompts/completeWork.md
```

Result: **no matches** for any forbidden token. Each token's individual count:

| Token | Matches |
|-------|---------|
| `allowed-tools` | 0 |
| `$ARGUMENT` (singular) | 0 |
| `@taskNotes` | 0 |
| `/goal` | 0 |
| `hud` | 0 |
| `TodoWrite` | 0 |
| `WebSearch` | 0 |
| `MultiEdit` | 0 |
| `mcp__` | 0 |

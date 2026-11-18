# Walkthrough — sandbox-dev-stage-goals

## Setup

1. From the repo root: `npm run check` (typecheck + full suite + package/local checks).
2. Load the local package: `/reload` in Pi (the repo's `.pi/settings.json` already loads it).
3. Have a planned task: `taskNotes/<task>/taskFindings.md` with a `## Original Ask`.

## Verify the goal gate

1. Ask the agent to call `dev_request_approval { "task": "<task>" }`.
2. If Jev judges the plan safe, it auto-approves and writes `taskNotes/<task>/goal.md`; otherwise a
   **sandbox-dev gate** message appears. Reply `g` (or `g: <note>`).
3. Check `taskNotes/<task>/goal.md`: it starts `From taskNotes/<task>/taskFindings.md`, contains
   the verbatim `Original Ask`, `dev_stage { "to": "complete" }`, and a `## Human note` when you
   replied with one. `t: …` and `r` leave the gate open and write nothing.
4. `/dev-status` shows `stage: work`, `turn 0/8`, `validator failures: 0/3`, and the goal head.

## Verify the stage switch

1. Finish the work and its tests, then have the agent call `dev_stage { "to": "complete" }`.
2. While Jev says the work is unfinished it returns `NOT READY: - work_finished: …` and leaves the
   work goal in place; three consecutive failures print `ESCALATED` and stop the run.
3. On a pass the goal becomes the complete goal: `## Files present` lists `taskWalkthrough.md`,
   `review-passes.md`, `currentCommitHash`, and the mode's validation file; the budget resets.

## Verify the outcome

1. Write `taskWalkthrough.md`, `review-passes.md` ending in `0 findings` | `cap (5 passes)` |
   `escalated`, the mode's validation file, and `currentCommitHash`.
2. Commit with one line `emoji type: subject`, push, and make sure a test file is in
   `git diff $(cat taskNotes/<task>/currentCommitHash)..HEAD`.
3. Call `dev_outcome_met { "task": "<task>", "evidence": "<exit codes + summary lines>",
   "not_run": [] }`. On a pass it records `met: true` and appends `## Verification (extension)`,
   `## Waived`, `## Not run`, and `## Outstanding` to `goal.md`.
4. Deliberately fail one check (remove the review terminal line) and re-run: it returns
   `NOT READY` and records `met: false`. Add
   `"waive": [{ "check": "review-passes", "reason": "docs only" }]` and it passes; an empty reason
   does not.
5. `/dev-status` shows `stage: complete`, `met: true`, and the `waived:` / `not run:` counts.

## Fixture dry run (no live plan needed)

```bash
bun test tests/sandbox-dev/validate.test.ts -t "88-skills-commands-import"
```

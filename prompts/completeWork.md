---
description: Complete and finalize a task with build/test verification, a bounded review loop, validation artifacts, walkthrough, and a conventional commit.
argument-hint: <task-directory-name> [work mode: backend|frontend]
---

# Complete Work

Confirm and finalize the code and documentation changes for a planned task.

## Arguments

From `$ARGUMENTS`:

- **Directory name**: the `taskNotes/<name>/` directory holding
  `taskFindings.md`. Required.
- **Work mode**: `backend` or `frontend` (or "others"). Determines which
  validation artifact is expected.

## Autonomous Mode Detection

Operate in AUTONOMOUS MODE if `$ARGUMENTS` contains `mode: autonomous`.

In autonomous mode:

- Do NOT ask for user confirmation - proceed with best practices.
- Do NOT wait for user input - make decisions and continue.
- Use the project's standard commands (`npm run typecheck`, `npm run build`,
  `npm test`, or the equivalents declared in `package.json`).
- If the directory name is missing, infer it from context (inspect `taskNotes/`)
  or fail with a clear error.

---

## Context

Read these with the `read` tool (there is no file-inlining syntax):

- **Plan**: `taskNotes/<ArgumentDirectoryName>/taskFindings.md`
- **Start commit** (git repos only):
  `taskNotes/<ArgumentDirectoryName>/currentCommitHash`

If `taskFindings.md` is missing:
- Autonomous mode: STOP and report the error - cannot complete without a plan.
- Interactive mode: ask the user to run `/codePlanner` first.

---

## Steps

1. **Confirm the directory name.** Autonomous mode: infer from context or error
   out. Interactive mode: ask before proceeding.

2. **Read the change.** Read the uncommitted changes and the task context.
   If in a git repository, read `currentCommitHash` and list the changes between
   that commit and `HEAD`:

   ```bash
   git diff <currentCommitHash>..HEAD --stat
   git diff <currentCommitHash>..HEAD
   ```

   If not in a git repository, inspect recent file changes instead. Read the code
   carefully and confirm whether it satisfies the plan's requirements.

3. **Build and verify.** Run the project's typecheck, build, and test commands.
   Echo every exit code and the test summary line into the transcript.
   - If a command fails, think hard about the single change that would satisfy the
     requirements, fix it, and re-run until green.
   - Do not declare success on a command whose output is not in the transcript.

4. **Bounded review-fix loop.** Review the diff and fix findings, recording the
   finding count after each pass to
   `taskNotes/<ArgumentDirectoryName>/review-passes.md`:
   - **Pass 1**: the deep pass. Read the whole diff line by line; surface the most
     findings here (correctness, edge cases, error handling, tests, naming).
   - **Pass 2+**: confirm the prior fixes and catch issues those fixes spawned.
   - Fix what you can, then re-review.
   - **Stop at zero findings.**
   - **Stop at 5 passes**, or when two successive counts are equal or rising -
     the fixer cannot resolve that class. Print the remaining findings and
     escalate to the human. Do NOT keep going.
   - Each pass echoes its finding count into the transcript.

5. **Security review of the diff.** Agent-authored multi-file changes leak
   vulnerabilities through change interactions, not single lines. Review the diff
   for: auth/authorization changes, credential or secret handling, injection
   (`eval`, `exec`, raw SQL, shell interpolation), unsafe deserialization, and
   `dangerouslySetInnerHTML`-style escapes. Fix what is safe to fix and surface
   what needs product judgment. Echo a one-line result per class checked.

6. **Tests must prove the criteria.**
   - Tests covering the `## Validation` and `## Acceptance Criteria` sections must
     be **new or changed in this diff**. An untouched test file means the criteria
     are unverified, whatever the suite reports.
   - Full suite: **0 failures**.
   - Coverage of changed files: up to 95%. Do not chase past it.
   Write tests against the code as implemented here. This is not a spec-first
   track; it closes out the work.

7. **Run the end-to-end tests and collect evidence.**
   - Backend mode: run the integration tests for the latest change, exercising the
     API flows with concrete cases (curl or the project's test runner).
   - Frontend mode: exercise the site through the browser. If a browser automation
     skill is available, load it with `read <skills-dir>/playwright-cli/SKILL.md`;
     otherwise follow the plan's manual UI steps and record screenshots/output.
   - Collect the raw output: exit codes, pass/fail summary lines, and any relevant
     request/response or DOM evidence.

8. **Update documentation.** Make sure no documentation is missing or outdated:
   `README.md`, code comments, `docs/`, and any usage examples touched by the
   change. Update them now. If the update is an independent track, it may be
   delegated with `spawn_agents` + `await_agents`, with a self-contained task
   string.

9. **Write the validation artifact.** For backend work, write
   `taskNotes/<ArgumentDirectoryName>/backend-validation.md`. For frontend work,
   write `taskNotes/<ArgumentDirectoryName>/frontend-validation.md`. Include the
   commands run, their output, and the criteria each one proves.

10. **Write the walkthrough.** Create
    `taskNotes/<ArgumentDirectoryName>/taskWalkthrough.md` containing:
    - How to set up for the task (backend: curl commands; frontend: UI steps).
    - What to run to verify end-to-end, including relevant curls and UI steps.
    - What to verify: database states, user states, or additional curls that prove
      the task succeeded for a human reviewer.

11. **Commit.** In a git repository, stage and commit all uncommitted files with a
    conventional one-line message - emoji plus type plus subject, no body:

    ```bash
    git add .
    git commit -m '✅ test: Add coverage for task completion flow'
    ```

    | Emoji | Type | When |
    |-------|------|------|
    | ✨ | feat | New features or functionality |
    | 🐛 | fix | Bug fixes |
    | 📝 | docs | Documentation changes only |
    | ♻️ | refactor | Restructuring without behavior change |
    | 🎨 | style | Formatting, whitespace |
    | ⚡ | perf | Performance improvements |
    | ✅ | test | Adding or correcting tests |
    | 🧑‍💻 | chore | Tooling, configuration, dependencies |
    | 🚧 | wip | Incomplete work in progress |
    | 🔥 | remove | Removing code or files |
    | 🚑 | hotfix | Critical production fix |
    | 🔒 | security | Security improvements |

12. **Push** the branch in a git repository.

13. **Declare the outcome.** In an autonomously supervised run, once the proofs
    above are echoed into the transcript, call:

    ```
    dev_outcome_met {
      "task": "<ArgumentDirectoryName>",
      "evidence": "<raw transcript-visible exit codes and test summary lines>"
    }
    ```

    Only call it when the evidence is already printed. If completion uncovered
    work outside the planned outcome, do not declare it - stop and ask for a new
    plan.

14. **Recommend the next step.** Read the artifacts and decide, pragmatically:
    - Backend: the next step is implementing the frontend if a frontend task
      exists.
    - Frontend: the next step is releasing.
    State the recommendation in one or two lines.

---

## Completion Checklist

Echo each item with its proof before finishing:

```
[ ] typecheck exit code
[ ] build exit code
[ ] full test suite: <pass> pass, <fail> fail
[ ] tests new/changed in diff: <files>
[ ] review passes: <counts>, terminated by <zero | cap | escalation>
[ ] security review: <classes checked>
[ ] validation artifact: <path>
[ ] walkthrough: <path> (<line count>)
[ ] commit: <subject>
[ ] pushed: <yes/no/not a git repo>
[ ] outcome declared: <dev_outcome_met called | pending>
```

## Anti-Patterns

- Declaring done without the exit codes and summary line in the transcript.
- Chasing the review loop past 5 passes or past two non-decreasing counts.
- Shipping criteria with no new or changed test.
- Skipping the walkthrough or validation artifact because tests are green.
- A multi-line commit message.
- Widening scope beyond the plan's `## Original Ask`.

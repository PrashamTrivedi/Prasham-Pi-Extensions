---
description: Start or continue a planned task with branch management, checkpoint validation, and conventional commits.
argument-hint: "<task-directory-name> [branch: same|separate]"
---

# Start Work

Start or continue a task that already has a plan.

## Arguments

From `$ARGUMENTS`:

- **Directory name**: the `taskNotes/<name>/` directory holding
  `taskFindings.md`. Required.
- **Branch strategy**: whether to work in the same branch or a separate one.
- **`mode: autonomous`**: presence of this string switches the run to autonomous
  behavior (below). If absent, operate interactively.

## Autonomous Mode Detection

Operate in AUTONOMOUS MODE if `$ARGUMENTS` contains `mode: autonomous`.

In autonomous mode:

- Do NOT ask for confirmation on branch strategy - apply the recommendation.
- Do NOT wait for user input - proceed with best practices.
- Do NOT ask the user to run other commands - run them yourself, or skip if not
  possible.
- Decide based on the complexity score and proceed.

---

## Context

### Check whether this is a git repository

- `test -d .git && echo "true" || echo "false"`

### Run these commands if it is a git repository

- Current status:
  `test -d .git && git status --porcelain || echo "Not a git repository"`
- Current branch:
  `test -d .git && git branch --show-current || echo "Not a git repository"`
- Uncommitted changes:
  `test -d .git && git diff --name-only || echo "Not a git repository"`

### Plan and state files

Read these with the `read` tool (there is no file-inlining syntax):

- **Plan**: `taskNotes/<ArgumentDirectoryName>/taskFindings.md`
- **Start commit** (if it exists): `taskNotes/<ArgumentDirectoryName>/currentCommitHash`
- **Validation artifacts** (if they exist):
  `taskNotes/<ArgumentDirectoryName>/backend-validation.md` and/or
  `taskNotes/<ArgumentDirectoryName>/frontend-validation.md`

Do not proceed on a plan you have not actually read.

---

## Steps

1. **Auto-detect whether the working directory is clean.** Record dirty files and
   decide whether they belong to this task.

2. **Check the plan exists.** If `taskNotes/<ArgumentDirectoryName>/taskFindings.md`
   is missing:
   - Autonomous mode: STOP and report the error - cannot proceed without a plan.
   - Interactive mode: ask the user to run `/codePlanner` first.

3. **Dependency check.** Check for outdated packages and vulnerabilities:
   `npm outdated --json` and `npm audit --json` (substitute the project's package
   manager if it is not npm). Warn only for critical security issues or major
   version changes; do not stop the flow. If the repository has a dependency-auditor
   skill installed, you may instead follow `read <skills-dir>/dependency-auditor/SKILL.md`.

4. **Decide the branch strategy** (only in a git repository):
   - Complexity 3 or less: the current branch is fine.
   - Complexity 4 or more: a separate branch is recommended.
   - Already on a separate branch for this task: continue on it.
   - Autonomous mode: apply the recommendation without asking.
   - Interactive mode: ask the user to confirm.

5. **Create the branch when a separate branch is chosen** and you are in a git
   repository:
   - Fetch and check out the latest `main` (or the repository's default branch).
   - Create a new branch named exactly `<ArgumentDirectoryName>`.

   When the same branch is chosen, or there is no git repository, continue where
   you are. If in a git repository, ensure the branch is up to date with `main`
   first.

6. **Record the start commit.** Before writing any code, if in a git repository,
   write the current commit hash to
   `taskNotes/<ArgumentDirectoryName>/currentCommitHash` with the `write` tool.
   If the file already exists, the work has started already.

7. **Detect resume.** If `currentCommitHash` already exists, inspect the task
   directory (`taskNotes/<ArgumentDirectoryName>/`) and determine status:
   - `taskFindings.md`: analysis done.
   - `currentCommitHash`: work started. Check commits between that hash and
     `HEAD`.
   - `backend-validation.md` / `frontend-validation.md`: the matching layer was
     verified.
   - Remember: frontend work does not start until backend contracts are verified.
   - Staged and unstaged files also show progress.
   - **On resume ONLY**, read `git diff {currentCommitHash}..HEAD --stat` before
     continuing. This is the one point where you inherit changes you did not
     observe; it is not needed at any other checkpoint.

8. **Implement the task** per the plan's Task Contents. Keep changes scoped to
   the plan's `## Original Ask`.

### Single-outcome anchoring (mandatory in autonomous mode)

Autonomous runs are supervised by a Pi extension against **one** stated outcome
and a turn budget. Before implementing:

- Restate the outcome verbatim from the plan's `## Original Ask` section into the
  transcript. Do not paraphrase, do not add goals.
- Work only toward that outcome. If you conclude extra work is needed outside it,
  STOP and ask for a new plan instead of widening scope.
- Echo command output into the transcript as you go: exit codes and the test
  summary line. A green state on disk is not evidence.
- When the outcome is met, call
  `dev_outcome_met { "task": "<ArgumentDirectoryName>", "evidence": "<raw transcript-visible exit codes and test summary lines>" }`.
- Use `/dev-status` to inspect approval/outcome state and `/dev-reset` to clear
  it when a human asks.

### Parallel tracks

If the task splits into genuinely independent tracks, delegate with
`spawn_agents` and collect with `await_agents`. Workers run headless with no UI
and do not inherit your uncommitted context, so each task string must be
self-contained (repo, task token, file paths, deliverable, verification). Review
the returned patches and evidence before trusting them.

### Commit messages

Use conventional one-line commits - emoji plus type plus subject, nothing else,
no body:

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

Example: `git commit -m '✨ feat: Add JWT authentication'`

### Checkpoint Strategy

- Commit after each MAJOR component, not after minor edits.
- Checkpoints: BACKEND API, integration boundaries, FRONTEND integration.
- Micro checkpoints: go from the atomic unit of code up to a complete feature and
  commit when the component is whole.
- **After each checkpoint**, validate only what could have broken:
  - Start from `git diff --name-only HEAD` (or `--staged`).
  - For each changed source file, find its test in order: co-located
    (`src/foo.ts` -> `src/foo.test.ts`), mirrored (`src/foo.ts` ->
    `tests/foo.test.ts`), spec variant (`src/foo.spec.ts`). A changed test file
    is itself a test to run.
  - Widen to the full typecheck and suite when a shared utility, a type-only
    file, or a config file changed, or when nothing matched.
  - Run the incremental typecheck (e.g. `npx tsc --noEmit --incremental`) and the
    selected tests. Echo the exit codes and summary line into the transcript.
  - Record the checkpoint's result. Do not commit on a red checkpoint.
- **At the final checkpoint**: run the typecheck before committing (not a full
  build), and run the full test suite only here.

### Wrapping up

Once the work is done, typechecked, and tested:

- Autonomous mode: proceed directly to completion (`read prompts/completeWork.md`
  and follow it for this task). You may call `dev_outcome_met` only once the
  evidence in the transcript proves the outcome.
- Interactive mode: ask the user to run `/completeWork <task>`.

---

## Checkpoint Report

After each checkpoint, print a short report the human and the supervisor can see:

```
Checkpoint: <name>
Changed: <files>
Typecheck: exit <code>
Tests: <command> -> <pass> pass, <fail> fail
Next: <next component>
```

## Anti-Patterns

- Committing on red tests or a failing typecheck.
- Running the full suite at every checkpoint instead of at the final one.
- Writing a multi-line commit body.
- Silently expanding scope past `## Original Ask`.
- Claiming a green run without echoing the command output.

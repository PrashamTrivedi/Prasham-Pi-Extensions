---
description: Plan and analyze one or more code tasks with comprehensive project understanding, writing taskFindings.md plans under taskNotes/.
argument-hint: <github-ticket-id | task-description>[, more requirements...]
---

# Code Planner

Understand the code and the requirements before any implementation. Supports a
single requirement or many; each requirement gets its own report.

Arguments: `$ARGUMENTS`

## Arguments

- One or more requirements: GitHub ticket IDs, task descriptions, or a mix.
- Multiple requirements should be comma-separated, newline-separated, or
  explicitly numbered (`1. 2. 3.`).
- If `$ARGUMENTS` is empty, ask for one concrete requirement and stop.

---

# Phase 1: Project Context (Run Once)

Gather shared context before processing any requirement.

## Commands to run

- Current directory: `pwd`
- Project structure: `tree -L 3 -I 'node_modules|.git'` (if `tree` is absent, use
  `find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*'`)

## Git context (if applicable)

- Git status: `git status 2>/dev/null || echo "Not a git repository"`
- Current branch:
  `git branch --show-current 2>/dev/null || echo "Not a git repository"`
- Recent commits:
  `git log --oneline -5 2>/dev/null || echo "Not a git repository"`
- Remote info: `git remote -v 2>/dev/null || echo "Not a git repository"`
- Git files: `git ls-files 2>/dev/null || echo "Not a git repository"`

## Shared context lookup

- There is no external memory server in Pi. All shared context lives in the
  repository: `README.md`, `docs/`, existing `taskNotes/`, and code comments.
  Read the ones relevant to the requirement.
- There is no web-search tool registered. Use the `gh` CLI for GitHub data and
  the shell for anything else.

## Output

Hold this context mentally; it applies to ALL requirements. Do not write it to a
file.

---

# Phase 2: Parse Requirements

From `$ARGUMENTS`, extract the list of requirements.

- Split by comma, newline, or explicit numbering (`1. 2. 3.`).
- Each item becomes a separate requirement to process.
- If only one requirement exists, treat it as a list of one.

**Example inputs:**

- Single: `123` or `Add dark mode`
- Multiple: `123, 456, Add caching` or a newline-separated list

---

# Phase 3: Process Each Requirement (Loop)

For EACH requirement in the list, execute the following steps independently.

## Step 3.1: Understand the Requirement

- If GitHub ticket ID: fetch details with the `gh` CLI, e.g.
  `gh issue view <id> --comments` (there is no GitHub integration other than the
  CLI; use `gh` through `bash`).
- If task description: parse and understand the ask.
- If both: combine ticket details with the additional context.

## Step 3.2: Read Relevant Code

- Read code files relevant to THIS specific requirement.
- Understand adjacent files' structure and style when creating new files.
- If the requirement involves bugs: investigate and write the findings to
  `taskNotes/<directory-name>/triageReport.md` - root cause, affected paths,
  reproduction, and proposed fix. Do not skip the written report.

## Step 3.3: Intelligence Gathering (per-requirement)

- Repository: search for prior `taskNotes/` entries, docs, and related code.
- GitHub: use `gh` for issues, PRs, labels, and project data.
- External references: consult repository docs first. There is no web-fetch tool;
  if a URL is truly required, fetch it with the shell and cite what you read.

## Step 3.4: Determine Output Location

- Directory name: short, kebab-case, at most 3 words.
- Check whether you are upgrading existing functionality:
  - Upgrade: move existing docs into a versioned directory (`v1`) and write the
    new plan under `taskNotes/<directory-name>/`.
  - New: create a fresh directory.
- Path: `taskNotes/<directory-name>/taskFindings.md`

## Step 3.5: Create the Plan

Write the plan directly to `taskNotes/<directory-name>/taskFindings.md` in both
interactive and autonomous modes. There is no plan mode in Pi; writing the file
is the deliverable, and review happens later through the sandbox-dev approval
gate.

```markdown
# Purpose

A one-liner high-level purpose of the task.

## Original Ask

Exact original requirements AS IS. This section is the single source of truth for
scope and is later restated verbatim as the run's single outcome.

## Complexity and the reason behind it

Complexity score out of 5 and the reason for that score.

## Architectural changes required

If none, say so; otherwise write the architectural plan.

## Backend changes required

If none, say so; otherwise write the backend implementation plan.

## Frontend changes required

If none, say so; otherwise write the frontend implementation plan.

## Acceptance Criteria

For complexity >= 3, enumerate explicit criteria. For complexity <= 2, state that
the criterion is complete satisfaction of Original Ask - do not leave the section
empty.

## Validation

High-level description of what to test and how, including the commands to run
and what to verify. For frontend: user steps. For backend: API flows with cases.
```

### Complexity Scoring Rules

- Do not over-score simple fullstack tasks.
- Consider your capabilities: greenfield scaffolding and CRUD are lower scores.
- Factor in verification difficulty.
- For dependency upgrades: consider breaking changes, new features, and total
  change surface.

## Step 3.6: Specs (for complexity >= 3)

- Create `taskNotes/<directory-name>/specs/`.
- Write the breakdown to `specs/specs.md`.
- Create an individual `taskFindings.md` for each spec item.
- Update the main `taskFindings.md` to reference the specs.

## Step 3.7: Report Completion

After writing `taskFindings.md` for a requirement, mark it complete in your own
tracking before moving to the next requirement.

---

# Phase 4: Summary (Run Once)

After ALL requirements are processed:

## If single requirement

- Present the plan path and a short summary.

## If multiple requirements

- List all generated reports with paths:

  ```
  Reports generated:
  1. taskNotes/{dir1}/taskFindings.md - [brief description]
  2. taskNotes/{dir2}/taskFindings.md - [brief description]
  ...
  ```

- Say which reports to review and how to proceed.

---

# Iteration

- If the user asks to change a plan, read the relevant `taskFindings.md` and
  update it in place.
- Absence of a `taskFindings.md` means a fresh plan, not an iteration.
- Any message before `/startWork` is plan iteration.

---

# EXIT

## Autonomous mode (`mode: autonomous` in `$ARGUMENTS`)

- Write all `taskFindings.md` files, print their paths, and return.
- Do NOT ask for review.
- Do NOT ask the user to invoke `/startWork`; the caller drives the next phase.

## Interactive mode

- After writing ALL `taskFindings.md` files, ask the user to review and provide
  feedback.
- When the user confirms, present a funny, made-up Star Wars quote.
- Ask the user to run `/startWork <task>` to begin implementation, or to run the
  sandbox-dev approval flow if they invoked this from that skill.

## Both modes

- AVOID creating a TODO list. Capture everything in `taskFindings.md`.

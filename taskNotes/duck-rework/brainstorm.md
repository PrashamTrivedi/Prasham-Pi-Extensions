# Duck rework — brainstorm

**Status: draft, not validated with the human.** Nothing here is a decision yet. No code is
planned from this document; it exists to drive the first brainstorm batch.

## Raw idea

> Duck will be reworked a lot. I don't like current duck.
> Next session starts with requirements and design — not code. Do not treat any existing duck
> behaviour as a constraint worth preserving just because it exists.

The previous `taskNotes/duck-answer-pane/` plan was deleted at the human's request. Its three
decisions (questionnaire as a shared tool, duck auto-opening, questions + answers written to the
editor) are not binding. Only what this brainstorm re-derives is.

## What exists today

- A `duck` tool (`extensions/duck/index.ts`), `exposure: "direct"`, read-only, sequential.
- It takes the **latest assistant text** on the branch (or a `focus` string) and asks the active
  model, in-process, for a JSON array of 1–4 questions with 2–4 options each.
- The questions are handed to `AskUserQuestion`; the answers come back inside Duck's tool result.
- A parse failure degrades to one open-ended question; a model failure is an error result.
- There is no duck command, no docked panel, no editor write, and no persistence. `docs/duck.md`
  and the README described the older docked-panel design until 2026-11-05.

## Friction this code makes plausible (hypotheses to confirm)

Ordered by how likely they explain "I don't like current duck":

1. **The input is thin.** Only the last assistant message is reviewed — no diff, no touched files,
   no tool output, no earlier turns. The reviewer cannot see what was actually attempted, so the
   questions read as generic.
2. **The role is wrong.** "Questions only" may not be what the human wants from a second opinion;
   a verdict (what is risky, what is missing, what to do next) might be more useful, with questions
   only when a decision is genuinely theirs.
3. **The interaction is one-shot.** There is no follow-up, no "explain that", no way to answer one
   question and keep the review going.
4. **It costs like the main model.** The active (often expensive) model generates the review, on
   demand, with no cheap-model routing and no result reuse.
5. **The surface is a tool call.** It fires when the agent decides to call it, not when the human
   wants it; there is no shortcut, no command, and no control over when it runs.
6. **The output shape is rigid.** At most 4 questions × 4 options through a modal may be the wrong
   container for a review that wants prose and evidence.

## Directions worth weighing

| Direction | What it changes | Trade-off |
| --- | --- | --- |
| **A. Richer input** | Feed the reviewer the plan, the working diff, files touched, and selected tool results, with hard caps | Needs redaction/caps and a cheap way to collect context; more input = more cost |
| **B. Verdict first, questions second** | Default output is a short review (risks, missing tests, unstated assumptions); questions only for decisions the human owns | Changes the tool's contract; the human may still want pure questions |
| **C. Review conversation** | Answers and follow-ups continue the review instead of ending it | More state and turns; cost per review grows |
| **D. Role picker** | The caller chooses a lens (correctness, security, DX, test coverage) or the reviewer picks one | Risk of duplicating other extensions (semantic lint, sandbox gates) |
| **E. Cheap-model routing** | Review runs on a configured cheap model, escalating only when the first pass is weak | Quality variance; needs a routing policy |
| **F. Human-initiated surface** | A command or shortcut opens the review on demand; the agent-side tool stays for automation | Two surfaces to keep consistent |

## Open questions for the human (first batch)

1. What should a second opinion **produce** by default: questions, a written verdict, or both?
2. When should it run: only when you ask, when the agent asks, or automatically before a plan is
   accepted?
3. What context should it see: the plan only, the plan + diff + touched files, or the whole turn?
4. Which model should review: the active model, a configured cheap model, or a per-run choice?

Answers to those four decide most of the design. Later batches: whether the review should be a
conversation, how answers return to the main chat, where it is surfaced (tool, command, panel),
and what the failure/fallback behaviour is.

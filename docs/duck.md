# Duck

A questions-only second opinion on the current plan, via an in-process nested model call
(`ctx.modelRegistry.streamSimple`). No subprocess, no provider API call from the extension.

## Commands

| Command | Purpose |
| --- | --- |
| `/duck [focus]` | Ask for questions. With no focus, runs against the latest assistant message; run again to close. |
| `/duck answer` | Open the questionnaire for the questions the model returned, and write the answers into the editor. |
| `/duck close` | Dismiss the docked panel. |

## How it works

1. The latest assistant text on the branch is used as the plan.
2. The model is asked to return **only** a JSON array:
   `[{ "header", "question", "options": [{ "label", "description" }], "allowOther" }]`.
3. The answer is parsed once, on completion. Markdown fences and surrounding prose are
   tolerated; each `[` is tried in turn. Headers are truncated to 12 characters, questions
   are capped at 4, and options at 4. A question with no usable options still works via
   "Type something.".
4. If nothing parses, the raw text is shown instead (capped at 5 question lines).

The result is rendered as a **docked widget above the editor** — it reserves layout space and
does not cover the transcript. Widgets take no keyboard input, so the interaction lives in
commands rather than keystrokes.

## Answering (Claude-style)

`/duck answer` opens the shared questionnaire (`extensions/shared/questionnaire.ts`), which
mirrors Claude Code's AskUserQuestion: one tab per question with an answered indicator, an
arrow-key option list with descriptions, a "Type something." inline editor, and a Submit tab
that refuses until every question is answered.

On submit, the chosen answers are composed into a markdown block and written into the editor
via `ctx.ui.setEditorText`. **They are not auto-sent** — you review and send them yourself.
Any draft already in the editor is preserved; the block is appended.

## Files

- `extensions/duck/index.ts` — commands, nested call, docked panel.
- `extensions/duck/prompt.ts` — the JSON-only prompt.
- `extensions/duck/questions.ts` — tolerant parse and clamping.
- `extensions/duck/answers.ts` — questionnaire mapping and the editor block.
- `extensions/shared/questionnaire.ts` — the reusable AskUserQuestion modal.

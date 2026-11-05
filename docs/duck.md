# Duck

A questions-only second opinion on the current plan: an in-process nested model call
(`ctx.modelRegistry.streamSimple`) generates the questions, and the shared `AskUserQuestion`
tool presents them. No subprocess, no provider API call from the extension, no docked panel.

## Tool

| Tool | Purpose |
| --- | --- |
| `duck` | Generates 1–4 clarifying questions about the latest assistant plan (or a `focus`) and asks them through `AskUserQuestion`. The answers come back in Duck's own tool result, straight to the chat. |

The model is instructed with `extensions/duck/prompt.ts`:

1. The latest assistant text on the branch is used as the plan (or `focus`, when given).
2. The model returns **only** a JSON array:
   `[{ "header", "question", "options": [{ "label", "description" }], "allowOther" }]`.
3. The answer is parsed once, on completion. Markdown fences and surrounding prose are
   tolerated; each `[` is tried in turn. Headers are truncated to 12 characters, questions
   are capped at 4, and options at 4. A question with no usable options still works via
   "Type something.".
4. If nothing parses, the raw text becomes one open-ended question.

## Answering

Questions go through `ctx.executeTool("AskUserQuestion", …)` — Pi's structured-question
surface (see `extensions/shared/ask.ts`), so the same keyboard flow serves Duck, the agent, and
any other caller. Answers are returned in Duck's tool result; nothing is written to the editor
and nothing is auto-sent.

## Files

- `extensions/duck/index.ts` — the tool, the nested call, and the AskUserQuestion hand-off.
- `extensions/duck/prompt.ts` — the JSON-only prompt.
- `extensions/duck/questions.ts` — tolerant parse and clamping.
- `extensions/duck/answers.ts` — mapping into the AskUserQuestion question shape.
- `extensions/shared/ask.ts` — the shared structured-question tool.
- `extensions/shared/nested.ts` — nested stream accumulation and headers.

## Manual checks (TUI)

- Calling `duck` on a plan asks 1–4 questions through the standard AskUserQuestion UI.
- The tool result contains the questions and the human's answers.
- A model that returns prose instead of JSON still produces one answerable question.
- A model error is reported as an error result, not a thrown exception.

## Known limits

- The reviewer sees only the latest assistant text; it does not read files, the diff, or tool
  results, so its questions can be generic.
- It uses the active model unless `ctx.modelRegistry` resolves otherwise; there is no cheap-model
  routing.
- A rework of Duck's purpose and surface is an open brainstorm (see
  `taskNotes/duck-rework/brainstorm.md`).

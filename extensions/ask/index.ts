/**
 * `AskUserQuestion` — the default way an agent asks the human a question.
 *
 * A first-class, read-only, blocking tool: the model passes structured
 * questions, the human answers through the shared questionnaire (TUI), dialog
 * prompts (RPC), or the caller gets `asked:false` headless. The answers are
 * returned in the tool result (straight to the chat) and mirrored as
 * `structuredContent` so wrappers can consume them programmatically. Duck and
 * Brainstorm call this tool by name via `ctx.executeTool("AskUserQuestion", …)`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { JsonValue } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { askUserQuestions, type AskOutcome } from "../shared/ask.ts";
import type { QuestionnaireQuestion } from "../shared/questionnaire.ts";

const AskOption = Type.Object({
  label: Type.String(),
  description: Type.Optional(Type.String()),
});
const AskQuestion = Type.Object({
  id: Type.String(),
  /** Short tab label; defaults to Q1..Qn. */
  label: Type.Optional(Type.String()),
  prompt: Type.String(),
  /** 0..4 concrete options. Empty is fine when the answer is free text. */
  options: Type.Array(AskOption, { maxItems: 4 }),
  /** Include a "Type something." escape. Defaults to true. */
  allowOther: Type.Optional(Type.Boolean()),
});
const AskParams = Type.Object({
  questions: Type.Array(AskQuestion, { minItems: 1, maxItems: 4 }),
});
type AskParams = Static<typeof AskParams>;

const AskAnswer = Type.Object({
  id: Type.String(),
  value: Type.String(),
  label: Type.String(),
  wasCustom: Type.Boolean(),
  index: Type.Optional(Type.Number()),
});
const AskQuestionEcho = Type.Object({
  id: Type.String(),
  prompt: Type.String(),
  label: Type.Optional(Type.String()),
  options: Type.Array(AskOption),
  allowOther: Type.Optional(Type.Boolean()),
});
const AskOutput = Type.Object({
  asked: Type.Boolean(),
  cancelled: Type.Boolean(),
  reason: Type.Optional(Type.String()),
  answers: Type.Array(AskAnswer),
  questions: Type.Array(AskQuestionEcho),
});

function toQuestions(params: AskParams): QuestionnaireQuestion[] {
  return params.questions.map((question) => ({
    id: question.id,
    label: question.label ?? "",
    prompt: question.prompt,
    options: (question.options ?? []).map((option) =>
      option.description ? { label: option.label, description: option.description } : { label: option.label },
    ),
    allowOther: question.allowOther !== false,
  }));
}

/** Model-facing summary of the outcome; this is what lands in the chat. */
function contentFor(outcome: AskOutcome): string {
  if (outcome.reason === "no UI") {
    const list = outcome.questions.map((question) => `- ${question.prompt}`).join("\n");
    return [
      "No interactive UI is available to ask these questions:",
      list,
      "",
      "Ask them in prose and wait for the human's reply, or proceed with stated assumptions.",
    ].join("\n");
  }
  if (outcome.cancelled) {
    return "The human cancelled the questions without answering. Do not assume answers — proceed with stated assumptions or ask again.";
  }
  if (outcome.answers.length === 0) return "No answers were provided.";
  const lines = ["Answers:"];
  for (const answer of outcome.answers) {
    const question = outcome.questions.find((candidate) => candidate.id === answer.id);
    const label = question?.label ?? answer.id;
    lines.push(`- ${label}: ${answer.wasCustom ? `(wrote) ${answer.label}` : answer.label}`);
  }
  return lines.join("\n");
}

export default function ask(pi: ExtensionAPI) {
  pi.registerTool({
    name: "AskUserQuestion",
    label: "Ask User Question",
    description:
      "Ask the human one or more structured multiple-choice questions. This is the default way to get a human decision; prefer it over writing questions in prose.",
    promptSnippet: "Ask the human structured questions (default way to get a decision)",
    promptGuidelines: [
      "Prefer AskUserQuestion over writing questions in prose; batch related questions into one call (1-4 questions).",
      "Give 2-4 concrete options per question; leave allowOther true so the human can type their own answer.",
      "Treat a cancelled result as 'no answer' — proceed with stated assumptions.",
    ],
    parameters: AskParams,
    outputSchema: AskOutput,
    exposure: "direct",
    executionMode: "sequential",
    annotations: { readOnlyHint: true },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const outcome = await askUserQuestions(ctx, toQuestions(params));
      return {
        content: [{ type: "text", text: contentFor(outcome) }],
        details: outcome,
        structuredContent: outcome as unknown as JsonValue,
      };
    },
  });
}

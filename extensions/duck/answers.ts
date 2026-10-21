/**
 * answers — turn structured duck questions into the `AskUserQuestion` tool's
 * parameter shape. The answers themselves are returned by that tool, so this
 * module is only the question mapping (the old editor-block composer is gone).
 */
import type { DuckQuestion } from "./questions.ts";

export interface AskQuestionInput {
  id: string;
  label?: string;
  prompt: string;
  options: { label: string; description?: string }[];
  allowOther?: boolean;
}

/** Map `header` -> tab label and `question` -> prompt for AskUserQuestion. */
export function toAskQuestions(questions: DuckQuestion[]): AskQuestionInput[] {
  return questions.map((question) => ({
    id: question.id,
    label: question.header,
    prompt: question.question,
    options: question.options.map((option) =>
      option.description ? { label: option.label, description: option.description } : { label: option.label },
    ),
    allowOther: question.allowOther,
  }));
}

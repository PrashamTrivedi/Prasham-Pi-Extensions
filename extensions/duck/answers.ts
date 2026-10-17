/**
 * answers — turn structured duck questions plus the human's selections into the
 * markdown block that goes into the editor.
 */
import type { QuestionnaireAnswer, QuestionnaireQuestion } from "../shared/questionnaire.ts";
import type { DuckQuestion } from "./questions.ts";

/** Present duck questions through the shared questionnaire. Pure. */
export function toQuestionnaireQuestions(questions: DuckQuestion[]): QuestionnaireQuestion[] {
  return questions.map((question) => ({
    id: question.id,
    label: question.header,
    prompt: question.question,
    options: question.options,
    allowOther: question.allowOther,
  }));
}

/**
 * Compose the answers the human confirmed. Questions with no answer are skipped, so
 * a partially answered questionnaire still produces a usable block.
 */
export function composeDuckAnswers(questions: DuckQuestion[], answers: QuestionnaireAnswer[]): string {
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  const lines = ["**Duck answers**"];
  for (const question of questions) {
    const answer = byId.get(question.id);
    if (!answer) continue;
    lines.push(`- **${question.header}**: ${answer.wasCustom ? `(wrote) ${answer.label}` : answer.label}`);
  }
  return lines.join("\n");
}

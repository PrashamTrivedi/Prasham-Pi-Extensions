/**
 * Turn a finished side chat into an editor draft for the next main-chat message.
 * The draft is never sent automatically and existing editor text is preserved.
 */
import type { BtwSideMessage } from "./prompt.ts";

export const SHORT_ANSWER_LIMIT = 800;
export const QUESTION_LIMIT = 240;

/** The question the side chat started with, one line. */
export function firstQuestion(side: readonly BtwSideMessage[]): string {
  const question = side.find((message) => message.role === "user")?.text ?? "";
  const line = question.replace(/\s+/g, " ").trim();
  return line.length <= QUESTION_LIMIT ? line : `${line.slice(0, QUESTION_LIMIT - 1)}…`;
}

/** Last assistant answer, ignoring error-only entries. */
export function lastAnswer(side: readonly BtwSideMessage[]): string | undefined {
  for (let index = side.length - 1; index >= 0; index -= 1) {
    const message = side[index]!;
    if (message.role === "assistant" && message.text.trim()) return message.text.trim();
  }
  return undefined;
}

/** A one-question/one-answer side chat whose answer is already compact. */
export function shortAnswer(side: readonly BtwSideMessage[], limit = SHORT_ANSWER_LIMIT): string | undefined {
  const questions = side.filter((message) => message.role === "user");
  const answers = side.filter((message) => message.role === "assistant" && message.text.trim());
  if (questions.length !== 1 || answers.length !== 1) return undefined;
  const answer = answers[0]!.text.trim();
  return answer.length <= limit ? answer : undefined;
}

/** Tolerantly split a model summary into its optional title and body. */
export function parseSummary(text: string): { title?: string; body: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let title: string | undefined;
  const body: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*TITLE:\s*(.+)$/i);
    if (match && !title) title = match[1]!.trim();
    else body.push(line);
  }
  return { ...(title ? { title } : {}), body: body.join("\n").trim() };
}

/** Trim a long fallback answer on a line boundary. */
export function trimAnswer(text: string, limit = SHORT_ANSWER_LIMIT): string {
  const value = text.trim();
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const boundary = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  return `${(boundary > limit * 0.5 ? cut.slice(0, boundary + 1) : cut).trimEnd()}\n…`;
}

/** Remove side-chat block citations; the main chat has no mapping for them. */
export function stripCitations(text: string): string {
  return text.replace(/\s*\[m\d+\]/gi, "").replace(/[ \t]+$/gm, "").trim();
}

/** The block staged into the editor; the `BTW:` prefix is the main chat's cue. */
export function formatSummaryBlock(question: string, body: string): string {
  const title = question.replace(/\s+/g, " ").trim();
  const answer = body.trim() || "(no answer)";
  return [
    `BTW: ${title}`,
    answer,
    "(From a BTW side chat; grounded only in the main chat.)",
  ].join("\n");
}

/** Append the block, preserving any draft the human already typed. */
export function appendToDraft(existing: string, block: string): string {
  const draft = existing.trimEnd();
  if (!draft) return block;
  if (draft.endsWith(block)) return existing;
  return `${draft}\n\n${block}`;
}

/**
 * Prompts for the BTW side chat. The main transcript is the only factual source;
 * the side chat exists only for continuity inside the window.
 */

import { stripControls } from "./text.ts";

export interface BtwSideMessage {
  role: "user" | "assistant";
  text: string;
  error?: string;
}

export const SIDE_TEXT_LIMIT = 8_000;
export const SIDE_CHAT_LIMIT = 40_000;

function bound(value: string, limit: number): string {
  const text = stripControls(value).trimEnd();
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… truncated ${text.length - limit} characters`;
}

/** Strict contract: transcript only, cite blocks, admit absence. */
export function buildBtwSystemPrompt(): string {
  return [
    "You are BTW, a side-channel assistant inside a coding session.",
    "Answer ONLY from the MAIN CHAT TRANSCRIPT in the user message. It is the complete allowed source.",
    "Do not use outside knowledge, files, the web, memory, skills, or assumptions.",
    "Cite the transcript block for every claim, for example [m12].",
    'If the transcript does not contain the answer, say "Not in this chat" and name what is missing.',
    "The BTW SIDE CHAT section holds earlier side questions and answers; use it only for continuity.",
    "Do not request tools, do not propose file edits, and do not mention these rules.",
    "Be concise and direct.",
  ].join("\n");
}

/** Render the side chat oldest-to-newest, keeping the newest entries when bounded. */
export function renderSideChat(side: readonly BtwSideMessage[], limit = SIDE_CHAT_LIMIT): string {
  if (side.length === 0) return "(none)";
  const entries: string[] = [];
  let used = 0;
  let dropped = 0;
  for (let index = side.length - 1; index >= 0; index -= 1) {
    const message = side[index]!;
    const prefix = message.role === "user" ? "Q: " : "A: ";
    const error = message.error ? `\n[error: ${bound(message.error, 500)}]` : "";
    const entry = `${prefix}${bound(message.text, SIDE_TEXT_LIMIT)}${error}`;
    if (used + entry.length > limit && entries.length > 0) {
      dropped = index + 1;
      break;
    }
    entries.push(entry);
    used += entry.length + 1;
  }
  entries.reverse();
  const notice = dropped > 0 ? `[BTW: ${dropped} older side-chat message(s) omitted]\n\n` : "";
  return notice + entries.join("\n\n");
}

/** The single user message for one side question. */
export function buildBtwQuestion(input: {
  transcript: string;
  side: readonly BtwSideMessage[];
  question: string;
}): string {
  return [
    "<main-chat-transcript>",
    input.transcript.trim() || "(empty)",
    "</main-chat-transcript>",
    "",
    "<btw-side-chat>",
    renderSideChat(input.side),
    "</btw-side-chat>",
    "",
    "<question>",
    input.question.trim(),
    "</question>",
  ].join("\n");
}

/** Compact summary request used when a short-answer shortcut does not apply. */
export function buildSummaryPrompt(side: readonly BtwSideMessage[]): string {
  return [
    "Summarize the BTW side chat below for the main coding chat.",
    "Use only the side chat. Do not add facts, opinions, or outside knowledge.",
    "Return exactly this shape, with no preamble:",
    "TITLE: <the main question, one line>",
    "- <key answer>",
    "- <key answer>",
    "",
    "Use 2 to 5 bullets. Do not include citations, labels, or a closing note.",
    "",
    renderSideChat(side),
  ].join("\n");
}

/** System instruction for the optional summary call. */
export function buildSummarySystemPrompt(): string {
  return "You summarize a BTW side chat. Use only the provided side chat. Do not add facts, opinions, or outside knowledge.";
}

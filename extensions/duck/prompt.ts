/**
 * Build the questions-only reviewer prompt for `/duck`. Pure.
 *
 * The answer must be a JSON array and nothing else: the model is asked for one
 * representation, not prose plus JSON, because asking for both produces fenced or
 * truncated output. `parseDuckQuestions` still tolerates a fence or surrounding
 * prose, and the panel falls back to the raw text when nothing parses.
 */
export function buildDuckPrompt(plan: string, question: string): string {
  const focus = question.trim().length > 0 ? question.trim() : "the work below";
  return [
    "You are a critical reviewer.",
    "Ask clarifying questions about the work below. Do not answer them, do not give advice, do not propose edits.",
    "",
    "Return ONLY a JSON array — no prose, no markdown fences. Each element has this shape:",
    '{"header":"<=12 chars","question":"the full question","options":[{"label":"...","description":"..."}],"allowOther":true}',
    "",
    "Rules:",
    "- 1 to 4 questions, most important first, so the earliest ones unblock the most.",
    "- 2 to 4 options per question. Options are concrete choices, not restatements of the question.",
    "- header is a short tab label, at most 12 characters.",
    "- Set allowOther to false only when the answer must be typed and no option fits.",
    "",
    `Focus: ${focus}`,
    "",
    "WORK:",
    plan,
  ].join("\n");
}

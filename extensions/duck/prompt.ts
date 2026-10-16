/** Build the questions-only reviewer prompt for `/duck`. Pure. */
export function buildDuckPrompt(plan: string, question: string): string {
  const focus = question.trim().length > 0 ? question.trim() : "the plan below";
  return [
    "You are a critical reviewer.",
    "Return QUESTIONS ONLY. Do not answer them, do not give advice, do not propose edits.",
    "Ask the sharpest questions that expose weaknesses, missing cases, and unstated assumptions.",
    "",
    `Focus: ${focus}`,
    "",
    "PLAN:",
    plan,
  ].join("\n");
}

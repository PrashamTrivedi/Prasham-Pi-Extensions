/**
 * `/duck` — a questions-only second opinion, now a first-class tool.
 *
 * Duck generates structured questions with an in-process nested model call
 * (`ctx.modelRegistry.streamSimple`), then presents them through the shared
 * `AskUserQuestion` tool by name (`ctx.executeTool`). The answers come back in
 * Duck's own tool result, straight to the chat. No docked panel, no editor
 * write, no subprocess.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { toAskQuestions } from "./answers.ts";
import { buildDuckPrompt } from "./prompt.ts";
import { parseDuckQuestions, type DuckQuestion } from "./questions.ts";
import type { AskOutcome } from "../shared/ask.ts";
import { accumulateNested, nestedHeaders, textOfMessage, type NestedEvent, type NestedResult } from "../shared/nested.ts";

export { nestedHeaders };
export type DuckEvent = NestedEvent;
export type DuckResult = NestedResult;
export const accumulateDuck = accumulateNested;

/** Latest assistant text from the active branch, used as the plan. */
export function latestAssistantText(ctx: ExtensionContext): string {
  const entries = ctx.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as unknown;
    if (typeof entry !== "object" || entry === null) continue;
    const message = (entry as { message?: unknown }).message;
    if (typeof message !== "object" || message === null) continue;
    if ((message as { role?: unknown }).role !== "assistant") continue;
    const text = textOfMessage(message);
    if (text.length > 0) return text;
  }
  return "";
}

/** Fallback when the model ignores the JSON contract: one open-ended question. */
function openEndedQuestion(text: string): DuckQuestion {
  return { id: "q1", header: "Duck", question: text.trim(), options: [], allowOther: true };
}

const DuckParams = Type.Object({
  focus: Type.Optional(Type.String({ description: "What the review should focus on; defaults to the latest plan." })),
});
type DuckParams = Static<typeof DuckParams>;

export default function duck(pi: ExtensionAPI) {
  pi.registerTool({
    name: "duck",
    label: "Duck: Second Opinion",
    description:
      "Ask the human clarifying/debugging questions about the current plan. Duck generates the questions as a questions-only second opinion on the latest assistant plan, then presents them through the AskUserQuestion tool.",
    promptSnippet: "Ask the human debugging questions about the current plan (questions-only second opinion)",
    promptGuidelines: [
      "Use duck when a second set of eyes on the current plan would surface the highest-value clarifying questions.",
      "The human's answers come back in the tool result; incorporate them into the plan.",
    ],
    parameters: DuckParams,
    exposure: "direct",
    executionMode: "sequential",
    annotations: { readOnlyHint: true },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const model = ctx.model;
      if (!model) {
        return { content: [{ type: "text", text: "duck: no active model" }], details: { error: "no active model" } };
      }
      const focus = params.focus?.trim() ?? "";
      const plan = latestAssistantText(ctx) || "(no plan in this session yet)";
      const sessionId = ctx.sessionManager.getSessionId();
      const headers = nestedHeaders(model, sessionId);
      try {
        const stream = ctx.modelRegistry.streamSimple(
          model,
          { messages: [{ role: "user", content: buildDuckPrompt(plan, focus), timestamp: Date.now() }] },
          headers ? { sessionId, headers } : { sessionId },
        );
        const result = await accumulateDuck(stream);
        if (result.error) {
          return {
            content: [{ type: "text", text: `duck failed: ${result.error}` }],
            details: { error: result.error, usage: result.usage },
            isError: true,
          };
        }
        const parsed = parseDuckQuestions(result.text);
        const questions =
          parsed.questions.length > 0 ? parsed.questions : result.text.trim() ? [openEndedQuestion(result.text)] : [];
        if (questions.length === 0) {
          return {
            content: [{ type: "text", text: "duck: the model returned no questions." }],
            details: { questions: [], usage: result.usage },
          };
        }
        const outcome = await ctx.executeTool("AskUserQuestion", { questions: toAskQuestions(questions) });
        const asked = outcome.result.details as AskOutcome | undefined;
        return {
          content: outcome.result.content,
          details: { questions, answers: asked?.answers ?? [], usage: result.usage },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `duck failed: ${message}` }],
          details: { error: message },
          isError: true,
        };
      }
    },
  });
}

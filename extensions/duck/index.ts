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

function textOfMessage(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text") {
      parts.push(String((part as { text?: unknown }).text ?? ""));
    }
  }
  return parts.join("\n").trim();
}

function usageOf(message: unknown): { input?: number; output?: number } | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const usage = (message as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const record = usage as Record<string, unknown>;
  return {
    input: typeof record.input === "number" ? record.input : undefined,
    output: typeof record.output === "number" ? record.output : undefined,
  };
}

function errorOf(message: unknown): string {
  if (typeof message === "object" && message !== null) {
    const errorMessage = (message as { errorMessage?: unknown }).errorMessage;
    if (typeof errorMessage === "string" && errorMessage.length > 0) return errorMessage;
  }
  return "model error";
}

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

export interface DuckResult {
  text: string;
  usage?: { input?: number; output?: number };
  error?: string;
}

/** Structural subset of `AssistantMessageEvent`; keeps accumulation testable. */
export type DuckEvent = {
  type: string;
  delta?: string;
  partial?: unknown;
  message?: unknown;
  error?: unknown;
};

/** Drive a nested stream to completion, accumulating text and usage. */
export async function accumulateDuck(
  stream: AsyncIterable<DuckEvent>,
  onDelta?: (text: string) => void,
): Promise<DuckResult> {
  let text = "";
  let final: unknown;
  let error: string | undefined;
  for await (const event of stream) {
    if (event.type === "text_delta" && typeof event.delta === "string") {
      text += event.delta;
      onDelta?.(text);
    } else if (event.type === "done") {
      final = event.message;
    } else if (event.type === "error") {
      final = event.error;
      error = errorOf(event.error);
    }
  }
  return { text: text.trim() || textOfMessage(final), usage: usageOf(final), error };
}

/** opencode routes requests by session; nested calls must send its attribution header. */
export function nestedHeaders(
  model: { provider: string; baseUrl: string },
  sessionId: string,
): Record<string, string> | undefined {
  const isOpencode =
    model.provider === "opencode" || model.provider === "opencode-go" || model.baseUrl.includes("opencode.ai");
  if (!isOpencode) return undefined;
  return { "x-opencode-session": sessionId, "x-opencode-client": "pi" };
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

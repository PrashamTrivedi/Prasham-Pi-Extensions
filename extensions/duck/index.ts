/**
 * `/duck` — a questions-only second opinion on the current plan, via an
 * in-process nested call (`ctx.modelRegistry.streamSimple`). No subprocess.
 * Nested-call token usage is shown in the widget header.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildDuckPrompt } from "./prompt.ts";

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
export async function accumulateDuck(stream: AsyncIterable<DuckEvent>): Promise<DuckResult> {
  let text = "";
  let final: unknown;
  let error: string | undefined;
  for await (const event of stream) {
    if (event.type === "text_delta" && typeof event.delta === "string") {
      text += event.delta;
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

export default function duck(pi: ExtensionAPI) {
  pi.registerCommand("duck", {
    description: "Ask a questions-only second opinion about the current plan",
    handler: async (args, ctx) => {
      const model = ctx.model;
      if (!model) {
        ctx.ui.notify("duck: no active model", "error");
        return;
      }
      if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;

      const plan = latestAssistantText(ctx) || "(no plan in this session yet)";
      try {
        const sessionId = ctx.sessionManager.getSessionId();
        const headers = nestedHeaders(model, sessionId);
        const stream = ctx.modelRegistry.streamSimple(
          model,
          { messages: [{ role: "user", content: buildDuckPrompt(plan, args), timestamp: Date.now() }] },
          headers ? { sessionId, headers } : { sessionId },
        );
        const result = await accumulateDuck(stream);
        const usage = result.usage;
        const header = `duck · ${model.provider}/${model.id} · in ${usage?.input ?? 0} / out ${usage?.output ?? 0}`;
        const body = result.error
          ? `duck failed: ${result.error}`
          : result.text || "(the model returned no questions)";
        ctx.ui.setWidget("duck", [header, "", ...body.split("\n")], { placement: "aboveEditor" });
        ctx.ui.notify(result.error ? `duck: ${result.error}` : header, result.error ? "error" : "info");
      } catch (error) {
        ctx.ui.notify(`duck: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.mode === "tui" || ctx.mode === "rpc") ctx.ui.setWidget("duck", undefined);
  });
}

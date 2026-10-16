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
        const stream = ctx.modelRegistry.streamSimple(model, {
          messages: [{ role: "user", content: buildDuckPrompt(plan, args), timestamp: Date.now() }],
        });
        const message = await stream.result();
        const text = textOfMessage(message) || "(the model returned no questions)";
        const usage = (message as { usage?: { input?: number; output?: number } }).usage;
        const header = `duck · ${model.provider}/${model.id} · in ${usage?.input ?? 0} / out ${usage?.output ?? 0}`;
        ctx.ui.setWidget("duck", [header, "", ...text.split("\n")], { placement: "aboveEditor" });
        ctx.ui.notify(header, "info");
      } catch (error) {
        ctx.ui.notify(`duck: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.mode === "tui" || ctx.mode === "rpc") ctx.ui.setWidget("duck", undefined);
  });
}

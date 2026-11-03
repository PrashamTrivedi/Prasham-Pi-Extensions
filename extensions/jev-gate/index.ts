/**
 * `jev-gate` — run the jev-harness decision framework for Pi.
 *
 * Mirrors how jev-harness is wired into Claude Code / Cursor / Antigravity: on every
 * relevant Pi event it normalizes to the neutral HookEvent, invokes the Bun adapter
 * (`~/.claude/skills/jev-harness/adapters/pi/run.ts`) as a subprocess with the event on
 * stdin, and applies the merged verdict (block / confirm / rewrite / replace output /
 * notify / continue). The adapter logs to the same `jev.db` ledger as the other agents.
 *
 * `sandbox-dev` owns the `tool_call` decision: it asks the decision server about every tool
 * call and turns a non-approval into one human prompt. This extension therefore handles
 * results and the stop event only — one gate, one owner, one server call per tool call.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runJevDecision } from "../shared/jev.ts";
import { flattenContent, mapToolCall } from "../shared/tool-call.ts";

// Re-exported for the mapping tests and for any extension that wants the neutral shape.
export { flattenContent, mapToolCall } from "../shared/tool-call.ts";
export type { JevToolCall, ToolKind } from "../shared/tool-call.ts";

function sessionId(ctx: ExtensionContext): string {
  try { return ctx.sessionManager.getSessionId(); } catch { return "unknown"; }
}

function lastAssistant(ctx: ExtensionContext): string {
  const entries = ctx.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as { message?: { role?: string; content?: Array<{ type?: string; text?: string }> } };
    if (entry?.message?.role !== "assistant") continue;
    const text = (entry.message.content ?? [])
      .filter((part) => part?.type === "text")
      .map((part) => part.text ?? "")
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

export default function jevGate(pi: ExtensionAPI) {
  pi.on("tool_result", async (event, ctx) => {
    const tool = mapToolCall(event.toolName, event.input as unknown as Record<string, unknown>);
    tool.output = flattenContent(event.content as Array<{ type?: string; text?: string }>);
    const verdicts = (await runJevDecision(event.isError ? "tool_failure" : "post_tool", {
      sessionId: sessionId(ctx),
      cwd: ctx.cwd,
      transcriptPath: process.env.PI_SESSION_FILE,
      tool,
    })) ?? {};
    for (const note of verdicts.notify ?? []) ctx.ui.notify(note, "info");
    if (verdicts.replace) return { content: [{ type: "text", text: verdicts.replace.output }] };
    const context = verdicts.context ?? [];
    if (context.length) {
      return { content: [...event.content, { type: "text", text: `\n\n${context.join("\n")}` }] };
    }
    return undefined;
  });

  pi.on("agent_before_settle", async (event, ctx) => {
    if (event.outcome !== "completed") return;
    const verdicts = (await runJevDecision("stop", {
      sessionId: sessionId(ctx),
      cwd: ctx.cwd,
      transcriptPath: process.env.PI_SESSION_FILE,
      lastAssistantText: lastAssistant(ctx),
    })) ?? {};
    const entries: Array<{ type: "custom_message"; customType: string; content: string; display: true }> = [];
    for (const note of verdicts.notify ?? []) entries.push({ type: "custom_message", customType: "jev", content: note, display: true });
    if (verdicts.cont) {
      entries.push({ type: "custom_message", customType: "jev", content: verdicts.cont.reason, display: true });
      return { continue: true, entries };
    }
    if (entries.length) return { entries };
    return undefined;
  });
}

/**
 * Session ledger writer + `/report`. Records tool timings and assistant usage to
 * the local JSONL via `shared/session.ts` (never model-visible).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  readSessionEntries,
  recordSessionEntry,
  sessionLedgerPath,
  summarizeSession,
} from "../shared/session.ts";
import type { WorkbenchConfig } from "./config.ts";

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function registerReport(pi: ExtensionAPI, getConfig: () => WorkbenchConfig): void {
  const enabled = (): boolean => getConfig().observability.enabled;

  pi.on("tool_execution_end", async (event) => {
    if (!enabled()) return;
    recordSessionEntry({
      ts: Date.now(),
      kind: "tool",
      tool: event.toolName,
      latencyMs: event.durationMs,
    });
  });

  pi.on("message_end", async (event) => {
    if (!enabled()) return;
    const message: unknown = event.message;
    if (typeof message !== "object" || message === null) return;
    const record = message as Record<string, unknown>;
    if (record.role !== "assistant") return;
    const usage = typeof record.usage === "object" && record.usage !== null
      ? (record.usage as Record<string, unknown>)
      : undefined;
    recordSessionEntry({
      ts: Date.now(),
      kind: "message",
      input: num(usage?.input),
      output: num(usage?.output),
      model: typeof record.model === "string" ? record.model : undefined,
    });
  });

  pi.registerCommand("report", {
    description: "Summarize the locally recorded session ledger",
    handler: async (_args, ctx) => {
      const summary = summarizeSession(readSessionEntries(10_000));
      if (summary.entries === 0) {
        ctx.ui.notify(`report: no session records yet (${sessionLedgerPath()})`, "info");
        return;
      }
      const top = Object.entries(summary.tools)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tool, count]) => `${tool}×${count}`)
        .join(", ");
      ctx.ui.notify(
        `report: ${summary.calls} tool calls · ${summary.tokens} tokens${top ? ` · ${top}` : ""}`,
        "info",
      );
    },
  });
}

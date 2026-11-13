/**
 * decorate — verdict toasts. When a tool call is blocked by sandbox-dev or a jev gate, show one short
 * pet-voiced notify. One toast per tool call id, even when both `tool_result` and
 * `tool_execution_end` report it.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { flattenContent } from "../shared/tool-call.ts";
import type { WorkbenchConfig } from "./config.ts";
import { denialReason, verdictToast } from "./decorate-logic.ts";

export function registerDecorate(pi: ExtensionAPI, getConfig: () => WorkbenchConfig): void {
  const seen = new Set<string>();

  const toast = (id: string, isError: boolean, text: string, notify: (m: string, l: "warning") => void): void => {
    if (!getConfig().decorate.enabled || seen.has(id)) return;
    const reason = denialReason(isError, text);
    if (reason === null) return;
    seen.add(id);
    if (seen.size > 500) seen.delete(seen.values().next().value as string);
    notify(verdictToast(reason), "warning");
  };

  pi.on("tool_result", async (event, ctx) => {
    if (ctx.mode !== "tui" && ctx.mode !== "rpc") return undefined;
    toast(
      event.toolCallId,
      event.isError === true,
      flattenContent(event.content as Array<{ type?: string; text?: string }>),
      (m, l) => ctx.ui.notify(m, l),
    );
    return undefined;
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
    const content = (event.result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
    toast(event.toolCallId, event.isError, Array.isArray(content) ? flattenContent(content) : "", (m, l) =>
      ctx.ui.notify(m, l),
    );
  });
}

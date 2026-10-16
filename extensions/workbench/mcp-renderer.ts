/**
 * `registerToolRenderer` for MCP tools: renders `mcp__*` text results legibly and
 * falls through to `next()` for everything else. Display only.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { WorkbenchConfig } from "./config.ts";

export function isMcpTool(name: string): boolean {
  return name.startsWith("mcp__");
}

function textOf(result: unknown): string {
  if (typeof result !== "object" || result === null) return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }
  return content
    .map((part) => (typeof part === "object" && part !== null && "text" in part ? String((part as { text?: unknown }).text ?? "") : ""))
    .join("\n");
}

/** Collapsed shows the first 8 lines; expanded shows everything. */
export function mcpResultLines(result: unknown, expanded: boolean): string[] {
  const lines = textOf(result).split("\n");
  return expanded ? lines : lines.slice(0, 8);
}

export function registerMcpRenderer(pi: ExtensionAPI, getConfig: () => WorkbenchConfig): void {
  pi.registerToolRenderer((name, next) => {
    if (!getConfig().observability.enabled || !isMcpTool(name)) return next();
    const base = next() ?? {};
    return {
      ...base,
      renderResult: (result, options) => ({
        render: (width: number): string[] =>
          mcpResultLines(result, options.expanded).map((line) => truncateToWidth(line, width)),
        invalidate: () => {},
      }),
    };
  });
}

/**
 * Per-agent usage folded from the child's saved session.
 *
 * A Fabric worker writes a real Pi session; every assistant message carries
 * `usage.totalTokens` and `usage.cost.total`, and its tool calls name the last
 * tool used. The rows, transcript header and result cards show that instead of
 * "agent-reported", and folding is incremental: one byte cursor per agent means
 * the 750 ms refresh reads only what the child appended since the last tick.
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";

export interface SessionUsage {
  /** Sum of `usage.cost.total` over assistant messages. */
  cost: number;
  /** Sum of `usage.totalTokens` over assistant messages. */
  tokens: number;
  /** Name of the most recent tool call. */
  lastTool?: string;
  /** Assistant messages that carried usage. */
  turns: number;
}

export const EMPTY_USAGE: SessionUsage = { cost: 0, tokens: 0, turns: 0 };

/** One session line's contribution, or undefined when it carries no usage or tool call. */
export function parseUsageLine(line: string): { cost: number; tokens: number; tool?: string } | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  let entry: unknown;
  try { entry = JSON.parse(trimmed); } catch { return undefined; }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  const record = entry as { type?: unknown; message?: { role?: unknown; content?: unknown; usage?: unknown } };
  if (record.type !== "message" || !record.message || record.message.role !== "assistant") return undefined;
  const usage = record.message.usage as { totalTokens?: unknown; cost?: { total?: unknown } } | undefined;
  const tokens = typeof usage?.totalTokens === "number" && Number.isFinite(usage.totalTokens) ? usage.totalTokens : 0;
  const cost = typeof usage?.cost?.total === "number" && Number.isFinite(usage.cost.total) ? usage.cost.total : 0;
  const content = Array.isArray(record.message.content) ? record.message.content : [];
  let tool: string | undefined;
  for (const part of content) {
    const block = part as { type?: unknown; name?: unknown };
    if (block?.type === "toolCall" && typeof block.name === "string" && block.name) tool = block.name;
  }
  if (!tokens && !cost && !tool) return undefined;
  return { cost, tokens, ...(tool ? { tool } : {}) };
}

/** Folds whole lines into a running total; a partial trailing line is the caller's job to hold back. */
export function foldUsage(text: string, previous: SessionUsage = EMPTY_USAGE): SessionUsage {
  const usage: SessionUsage = { ...previous };
  for (const line of text.split("\n")) {
    const parsed = parseUsageLine(line);
    if (!parsed) continue;
    if (parsed.cost) usage.cost += parsed.cost;
    if (parsed.tokens) usage.tokens += parsed.tokens;
    if (parsed.tokens || parsed.cost) usage.turns += 1;
    if (parsed.tool) usage.lastTool = parsed.tool;
  }
  return usage;
}

/** Reads session bytes from `cursor` and returns only whole lines, like Fabric's live tailing. */
function readFrom(source: string, cursor: number): { text: string; next: number } {
  let size: number;
  try { size = statSync(source).size; } catch { return { text: "", next: cursor }; }
  if (size <= cursor) return { text: "", next: cursor };
  const buffer = Buffer.alloc(size - cursor);
  const descriptor = openSync(source, "r");
  let read = 0;
  try { read = readSync(descriptor, buffer, 0, buffer.length, cursor); } finally { closeSync(descriptor); }
  const text = buffer.subarray(0, read).toString("utf8");
  const cut = text.lastIndexOf("\n");
  if (cut < 0) return { text: "", next: cursor };
  const whole = text.slice(0, cut + 1);
  return { text: whole, next: cursor + Buffer.byteLength(whole, "utf8") };
}

/** Usage for the bytes appended since `cursor`; the cursor never moves past a partial line. */
export function sessionUsage(
  path: string,
  cursor = 0,
  previous: SessionUsage = EMPTY_USAGE,
): { usage: SessionUsage; cursor: number } {
  const chunk = readFrom(path, cursor);
  if (!chunk.text) return { usage: previous, cursor };
  return { usage: foldUsage(chunk.text, previous), cursor: chunk.next };
}

/** `{ cost: "$0.04", tokens: "128k", tool: "read" }` for the comparison cards. */
export function usageMetrics(usage: SessionUsage | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!usage) return out;
  if (usage.cost > 0) out.cost = usage.cost < 0.01 ? `$${usage.cost.toFixed(4)}` : `$${usage.cost.toFixed(2)}`;
  if (usage.tokens > 0) out.tokens = usage.tokens >= 1_000 ? `${Math.round(usage.tokens / 1_000)}k` : String(Math.round(usage.tokens));
  if (usage.lastTool) out.tool = usage.lastTool;
  return out;
}

/** `$0.04 · 128k · read`; empty when the child has reported nothing yet. */
export function formatUsage(usage: SessionUsage | undefined): string {
  return Object.values(usageMetrics(usage)).join(" · ");
}

import { stripControls } from "./text.ts";

/**
 * Serialize the active chat into a bounded, citable transcript for BTW.
 *
 * Only the session's active branch is used, and only the parts a human would call
 * "the chat": user/assistant text, tool calls, and tool results. System prompts and
 * hidden thinking blocks are deliberately excluded. Nothing is read from files,
 * memory, skills, the web, or a subagent.
 */

/** One citable block of the transcript. */
export interface BtwBlock {
  /** Session-order label such as `m12`; the model cites this in answers. */
  id: string;
  title: string;
  text: string;
  isError?: boolean;
}

export interface BtwTranscript {
  /** Ready-to-send transcript with labels and optional truncation notice. */
  text: string;
  /** Number of blocks kept. */
  kept: number;
  /** Number of blocks before truncation. */
  total: number;
  /** Number of oldest blocks omitted. */
  dropped: number;
  truncated: boolean;
}

/** Per-block caps keep one huge tool result from crowding out the conversation. */
export const TEXT_LIMIT = 8_000;
export const TOOL_RESULT_LIMIT = 2_000;
export const TOOL_ARGS_LIMIT = 400;
/** Hard ceiling on transcript characters, regardless of the model window. */
export const MAX_TRANSCRIPT_CHARS = 600_000;

function bound(value: string, limit: number): string {
  const text = stripControls(value).trimEnd();
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… truncated ${text.length - limit} characters`;
}

function argText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {}) ?? "";
  } catch {
    return "";
  }
}

function contentParts(content: unknown): unknown[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}

function textOf(parts: readonly unknown[]): string {
  return parts
    .map((part) => {
      const block = part as { type?: string; text?: string; mimeType?: string };
      if (block?.type === "text") return block.text ?? "";
      if (block?.type === "image") return `[image ${block.mimeType ?? "attached"}]`;
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

/**
 * Convert session messages into ordered blocks. Unknown roles and malformed
 * messages are skipped so a resumed or compacted session still serializes.
 */
export function transcriptFromMessages(messages: readonly unknown[]): BtwBlock[] {
  const blocks: BtwBlock[] = [];
  const push = (title: string, text: string, isError?: boolean): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    blocks.push({ id: `m${blocks.length + 1}`, title, text: trimmed, ...(isError === undefined ? {} : { isError }) });
  };

  for (const raw of messages) {
    if (typeof raw !== "object" || raw === null) continue;
    const message = raw as { role?: unknown; content?: unknown; toolName?: unknown; isError?: unknown };
    const role = message.role;
    const parts = contentParts(message.content);

    if (role === "user") {
      const text = textOf(parts);
      if (text) push("User", bound(text, TEXT_LIMIT));
      continue;
    }
    if (role === "assistant") {
      const text = parts
        .filter((part) => (part as { type?: string }).type === "text")
        .map((part) => String((part as { text?: string }).text ?? ""))
        .join("\n");
      if (text.trim()) push("Assistant", bound(text, TEXT_LIMIT));
      for (const part of parts) {
        const block = part as { type?: string; name?: string; arguments?: unknown };
        if (block.type !== "toolCall") continue;
        const args = bound(argText(block.arguments).replace(/\s+/g, " "), TOOL_ARGS_LIMIT);
        push(`Tool call: ${block.name ?? "tool"}`, args);
      }
      continue;
    }
    if (role === "toolResult") {
      const text = textOf(parts) || "(no output)";
      push(`Tool result: ${String(message.toolName ?? "tool")}${message.isError === true ? " (error)" : ""}`,
        bound(text, TOOL_RESULT_LIMIT), message.isError === true);
      continue;
    }
    // System prompts and custom host messages are not part of "the chat".
  }
  return blocks;
}

function formatBlock(block: BtwBlock): string {
  return `[${block.id}] ${block.title}\n${block.text}`;
}

/**
 * Keep the newest blocks that fit. Once an older block does not fit, every older
 * block is dropped too, so the model always sees a contiguous recent window
 * rather than a gappy transcript.
 */
export function renderTranscript(blocks: readonly BtwBlock[], budgetChars: number): BtwTranscript {
  const total = blocks.length;
  if (total === 0) return { text: "", kept: 0, total: 0, dropped: 0, truncated: false };
  const budget = Math.max(20, Math.floor(budgetChars));
  const kept: string[] = [];
  let used = 0;
  let dropped = 0;
  let cut = false;

  for (let index = total - 1; index >= 0; index -= 1) {
    const formatted = formatBlock(blocks[index]!);
    const cost = formatted.length + (kept.length > 0 ? 2 : 0);
    if (used + cost <= budget) {
      kept.push(formatted);
      used += cost;
      continue;
    }
    // The newest block itself may be larger than the whole budget: keep its tail.
    if (kept.length === 0) {
      const tail = formatted.slice(Math.max(0, formatted.length - budget));
      kept.push(`[truncated]\n${tail}`);
      cut = true;
      dropped = index;
      break;
    }
    dropped = index + 1;
    break;
  }

  kept.reverse();
  const truncated = dropped > 0 || cut;
  const notice = truncated
    ? `[BTW: transcript truncated; showing the most recent ${kept.length} of ${total} blocks]\n\n`
    : "";
  return { text: notice + kept.join("\n\n"), kept: kept.length, total, dropped, truncated };
}

/**
 * Character budget for a nested call. Token windows are converted at roughly
 * 3.5 characters per token, minus space for the answer and the prompt scaffold,
 * and capped so a free model is not sent a multi-megabyte prompt.
 */
export function transcriptBudget(model: { contextWindow?: number; maxTokens?: number }, overheadChars = 4_000): number {
  const context = Number.isFinite(model.contextWindow) && model.contextWindow! > 0 ? model.contextWindow! : 64_000;
  const output = Math.min(Number.isFinite(model.maxTokens) && model.maxTokens! > 0 ? model.maxTokens! : 4_096, 8_192);
  const tokenBudget = Math.max(2_000, context - output - 1_500);
  return Math.min(MAX_TRANSCRIPT_CHARS, Math.max(2_000, Math.floor(tokenBudget * 3.5) - overheadChars));
}

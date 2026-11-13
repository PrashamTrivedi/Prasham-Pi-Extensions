/**
 * A Claude-shaped mirror of a Pi session, for the jev-harness adapter.
 *
 * jev-harness reads transcripts the way Claude Code writes them: assistant usage
 * lives in `message.usage.input_tokens` / `cache_read_input_tokens`, and prompts
 * come from `message.content`. Pi writes `message.usage.input` / `cacheRead`, and
 * `PI_SESSION_FILE` is only exported into bash subprocesses, not into extensions.
 *
 * `mirrorTranscript` keeps `<tmpdir>/pi-jev/<session-id>.jsonl` up to date with
 * only conversation turns, converted to the Claude shape, appending just the bytes
 * written since the last call. Pass its path as `transcriptPath` so decisions that
 * need context size, the last reply, or earlier prompts work on Pi too.
 */
import { appendFileSync, closeSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Where a session's mirror lives. */
export function mirrorPath(sessionId: string, root = tmpdir()): string {
  const safe = sessionId.replace(/[^\w.-]+/g, "_").slice(0, 120) || "session";
  return join(root, "pi-jev", `${safe}.jsonl`);
}

const token = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** One Pi session entry as a Claude-shaped turn, or undefined when it holds no conversation. */
export function piEntryToClaude(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  const record = entry as { type?: unknown; message?: { role?: unknown; content?: unknown; usage?: unknown } };
  if (record.type !== "message" || !record.message) return undefined;
  const { role, content, usage } = record.message;
  if (role !== "user" && role !== "assistant") return undefined;
  const parts = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  const text = parts
    .filter((part): part is { type?: string; text?: string } => Boolean(part) && typeof part === "object")
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
  const usageRecord = usage && typeof usage === "object" && !Array.isArray(usage) ? (usage as Record<string, unknown>) : undefined;
  if (!text && !usageRecord) return undefined;
  const message: Record<string, unknown> = { role, content: text };
  // Pi's usage keys are `input`/`output`/`cacheRead`/`cacheWrite`.
  if (role === "assistant" && usageRecord) {
    message.usage = {
      input_tokens: token(usageRecord.input),
      output_tokens: token(usageRecord.output),
      cache_read_input_tokens: token(usageRecord.cacheRead),
      cache_creation_input_tokens: token(usageRecord.cacheWrite),
    };
  }
  return `${JSON.stringify({ type: "message", message })}\n`;
}

function convertLines(text: string): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: unknown;
    try { entry = JSON.parse(line); } catch { continue; }
    const converted = piEntryToClaude(entry);
    if (converted) out.push(converted);
  }
  return out.join("");
}

/** Reads source bytes from `offset`, returning the text up to the last newline. */
function readFrom(source: string, offset: number): { text: string; next: number } {
  let size: number;
  try { size = statSync(source).size; } catch { return { text: "", next: offset }; }
  if (size <= offset) return { text: "", next: offset };
  const buffer = Buffer.alloc(size - offset);
  const descriptor = openSync(source, "r");
  let read = 0;
  try { read = readSync(descriptor, buffer, 0, buffer.length, offset); } finally { closeSync(descriptor); }
  const text = buffer.subarray(0, read).toString("utf8");
  const cut = text.lastIndexOf("\n");
  if (cut < 0) return { text: "", next: offset };
  const whole = text.slice(0, cut + 1);
  return { text: whole, next: offset + Buffer.byteLength(whole, "utf8") };
}

export interface TranscriptMirror {
  sessionId: string;
  /** Mirror file to pass to jev-harness. */
  path: string;
  /** Session file it mirrors, when there is one. */
  source?: string;
  /** Byte offset in `source` already converted. */
  cursor: number;
  /** Conversation turns written so far. */
  lines: number;
}

export interface MirrorInput {
  source?: string;
  /** Fallback conversation for an ephemeral session with no file. */
  entries?: readonly unknown[];
  previous?: TranscriptMirror;
  root?: string;
}

/**
 * Brings the mirror up to date and returns its state. No source file means the
 * mirror is rebuilt from `entries`; a source that appeared or changed starts over.
 */
export function mirrorTranscript(sessionId: string, input: MirrorInput): TranscriptMirror | undefined {
  const path = mirrorPath(sessionId, input.root);
  const previous = input.previous;
  const continues = previous?.sessionId === sessionId && previous.path === path && previous.source === input.source;

  if (!input.source) {
    if (!input.entries?.length) return previous;
    const text = input.entries.map(piEntryToClaude).filter((line): line is string => Boolean(line)).join("");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    return { sessionId, path, cursor: 0, lines: text.split("\n").length - 1 };
  }

  if (!continues) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "");
  }
  const cursor = continues ? previous!.cursor : 0;
  const chunk = readFrom(input.source, cursor);
  if (!chunk.text) {
    return continues ? previous : { sessionId, path, source: input.source, cursor, lines: 0 };
  }
  const text = convertLines(chunk.text);
  if (text) appendFileSync(path, text);
  const lines = (continues ? previous!.lines : 0) + (text ? text.split("\n").length - 1 : 0);
  return { sessionId, path, source: input.source, cursor: chunk.next, lines };
}

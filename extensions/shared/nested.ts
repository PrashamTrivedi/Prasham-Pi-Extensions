/**
 * Nested model-call helpers shared by Duck and the BTW side chat.
 *
 * A nested call goes straight to the provider through
 * `ctx.modelRegistry.streamSimple()`: it never becomes a session turn, never
 * emits transcript entries, and never runs tools. These helpers only accumulate
 * the stream, read usage/error metadata, and add the attribution headers
 * opencode uses to route and account for requests.
 */

export interface NestedUsage {
  input?: number;
  output?: number;
}

/** Structural subset of `AssistantMessageEvent`; keeps accumulation testable. */
export type NestedEvent = {
  type: string;
  delta?: string;
  partial?: unknown;
  message?: unknown;
  error?: unknown;
};

export interface NestedResult {
  text: string;
  usage?: NestedUsage;
  error?: string;
}

/** Text parts of a message, joined with newlines. */
export function textOfMessage(message: unknown): string {
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

/** Usage fields from a final assistant message. */
export function usageOf(message: unknown): NestedUsage | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const usage = (message as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const record = usage as Record<string, unknown>;
  return {
    input: typeof record.input === "number" ? record.input : undefined,
    output: typeof record.output === "number" ? record.output : undefined,
  };
}

/** Best error string from an error event or final message. */
export function errorOf(message: unknown): string {
  if (typeof message === "object" && message !== null) {
    const errorMessage = (message as { errorMessage?: unknown }).errorMessage;
    if (typeof errorMessage === "string" && errorMessage.length > 0) return errorMessage;
  }
  return "model error";
}

/** Drive a nested stream to completion, accumulating text and usage. */
export async function accumulateNested(
  stream: AsyncIterable<NestedEvent>,
  onDelta?: (text: string) => void,
): Promise<NestedResult> {
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
    model.provider === "opencode" ||
    model.provider === "opencode-go" ||
    model.baseUrl.includes("opencode.ai");
  if (!isOpencode) return undefined;
  return { "x-opencode-session": sessionId, "x-opencode-client": "pi" };
}

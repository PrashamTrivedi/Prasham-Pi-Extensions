import { describe, expect, test } from "bun:test";
import { accumulateDuck, nestedHeaders, type DuckEvent } from "../../extensions/duck/index.ts";

async function* stream(events: DuckEvent[]): AsyncIterable<DuckEvent> {
  for (const event of events) yield event;
}

describe("accumulateDuck", () => {
  test("accumulates text deltas and reads usage from done", async () => {
    const seen: string[] = [];
    const result = await accumulateDuck(
      stream([
        { type: "start" },
        { type: "text_delta", delta: "1. What about " },
        { type: "text_delta", delta: "concurrency?" },
        { type: "done", message: { usage: { input: 12, output: 8 } } },
      ]),
      (partial) => seen.push(partial),
    );
    expect(result.text).toBe("1. What about concurrency?");
    expect(result.usage).toEqual({ input: 12, output: 8 });
    expect(result.error).toBeUndefined();
    expect(seen).toEqual(["1. What about ", "1. What about concurrency?"]);
  });

  test("falls back to the final message content when there are no deltas", async () => {
    const result = await accumulateDuck(
      stream([
        { type: "done", message: { content: [{ type: "text", text: "Only a question?" }], usage: { input: 3, output: 4 } } },
      ]),
    );
    expect(result.text).toBe("Only a question?");
    expect(result.usage).toEqual({ input: 3, output: 4 });
  });

  test("surfaces an error event", async () => {
    const result = await accumulateDuck(
      stream([{ type: "error", error: { errorMessage: "rate limited", usage: { input: 0, output: 0 } } }]),
    );
    expect(result.error).toBe("rate limited");
    expect(result.text).toBe("");
  });

  test("an empty stream yields empty text without throwing", async () => {
    const result = await accumulateDuck(stream([]));
    expect(result.text).toBe("");
    expect(result.usage).toBeUndefined();
  });
});

describe("nestedHeaders", () => {
  test("adds opencode session attribution only for opencode models", () => {
    expect(nestedHeaders({ provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1" }, "s1")).toEqual({
      "x-opencode-session": "s1",
      "x-opencode-client": "pi",
    });
    expect(nestedHeaders({ provider: "anthropic", baseUrl: "https://api.anthropic.com" }, "s1")).toBeUndefined();
    expect(nestedHeaders({ provider: "custom", baseUrl: "https://opencode.ai/x" }, "s2")?.["x-opencode-session"]).toBe("s2");
  });
});

import { describe, expect, test } from "bun:test";
import { accumulateDuck, type DuckEvent } from "../../extensions/duck/index.ts";

async function* stream(events: DuckEvent[]): AsyncIterable<DuckEvent> {
  for (const event of events) yield event;
}

describe("accumulateDuck", () => {
  test("accumulates text deltas and reads usage from done", async () => {
    const result = await accumulateDuck(
      stream([
        { type: "start" },
        { type: "text_delta", delta: "1. What about " },
        { type: "text_delta", delta: "concurrency?" },
        { type: "done", message: { usage: { input: 12, output: 8 } } },
      ]),
    );
    expect(result.text).toBe("1. What about concurrency?");
    expect(result.usage).toEqual({ input: 12, output: 8 });
    expect(result.error).toBeUndefined();
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

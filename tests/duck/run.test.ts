import { describe, expect, test } from "bun:test";
import { accumulateDuck, buildPanelLines, nestedHeaders, type DuckEvent } from "../../extensions/duck/index.ts";

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

describe("buildPanelLines", () => {
  const base = { text: "", view: "asking" as const, spinner: "⠋", scroll: 0, height: 12, total: 0 };

  test("shows a spinner while asking", () => {
    const lines = buildPanelLines(base, 80, "opencode-go/m");
    expect(lines[0]).toContain("duck · opencode-go/m · ⠋ asking…");
    expect(lines.join("\n")).toContain("waiting for the model…");
  });

  test("shows usage when done", () => {
    const lines = buildPanelLines(
      { ...base, view: "done", text: "Q1?\nQ2?", usage: { input: 10, output: 20 } },
      80,
      "opencode-go/m",
    );
    expect(lines[0]).toContain("in 10 / out 20");
    expect(lines.join("\n")).toContain("Q1?");
  });

  test("shows the error", () => {
    const lines = buildPanelLines({ ...base, view: "done", error: "boom" }, 80, "p/m");
    expect(lines.join("\n")).toContain("duck failed: boom");
  });

  test("windows the body by height and scroll", () => {
    const text = Array.from({ length: 40 }, (_, i) => `q${i}`).join("\n");
    const lines = buildPanelLines({ ...base, view: "done", text, height: 10 }, 80, "p/m");
    expect(lines.length).toBeLessThanOrEqual(10);
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

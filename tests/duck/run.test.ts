import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  accumulateDuck,
  buildDuckPanel,
  capDuckQuestions,
  duckRows,
  nestedHeaders,
  type DuckEvent,
  type DuckView,
} from "../../extensions/duck/index.ts";
import type { PanelTheme } from "../../extensions/shared/panel.ts";

async function* stream(events: DuckEvent[]): AsyncIterable<DuckEvent> {
  for (const event of events) yield event;
}

const plain: PanelTheme = { fg: (_color, text) => text, bg: (_color, text) => text };

const base: DuckView = { text: "", phase: "asking", spinner: "⠋", questions: [] };

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

describe("capDuckQuestions", () => {
  test("leaves five or fewer questions unchanged", () => {
    const text = ["1. First?", "2. Second?", "3. Third?"].join("\n");
    expect(capDuckQuestions(text)).toEqual({ text, omitted: 0 });
  });

  test("keeps the first five questions and reports the rest", () => {
    const text = Array.from({ length: 8 }, (_, index) => `${index + 1}. question ${index + 1}?`).join("\n");
    const capped = capDuckQuestions(text);
    expect(capped.omitted).toBe(3);
    expect(capped.text.split("\n")).toHaveLength(5);
    expect(capped.text).toContain("question 5?");
    expect(capped.text).not.toContain("question 6?");
  });

  test("never mangles unstructured prose", () => {
    const prose = "One long paragraph with no list markers and no question mark at the end.";
    expect(capDuckQuestions(prose)).toEqual({ text: prose, omitted: 0 });
  });
});

describe("duckRows", () => {
  test("structured questions win over the raw text", () => {
    const rows = duckRows({
      ...base,
      phase: "done",
      text: "raw text that should not be shown",
      questions: [{ id: "q1", header: "Scope", question: "How wide?", options: [{ label: "Narrow" }, { label: "Wide" }], allowOther: true }],
    });
    const text = rows.join("\n");
    expect(text).toContain("Scope — How wide?");
    expect(text).toContain("Narrow · Wide");
    expect(text).not.toContain("raw text");
  });

  test("falls back to capped raw text and reports the overflow", () => {
    const text = Array.from({ length: 8 }, (_, index) => `${index + 1}. question ${index + 1}?`).join("\n");
    const rows = duckRows({ ...base, phase: "done", text });
    expect(rows.join("\n")).toContain("question 5?");
    expect(rows.join("\n")).toContain("…and 3 more");
    expect(rows.join("\n")).not.toContain("question 6?");
  });

  test("reports the error and the waiting state", () => {
    expect(duckRows({ ...base, phase: "done", error: "boom" })).toEqual(["duck failed: boom"]);
    expect(duckRows({ ...base })).toEqual(["waiting for the model…"]);
  });
});

describe("buildDuckPanel", () => {
  test("shows the spinner while asking", () => {
    const lines = buildDuckPanel(plain, { ...base }, 80, "opencode-go/m");
    expect(lines[0]).toContain("duck");
    expect(lines[0]).toContain("asking");
    expect(lines.join("\n")).toContain("waiting for the model…");
  });

  test("shows usage and the close hint for a text fallback", () => {
    const view: DuckView = { ...base, phase: "done", text: "Q1?\nQ2?", usage: { input: 10, output: 20 } };
    const lines = buildDuckPanel(plain, view, 80, "opencode-go/m");
    expect(lines[0]).toContain("in 10 / out 20");
    expect(lines.join("\n")).toContain("Q1?");
    expect(lines.join("\n")).toContain("/duck to close");
  });

  test("offers the answer hint for structured questions", () => {
    const view: DuckView = {
      ...base,
      phase: "done",
      questions: [{ id: "q1", header: "Scope", question: "How wide?", options: [{ label: "Narrow" }], allowOther: true }],
    };
    const lines = buildDuckPanel(plain, view, 80, "opencode-go/m");
    expect(lines.join("\n")).toContain("/duck answer");
    expect(lines[0]).toContain("1 questions");
  });

  test("shows the error", () => {
    const lines = buildDuckPanel(plain, { ...base, phase: "done", error: "boom" }, 80, "p/m");
    expect(lines.join("\n")).toContain("duck failed: boom");
  });

  test("every line fits the widget width", () => {
    for (const width of [40, 80, 120]) {
      const lines = buildDuckPanel(plain, { ...base, phase: "done", text: "Q1?\nQ2?" }, width, "p/m");
      for (const line of lines) expect(visibleWidth(line)).toBe(width);
    }
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

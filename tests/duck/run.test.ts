import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  accumulateDuck,
  buildDuckPanel,
  capDuckQuestions,
  duckBodyRows,
  duckKeyAction,
  nestedHeaders,
  type DuckEvent,
  type DuckPanelState,
} from "../../extensions/duck/index.ts";
import type { PanelTheme } from "../../extensions/shared/panel.ts";

async function* stream(events: DuckEvent[]): AsyncIterable<DuckEvent> {
  for (const event of events) yield event;
}

const plain: PanelTheme = { fg: (_color, text) => text, bg: (_color, text) => text };

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

describe("duckKeyAction", () => {
  test("maps legacy sequences", () => {
    expect(duckKeyAction("\x1b")).toBe("close");
    expect(duckKeyAction("\x1b[A")).toBe("lineUp");
    expect(duckKeyAction("\x1b[B")).toBe("lineDown");
    expect(duckKeyAction("\x1b[5~")).toBe("pageUp");
    expect(duckKeyAction("\x1b[6~")).toBe("pageDown");
  });

  test("maps Kitty-protocol encodings identically", () => {
    // These are the encodings the raw-byte comparisons could never match.
    expect(duckKeyAction("\x1b[27u")).toBe("close");
    expect(duckKeyAction("\x1b[1;1A")).toBe("lineUp");
    expect(duckKeyAction("\x1b[1;1B")).toBe("lineDown");
    expect(duckKeyAction("\x1b[57421u")).toBe("pageUp");
    expect(duckKeyAction("\x1b[57422u")).toBe("pageDown");
    expect(duckKeyAction("\x1b[57423u")).toBe("home");
    expect(duckKeyAction("\x1b[57424u")).toBe("end");
  });

  test("keeps the single-character fallbacks", () => {
    expect(duckKeyAction("q")).toBe("close");
    expect(duckKeyAction("j")).toBe("lineDown");
    expect(duckKeyAction("k")).toBe("lineUp");
    expect(duckKeyAction("g")).toBe("home");
    expect(duckKeyAction("G")).toBe("end");
  });

  test("ignores unmapped input", () => {
    expect(duckKeyAction("x")).toBeUndefined();
    expect(duckKeyAction("Q1?")).toBeUndefined();
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

  test("counts bullet and Q-prefixed markers", () => {
    const text = ["- a?", "* b?", "• c?", "Q4: d?", "1) e?", "- f?"].join("\n");
    const capped = capDuckQuestions(text);
    expect(capped.omitted).toBe(1);
    expect(capped.text).not.toContain("f?");
  });

  test("never mangles unstructured prose", () => {
    const prose = "One long paragraph with no list markers and no question mark at the end.";
    expect(capDuckQuestions(prose)).toEqual({ text: prose, omitted: 0 });
  });
});

describe("buildDuckPanel", () => {
  const base = { text: "", view: "asking" as const, spinner: "⠋", scroll: 0, follow: true, limit: 12 };

  test("shows the spinner while asking", () => {
    const { lines } = buildDuckPanel(plain, { ...base }, 80, "opencode-go/m");
    expect(lines[0]).toContain("duck");
    expect(lines[0]).toContain("asking");
    expect(lines.join("\n")).toContain("waiting for the model…");
  });

  test("shows usage when done", () => {
    const state: DuckPanelState = { ...base, view: "done", text: "Q1?\nQ2?", usage: { input: 10, output: 20 } };
    const { lines } = buildDuckPanel(plain, state, 80, "opencode-go/m");
    expect(lines[0]).toContain("in 10 / out 20");
    expect(lines.join("\n")).toContain("Q1?");
  });

  test("shows the error and the close hint", () => {
    const { lines } = buildDuckPanel(plain, { ...base, view: "done", error: "boom" }, 80, "p/m");
    expect(lines.join("\n")).toContain("duck failed: boom");
    expect(lines.join("\n")).toContain("esc close");
  });

  test("windows a long body, follows the tail, and reports the range", () => {
    const text = Array.from({ length: 40 }, (_, index) => `q${index}`).join("\n");
    const { lines, total, offset } = buildDuckPanel(plain, { ...base, view: "done", text, limit: 10 }, 80, "p/m");
    expect(total).toBe(40);
    expect(offset).toBe(30);
    expect(lines.join("\n")).toContain("q39");
    expect(lines.join("\n")).toContain("lines 31–40 of 40");
  });

  test("shows the cap row when the model returns more than five questions", () => {
    const text = Array.from({ length: 8 }, (_, index) => `${index + 1}. question ${index + 1}?`).join("\n");
    const { lines } = buildDuckPanel(plain, { ...base, view: "done", text, limit: 20 }, 100, "p/m");
    expect(lines.join("\n")).toContain("question 5?");
    expect(lines.join("\n")).toContain("…and 3 more questions (capped at 5)");
    expect(lines.join("\n")).not.toContain("question 6?");
  });

  test("every line fits the overlay width", () => {
    for (const width of [40, 80, 120]) {
      const { lines } = buildDuckPanel(plain, { ...base, view: "done", text: "Q1?\nQ2?" }, width, "p/m");
      for (const line of lines) expect(visibleWidth(line)).toBe(width);
    }
  });
});

describe("duckBodyRows", () => {
  test("stays within the 80% overlay budget with sane bounds", () => {
    expect(duckBodyRows(40)).toBe(24);
    expect(duckBodyRows(10)).toBe(4);
    expect(duckBodyRows(2)).toBe(4);
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

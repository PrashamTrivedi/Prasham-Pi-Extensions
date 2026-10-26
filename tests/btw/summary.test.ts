import { describe, expect, test } from "bun:test";
import {
  appendToDraft,
  firstQuestion,
  formatSummaryBlock,
  lastAnswer,
  parseSummary,
  shortAnswer,
  stripCitations,
  trimAnswer,
} from "../../extensions/btw/summary.ts";
import type { BtwSideMessage } from "../../extensions/btw/prompt.ts";

const short: BtwSideMessage[] = [
  { role: "user", text: "What changed?" },
  { role: "assistant", text: "The parser skips thinking. [m2]" },
];

describe("firstQuestion", () => {
  test("takes the first user message and collapses whitespace", () => {
    expect(firstQuestion([{ role: "user", text: "  What\n changed?  " }, ...short])).toBe("What changed?");
    expect(firstQuestion([])).toBe("");
  });

  test("truncates a very long question", () => {
    const question = firstQuestion([{ role: "user", text: "x".repeat(500) }]);
    expect(question.length).toBeLessThanOrEqual(240);
    expect(question.endsWith("…")).toBe(true);
  });
});

describe("shortAnswer", () => {
  test("returns a one-question, one-answer side chat", () => {
    expect(shortAnswer(short)).toBe("The parser skips thinking. [m2]");
  });

  test("does not shortcut follow-ups or long answers", () => {
    expect(shortAnswer([...short, { role: "user", text: "again?" }, { role: "assistant", text: "yes" }])).toBeUndefined();
    expect(shortAnswer([short[0]!, { role: "assistant", text: "x".repeat(900) }])).toBeUndefined();
  });
});

describe("parseSummary", () => {
  test("extracts a title and leaves the body", () => {
    expect(parseSummary("TITLE: Parser change\n- Skips thinking\n- Cites blocks")).toEqual({
      title: "Parser change",
      body: "- Skips thinking\n- Cites blocks",
    });
  });

  test("works without a title", () => {
    expect(parseSummary("- one\n- two")).toEqual({ body: "- one\n- two" });
  });
});

describe("stripCitations", () => {
  test("removes side-chat block citations", () => {
    expect(stripCitations("The parser skips thinking [m2].")).toBe("The parser skips thinking.");
    expect(stripCitations("A [m1] B [m12]")).toBe("A B");
  });
});

describe("formatSummaryBlock", () => {
  test("prefixes the question and marks the side-chat origin", () => {
    const block = formatSummaryBlock("What changed?", "- Parser skips thinking.");
    expect(block.startsWith("BTW: What changed?")).toBe(true);
    expect(block).toContain("- Parser skips thinking.");
    expect(block).toContain("grounded only in the main chat");
  });

  test("handles an empty body", () => {
    expect(formatSummaryBlock("Q", " ")).toContain("(no answer)");
  });
});

describe("appendToDraft", () => {
  test("preserves an existing draft", () => {
    expect(appendToDraft("my next message", "BTW: Q\nA")).toBe("my next message\n\nBTW: Q\nA");
  });

  test("does not duplicate the same block", () => {
    const block = "BTW: Q\nA";
    expect(appendToDraft(`draft\n\n${block}`, block)).toBe(`draft\n\n${block}`);
  });

  test("returns the block when the editor is empty", () => {
    expect(appendToDraft("  ", "BTW: Q\nA")).toBe("BTW: Q\nA");
  });
});

describe("lastAnswer and trimAnswer", () => {
  test("finds the newest assistant text", () => {
    expect(lastAnswer([...short, { role: "assistant", text: "" }])).toBe("The parser skips thinking. [m2]");
    expect(lastAnswer([{ role: "user", text: "q" }])).toBeUndefined();
  });

  test("trims on a boundary", () => {
    const text = `${"x".repeat(700)}\n${"y".repeat(300)}`;
    const trimmed = trimAnswer(text, 800);
    expect(trimmed.length).toBeLessThanOrEqual(802);
    expect(trimmed.endsWith("…")).toBe(true);
  });
});

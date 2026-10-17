import { describe, expect, test } from "bun:test";
import { buildDuckPrompt } from "../../extensions/duck/prompt.ts";

describe("buildDuckPrompt", () => {
  test("demands a JSON array of questions and embeds the plan", () => {
    const prompt = buildDuckPrompt("PLAN-BODY", "");
    expect(prompt).toContain("Return ONLY a JSON array");
    expect(prompt).toContain("Do not answer them");
    expect(prompt).toContain("PLAN-BODY");
    expect(prompt).toContain("Focus: the work below");
  });

  test("states the four-question cap and the option shape", () => {
    const prompt = buildDuckPrompt("x", "");
    expect(prompt).toContain("1 to 4 questions");
    expect(prompt).toContain("2 to 4 options per question");
    expect(prompt).toContain('"header"');
    expect(prompt).toContain('"allowOther"');
  });

  test("uses a provided focus", () => {
    expect(buildDuckPrompt("x", "concurrency")).toContain("Focus: concurrency");
  });
});

import { describe, expect, test } from "bun:test";
import { buildDuckPrompt } from "../../extensions/duck/prompt.ts";

describe("buildDuckPrompt", () => {
  test("demands questions only and embeds the plan", () => {
    const prompt = buildDuckPrompt("PLAN-BODY", "");
    expect(prompt).toContain("QUESTIONS ONLY");
    expect(prompt).toContain("PLAN-BODY");
    expect(prompt).toContain("Focus: the plan below");
  });

  test("uses a provided focus", () => {
    expect(buildDuckPrompt("x", "concurrency")).toContain("Focus: concurrency");
  });
});

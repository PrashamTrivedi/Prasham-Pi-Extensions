import { describe, expect, test } from "bun:test";
import { buildContextBreakdown, knownCeilings, recursiveCeiling } from "../../extensions/workbench/context.ts";

describe("context breakdown", () => {
  test("reports live usage and ceilings without inventing values", () => {
    const lines = buildContextBreakdown({
      percent: 42,
      tokens: 84_000,
      contextWindow: 200_000,
      ceilings: [{ label: "x", chars: 8_000 }],
    });
    expect(lines[0]).toBe("context 42% (84000 / 200000 tokens)");
    expect(lines[1]).toContain("8,000 chars");
  });

  test("renders unknown values as ?", () => {
    const lines = buildContextBreakdown({ percent: null, tokens: null, contextWindow: 0, ceilings: [] });
    expect(lines[0]).toBe("context ? (? / 0 tokens)");
  });

  test("recursiveCeiling honours the env var with a 200k default", () => {
    const previous = process.env.PI_RECURSIVE_CONTEXT_MAX;
    delete process.env.PI_RECURSIVE_CONTEXT_MAX;
    expect(recursiveCeiling()).toBe(200_000);
    process.env.PI_RECURSIVE_CONTEXT_MAX = "5000";
    expect(recursiveCeiling()).toBe(5000);
    if (previous === undefined) delete process.env.PI_RECURSIVE_CONTEXT_MAX;
    else process.env.PI_RECURSIVE_CONTEXT_MAX = previous;
    expect(knownCeilings()).toHaveLength(2);
  });
});

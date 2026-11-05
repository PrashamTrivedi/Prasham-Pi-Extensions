import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_USAGE, foldUsage, formatUsage, parseUsageLine, sessionUsage, usageMetrics } from "../../extensions/fabric/usage.ts";

const line = (usage: Record<string, unknown>, tool?: string, role = "assistant") => JSON.stringify({
  type: "message",
  message: {
    role,
    content: tool ? [{ type: "text", text: "working" }, { type: "toolCall", name: tool }] : [{ type: "text", text: "done" }],
    usage,
  },
});
const priced = (tokens: number, cost: number) => ({ input: tokens, output: 10, cacheRead: 0, totalTokens: tokens, cost: { total: cost } });

test("an assistant turn yields its cost, tokens and last tool", () => {
  expect(parseUsageLine(line(priced(12_000, 0.04), "read"))).toEqual({ cost: 0.04, tokens: 12_000, tool: "read" });
  expect(parseUsageLine(line(priced(110, 0)))).toEqual({ cost: 0, tokens: 110 });
  // Anything that is not an assistant message contributes nothing.
  expect(parseUsageLine(line(priced(10, 0.1), "read", "user"))).toBeUndefined();
  expect(parseUsageLine(JSON.stringify({ type: "model_change", provider: "p", modelId: "m" }))).toBeUndefined();
  expect(parseUsageLine("not json")).toBeUndefined();
  expect(parseUsageLine("")).toBeUndefined();
  expect(parseUsageLine(JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "no usage" }] } }))).toBeUndefined();
});

test("folding sums turns and keeps the newest tool", () => {
  const first = foldUsage([line(priced(1_000, 0.01), "read"), line(priced(2_000, 0.02), "bash")].join("\n"));
  expect(first).toEqual({ cost: 0.03, tokens: 3_000, turns: 2, lastTool: "bash" });
  const second = foldUsage(line(priced(500, 0.005)), first);
  expect(second.cost).toBeCloseTo(0.035, 6);
  expect(second.tokens).toBe(3_500);
  expect(second.turns).toBe(3);
  expect(second.lastTool).toBe("bash");
  expect(foldUsage("", EMPTY_USAGE)).toEqual(EMPTY_USAGE);
});

test("usage reads only the appended bytes and never a partial line", () => {
  const dir = mkdtempSync(join(tmpdir(), "fabric-usage-"));
  const file = join(dir, "session.jsonl");
  writeFileSync(file, `${line(priced(1_000, 0.01), "read")}\n`);
  try {
    const one = sessionUsage(file);
    expect(one.usage.tokens).toBe(1_000);
    expect(one.cursor).toBeGreaterThan(0);
    // Nothing new: the previous total comes back untouched.
    expect(sessionUsage(file, one.cursor, one.usage)).toEqual(one);
    appendFileSync(file, `${line(priced(2_000, 0.02), "bash")}\n`);
    const two = sessionUsage(file, one.cursor, one.usage);
    expect(two.usage.tokens).toBe(3_000);
    expect(two.usage.lastTool).toBe("bash");
    expect(two.cursor).toBeGreaterThan(one.cursor);
    // A half-written line waits for its newline, and the cursor does not move past it.
    appendFileSync(file, line(priced(9_000, 0.5), "write").slice(0, 20));
    expect(sessionUsage(file, two.cursor, two.usage)).toEqual(two);
    expect(sessionUsage(join(dir, "missing.jsonl")).usage).toEqual(EMPTY_USAGE);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("usage formats for rows and cards", () => {
  expect(formatUsage(undefined)).toBe("");
  expect(formatUsage(EMPTY_USAGE)).toBe("");
  expect(formatUsage({ cost: 0.04, tokens: 12_000, lastTool: "read", turns: 2 })).toBe("$0.04 · 12k · read");
  expect(formatUsage({ cost: 0.0012, tokens: 110, lastTool: "bash", turns: 1 })).toBe("$0.0012 · 110 · bash");
  expect(usageMetrics({ cost: 0.04, tokens: 12_000, lastTool: "read", turns: 2 })).toEqual({ cost: "$0.04", tokens: "12k", tool: "read" });
  expect(usageMetrics(undefined)).toEqual({});
});

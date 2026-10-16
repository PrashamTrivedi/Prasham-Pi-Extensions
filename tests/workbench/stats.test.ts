import { describe, expect, test } from "bun:test";
import {
  duration,
  formatDuration,
  formatTokens,
  statusLine,
  tokenTotals,
} from "../../extensions/workbench/stats.ts";

const entries = [
  { message: { role: "assistant", timestamp: 1000, usage: { input: 100, output: 50 } } },
  { message: { role: "user", timestamp: 2000 } },
  { message: { role: "assistant", timestamp: 3000, usage: { input: 200, output: 100 } } },
  null,
  "junk",
];

describe("stats", () => {
  test("tokenTotals sums assistant usage and tolerates junk", () => {
    expect(tokenTotals(entries)).toBe(450);
    expect(tokenTotals([])).toBe(0);
  });

  test("duration is earliest timestamp to now", () => {
    expect(duration(entries, 4000)).toBe(3000);
    expect(duration([], 4000)).toBe(0);
  });

  test("formatDuration", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(59_000)).toBe("59s");
    expect(formatDuration(90_000)).toBe("1m30s");
    expect(formatDuration(3_600_000)).toBe("1h0m");
  });

  test("formatTokens", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(2_000_000)).toBe("2.0M");
  });

  test("statusLine composes branch, context, duration, tokens", () => {
    const line = statusLine({ branch: "main", percent: 42, durationMs: 61_000, tokens: 1234 });
    expect(line).toBe("main · ctx 42% · 1m1s · 1.2k tok");
  });

  test("statusLine does not fabricate an unknown percent", () => {
    expect(statusLine({ branch: "main", percent: null, durationMs: 0, tokens: 0 })).toContain("ctx ?");
  });
});

import { describe, expect, test } from "bun:test";
import {
  duration,
  formatDuration,
  formatTokens,
  cwdLabel,
  statusLine,
  truncateLeft,
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

describe("cwdLabel", () => {
  test("is home-relative, like Pi's built-in footer", () => {
    expect(cwdLabel("/home/me/Code/app", "/home/me")).toBe("~/Code/app");
    expect(cwdLabel("/home/me", "/home/me")).toBe("~");
  });

  test("keeps absolute paths outside home, and without a home", () => {
    expect(cwdLabel("/srv/app", "/home/me")).toBe("/srv/app");
    expect(cwdLabel("/srv/app")).toBe("/srv/app");
  });

  test("does not treat a sibling prefix as inside home", () => {
    expect(cwdLabel("/home/melanie/app", "/home/me")).toBe("/home/melanie/app");
  });
});

describe("truncateLeft", () => {
  test("leaves short text alone", () => {
    expect(truncateLeft("~/Code/app", 20)).toBe("~/Code/app");
  });

  test("keeps the tail of a long path", () => {
    const out = truncateLeft("~/Code/Projects/Prasham-Pi-Extensions", 24);
    expect(out).toHaveLength(24);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("Prasham-Pi-Extensions")).toBe(true);
  });

  test("degenerates safely at zero and one column", () => {
    expect(truncateLeft("anything", 0)).toBe("");
    expect(truncateLeft("anything", 1)).toBe("…");
  });
});

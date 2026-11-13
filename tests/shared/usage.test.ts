import { describe, expect, test } from "bun:test";
import { formatUsage } from "../../extensions/shared/usage.ts";

describe("formatUsage", () => {
  test("renders percent windows", () => {
    const text = formatUsage({
      provider: "opencode-go",
      windows: [
        { label: "rolling", percent: 2, resetsAt: "2026-10-15T18:02:13.000Z" },
        { label: "weekly", percent: 0 },
      ],
    });
    expect(text).toContain("rolling 2%");
    expect(text).toContain("weekly 0%");
  });

  test("renders a null percent as n/a instead of inventing zero", () => {
    const text = formatUsage({ provider: "x", windows: [{ label: "rolling", percent: null }] });
    expect(text).toContain("rolling n/a");
  });

  test("renders tokens and month-to-date USD", () => {
    const text = formatUsage({
      provider: "cloudflare-workers-ai",
      windows: [],
      tokensToday: { input: 1200, output: 300 },
      usdMtd: 1.5,
    });
    expect(text).toContain("1200 in / 300 out");
    expect(text).toContain("$1.50 MTD");
  });

  test("surfaces an error verbatim", () => {
    expect(formatUsage({ provider: "opencode-go", windows: [], error: "boom" })).toContain("boom");
  });

  test("uses the note when there is nothing else to show", () => {
    expect(formatUsage({ provider: "opencode-go", windows: [], note: "no data yet" })).toContain("no data yet");
  });

  test("never renders an empty segment", () => {
    expect(formatUsage({ provider: "opencode-go", windows: [] })).toBe("opencode-go: no data");
  });
});

describe("formatUsage theme colors", () => {
  const tagged = { fg: (color: "success" | "warning" | "error" | "dim", text: string) => `<${color}:${text}>` };
  const now = Date.parse("2026-11-13T12:00:00.000Z");
  const rolling = (percent: number, resetsAt?: string) => ({ label: "rolling", percent, ...(resetsAt ? { resetsAt } : {}) });
  const inMinutes = (minutes: number): string => new Date(now + minutes * 60_000).toISOString();

  test("colors each window by its pace", () => {
    const usage = {
      provider: "opencode-go",
      windows: [
        // 40% over 2h of 5h: the limit is not reached before the reset.
        rolling(40, inMinutes(180)),
        // 60% with the same 2h elapsed: the limit lands ~50 minutes early.
        rolling(60, inMinutes(180)),
      ],
    };
    expect(formatUsage(usage, tagged, now)).toContain("<success:40%>");
    expect(formatUsage(usage, tagged, now)).toContain("<error:60%>");
  });

  test("falls back to pressure colors when a window has no reset", () => {
    expect(formatUsage({ provider: "x", windows: [rolling(80)] }, tagged, now)).toContain("<error:80%>");
  });

  test("stays plain without a theme", () => {
    expect(formatUsage({ provider: "x", windows: [rolling(40, inMinutes(180))] }, undefined, now)).toBe("x: rolling 40%");
  });
});

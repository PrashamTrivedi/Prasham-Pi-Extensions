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
});

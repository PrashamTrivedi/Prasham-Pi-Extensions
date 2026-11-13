import { describe, expect, test } from "bun:test";
import {
  MIN_ELAPSED_FRACTION,
  PACE_COLOR,
  windowColor,
  windowDurationMs,
  windowKind,
  windowPace,
  yellowGapMs,
} from "../../extensions/shared/usage-pace.ts";
import type { UsageWindow } from "../../extensions/shared/usage.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = Date.parse("2026-11-13T12:00:00.000Z");
const at = (ms: number): string => new Date(now + ms).toISOString();

const rolling = (percent: number | null, resetInMs: number): UsageWindow => ({
  label: "rolling",
  percent,
  resetsAt: at(resetInMs),
});

describe("windowKind / durations", () => {
  test("maps provider labels and aliases", () => {
    expect(windowKind("rolling")).toBe("rolling");
    expect(windowKind(" Weekly ")).toBe("weekly");
    expect(windowKind("monthly")).toBe("monthly");
    expect(windowKind("5h")).toBe("rolling");
    expect(windowKind("30d")).toBe("monthly");
    expect(windowKind("daily")).toBeUndefined();
    expect(windowDurationMs("rolling")).toBe(5 * HOUR);
    expect(windowDurationMs("weekly")).toBe(7 * DAY);
    expect(windowDurationMs("monthly")).toBe(30 * DAY);
  });

  test("reference gaps are 10m / 2h / 5h", () => {
    expect(yellowGapMs("rolling")).toBe(10 * MINUTE);
    expect(yellowGapMs("weekly")).toBe(2 * HOUR);
    expect(yellowGapMs("monthly")).toBe(5 * HOUR);
  });
});

describe("windowPace", () => {
  test("green when the reset arrives before the limit", () => {
    // 40% used over 2.5h of 5h -> ~3.75h more at this pace, resets in 2.5h.
    const pace = windowPace(rolling(40, 2.5 * HOUR), now);
    expect(pace.status).toBe("green");
    expect(pace.gapMs).toBeLessThan(0);
  });

  test("yellow when the gap is short", () => {
    // 51% over 2.5h -> limit ~5.9 minutes before the reset.
    const pace = windowPace(rolling(51, 2.5 * HOUR), now);
    expect(pace.status).toBe("yellow");
    expect(pace.gapMs).toBeGreaterThan(0);
    expect(pace.gapMs).toBeLessThan(2 * 10 * MINUTE);
  });

  test("red at twice the yellow reference gap", () => {
    // 60% over 2.5h -> limit ~50 minutes before the reset.
    const pace = windowPace(rolling(60, 2.5 * HOUR), now);
    expect(pace.status).toBe("red");
    expect(pace.gapMs).toBeGreaterThanOrEqual(2 * 10 * MINUTE);
  });

  test("weekly and monthly use their own reference gaps", () => {
    const weeklyYellow = windowPace({ label: "weekly", percent: 51, resetsAt: at(3.5 * DAY) }, now);
    expect(weeklyYellow.status).toBe("yellow");
    const weeklyRed = windowPace({ label: "weekly", percent: 60, resetsAt: at(3.5 * DAY) }, now);
    expect(weeklyRed.status).toBe("red");
    // The live payload: 74% with two days left of a 30-day window is fine.
    expect(windowPace({ label: "monthly", percent: 74, resetsAt: at(2 * DAY) }, now).status).toBe("green");
  });

  test("zero used is green and a hit limit is red", () => {
    expect(windowPace(rolling(0, 3 * HOUR), now).status).toBe("green");
    const spent = windowPace(rolling(100, 3 * HOUR), now);
    expect(spent.status).toBe("red");
    expect(spent.exhaustMs).toBe(0);
    expect(spent.gapMs).toBe(3 * HOUR);
  });

  test("a fresh window is not painted red by one early burst", () => {
    // 2% in the first minute: the window is assumed 10% elapsed (30m for 5h).
    const pace = windowPace(rolling(2, 5 * HOUR - MINUTE), now);
    expect(MIN_ELAPSED_FRACTION).toBe(0.1);
    expect(pace.status).toBe("green");
  });

  test("unknown stays unknown instead of guessing", () => {
    expect(windowPace({ label: "rolling", percent: 40 }, now).status).toBe("unknown");
    expect(windowPace({ label: "daily", percent: 40, resetsAt: at(HOUR) }, now).status).toBe("unknown");
    expect(windowPace(rolling(null, HOUR), now).status).toBe("unknown");
    expect(windowPace(rolling(40, -HOUR), now).status).toBe("unknown");
    expect(windowPace(rolling(40, 0), now).status).toBe("unknown");
    expect(windowPace({ label: "rolling", percent: 40, resetsAt: "nope" }, now).status).toBe("unknown");
  });
});

describe("windowColor", () => {
  test("uses the pace color when it can be computed", () => {
    expect(windowColor(rolling(40, 2.5 * HOUR), now)).toBe("success");
    expect(windowColor(rolling(51, 2.5 * HOUR), now)).toBe("warning");
    expect(windowColor(rolling(60, 2.5 * HOUR), now)).toBe("error");
  });

  test("falls back to percent pressure without a reset", () => {
    expect(windowColor({ label: "rolling", percent: 49 }, now)).toBe("success");
    expect(windowColor({ label: "rolling", percent: 50 }, now)).toBe("warning");
    expect(windowColor({ label: "rolling", percent: 80 }, now)).toBe("error");
    expect(windowColor({ label: "rolling", percent: null }, now)).toBe("dim");
  });

  test("PACE_COLOR maps every status", () => {
    expect(PACE_COLOR).toEqual({ green: "success", yellow: "warning", red: "error", unknown: "dim" });
  });
});

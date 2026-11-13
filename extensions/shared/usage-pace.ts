/**
 * How close one provider window is to its limit, judged by the current pace
 * instead of the raw percentage. A window at 70% that resets in an hour is
 * fine; one at 40% that has barely started is not.
 *
 * The usage API reports `percent` and `resetsAt` but no window start, so the
 * pace is inferred from the label's window length (`rolling` = 5h, `weekly` =
 * 7d, `monthly` = 30d). At that pace `exhaustMs` is when the window would hit
 * 100%, `gapMs` is what is left of the window after that, and the color comes
 * from the gap:
 *
 *   green  - the limit is not reached before the reset
 *   yellow - it is reached, but the gap is short (below twice the reference)
 *   red    - the gap is at least twice the reference
 *
 * Reference gaps: 10 minutes (rolling), 2 hours (weekly), 5 hours (monthly).
 * A window counts as at least 10% elapsed, so a single early burst is not
 * extrapolated into a false red.
 */
import type { UsageWindow } from "./usage.ts";

export type PaceStatus = "green" | "yellow" | "red" | "unknown";
export type PaceColor = "success" | "warning" | "error" | "dim";

export interface WindowPace {
  status: PaceStatus;
  /** Milliseconds until the window resets, when known. */
  resetMs?: number;
  /** Milliseconds from now until the limit at this pace, when known. */
  exhaustMs?: number;
  /** `resetMs - exhaustMs`; negative when the limit is not reached before the reset. */
  gapMs?: number;
}

export type WindowKind = "rolling" | "weekly" | "monthly";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ALIASES: Record<string, WindowKind> = {
  rolling: "rolling",
  "5h": "rolling",
  hourly: "rolling",
  hour: "rolling",
  weekly: "weekly",
  week: "weekly",
  "7d": "weekly",
  monthly: "monthly",
  month: "monthly",
  "30d": "monthly",
};

const DURATION_MS: Record<WindowKind, number> = { rolling: 5 * HOUR, weekly: 7 * DAY, monthly: 30 * DAY };
const YELLOW_GAP_MS: Record<WindowKind, number> = { rolling: 10 * MINUTE, weekly: 2 * HOUR, monthly: 5 * HOUR };

/** A window is assumed at least this far along, so one burst is not a trend. */
export const MIN_ELAPSED_FRACTION = 0.1;

export const PACE_COLOR: Record<PaceStatus, PaceColor> = {
  green: "success",
  yellow: "warning",
  red: "error",
  unknown: "dim",
};

/** Canonical window kind for a provider label, or undefined when unrecognized. */
export function windowKind(label: string): WindowKind | undefined {
  return ALIASES[label.trim().toLowerCase()];
}

/** Window length the label implies, in milliseconds. */
export function windowDurationMs(label: string): number | undefined {
  const kind = windowKind(label);
  return kind === undefined ? undefined : DURATION_MS[kind];
}

/** The gap below which a window is yellow; red starts at twice it. */
export function yellowGapMs(label: string): number | undefined {
  const kind = windowKind(label);
  return kind === undefined ? undefined : YELLOW_GAP_MS[kind];
}

/** Pace of one window at `now`. Pure; unknown inputs stay explicit. */
export function windowPace(window: UsageWindow, now: number = Date.now()): WindowPace {
  const duration = windowDurationMs(window.label);
  const yellow = yellowGapMs(window.label);
  const at = window.resetsAt === undefined ? Number.NaN : Date.parse(window.resetsAt);
  if (duration === undefined || yellow === undefined || !Number.isFinite(at)) return { status: "unknown" };

  const resetMs = at - now;
  if (resetMs <= 0) return { status: "unknown", resetMs };
  const percent = window.percent;
  if (percent === null || !Number.isFinite(percent)) return { status: "unknown", resetMs };
  if (percent <= 0) return { status: "green", resetMs };
  if (percent >= 100) return { status: "red", resetMs, exhaustMs: 0, gapMs: resetMs };

  const elapsed = Math.min(duration, Math.max(duration * MIN_ELAPSED_FRACTION, duration - resetMs));
  const exhaustMs = (elapsed * (100 - percent)) / percent;
  const gapMs = resetMs - exhaustMs;
  const status: PaceStatus = gapMs <= 0 ? "green" : gapMs < yellow * 2 ? "yellow" : "red";
  return { status, resetMs, exhaustMs, gapMs };
}

/**
 * Color for a usage window: the pace color when it can be computed, and the
 * old percent-pressure color (50% / 80%) when the window carries no reset.
 */
export function windowColor(window: UsageWindow, now: number = Date.now()): PaceColor {
  const status = windowPace(window, now).status;
  if (status !== "unknown") return PACE_COLOR[status];
  const percent = window.percent;
  if (percent === null || !Number.isFinite(percent)) return "dim";
  return percent < 50 ? "success" : percent < 80 ? "warning" : "error";
}

import { windowColor } from "./usage-pace.ts";

/** One provider quota window (rolling / weekly / monthly). */
export interface UsageWindow {
  label: string;
  /** Percentage used, or `null` when the provider does not report a number. */
  percent: number | null;
  /** ISO timestamp when the window resets, when known. */
  resetsAt?: string;
}

/**
 * A normalized view of one provider's usage. opencode-go contributes `windows`;
 * Cloudflare contributes `usdMtd` / token totals. Missing values stay missing -
 * `formatUsage` never fabricates a figure.
 */
export interface ProviderUsage {
  provider: string;
  windows: UsageWindow[];
  tokensToday?: { input: number; output: number };
  usdMtd?: number;
  /** Explanation for an empty/unusual readout, e.g. "percent-only". */
  note?: string;
  error?: string;
}

/** The slice of a theme that `formatUsage` colors with; Pi's `Theme` fits structurally. */
export interface UsageTheme {
  fg(color: "success" | "warning" | "error" | "dim", text: string): string;
}

/**
 * Render a `ProviderUsage` as a single compact status segment.
 *
 * With a theme each window's percentage is colored by its pace (see
 * `usage-pace.ts`), falling back to percent pressure when the provider reports
 * no reset time. Without one the text is plain, which keeps the Cloudflare
 * segment and the tests unchanged.
 */
export function formatUsage(usage: ProviderUsage, theme?: UsageTheme, now: number = Date.now()): string {
  if (usage.error) return `${usage.provider}: ${usage.error}`;

  const parts: string[] = [];
  for (const window of usage.windows) {
    const percent = window.percent === null ? "n/a" : `${Math.round(window.percent)}%`;
    const shown = theme ? theme.fg(windowColor(window, now), percent) : percent;
    parts.push(`${window.label} ${shown}`);
  }
  if (usage.tokensToday) {
    parts.push(`${usage.tokensToday.input} in / ${usage.tokensToday.output} out`);
  }
  if (typeof usage.usdMtd === "number") {
    parts.push(`$${usage.usdMtd.toFixed(2)} MTD`);
  }

  if (parts.length === 0) return `${usage.provider}: ${usage.note ?? "no data"}`;
  const text = parts.join(" · ");
  return usage.note ? `${usage.provider}: ${text} (${usage.note})` : `${usage.provider}: ${text}`;
}

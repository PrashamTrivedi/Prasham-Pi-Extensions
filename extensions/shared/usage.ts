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

/** Render a `ProviderUsage` as a single compact status segment. */
export function formatUsage(usage: ProviderUsage): string {
  if (usage.error) return `${usage.provider}: ${usage.error}`;

  const parts: string[] = [];
  for (const window of usage.windows) {
    const percent = window.percent === null ? "n/a" : `${Math.round(window.percent)}%`;
    parts.push(`${window.label} ${percent}`);
  }
  if (usage.tokensToday) {
    parts.push(`${usage.tokensToday.input} in / ${usage.tokensToday.output} out`);
  }
  if (typeof usage.usdMtd === "number") {
    parts.push(`$${usage.usdMtd.toFixed(2)} MTD`);
  }

  if (parts.length === 0 && usage.note) return `${usage.provider}: ${usage.note}`;
  const text = parts.join(" · ");
  return usage.note ? `${usage.provider}: ${text} (${usage.note})` : `${usage.provider}: ${text}`;
}

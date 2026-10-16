/**
 * Pure helpers for the statusline. Cost is intentionally **not** shown as USD:
 * Pi exposes no pricing table, so the extension displays locally counted tokens
 * instead of fabricating a dollar figure.
 */

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Total input+output tokens across assistant messages. */
export function tokenTotals(entries: readonly unknown[]): number {
  let total = 0;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const message = (entry as Record<string, unknown>).message;
    if (typeof message !== "object" || message === null) continue;
    const record = message as Record<string, unknown>;
    if (record.role !== "assistant") continue;
    const usage = record.usage;
    if (typeof usage !== "object" || usage === null) continue;
    const usageRecord = usage as Record<string, unknown>;
    total += number(usageRecord.input) + number(usageRecord.output);
  }
  return total;
}

/** Milliseconds from the earliest message timestamp to `now`. */
export function duration(entries: readonly unknown[], now: number = Date.now()): number {
  let earliest: number | undefined;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const message = (entry as Record<string, unknown>).message;
    if (typeof message !== "object" || message === null) continue;
    const timestamp = (message as Record<string, unknown>).timestamp;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
      earliest = earliest === undefined ? timestamp : Math.min(earliest, timestamp);
    }
  }
  return earliest === undefined ? 0 : Math.max(0, now - earliest);
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

export interface StatusLineInput {
  branch: string;
  percent: number | null;
  durationMs: number;
  tokens: number;
}

export function statusLine(input: StatusLineInput): string {
  const context = input.percent === null ? "ctx ?" : `ctx ${Math.round(input.percent)}%`;
  return `${input.branch} · ${context} · ${formatDuration(input.durationMs)} · ${formatTokens(input.tokens)} tok`;
}

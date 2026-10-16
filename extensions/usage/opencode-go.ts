/**
 * opencode-go quota reporter.
 *
 * Maps `GET https://opencode.ai/zen/go/v1/usage` to `ProviderUsage`. The endpoint
 * is undocumented and unversioned, and returns percentages only - no tokens and no
 * spend - so the result carries a `note` saying so. Any failure degrades to an
 * `error` string; it never throws.
 *
 * The API key is read from the environment named by `keyEnv` and is sent to
 * exactly one host. It is never logged, cached, or written anywhere.
 */
import type { ProviderUsage, UsageWindow } from "../shared/usage.ts";

export interface UsageFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type UsageFetch = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<UsageFetchResponse>;

export interface OpencodeGoOptions {
  keyEnv?: string;
  baseUrl?: string;
  fetchImpl?: UsageFetch;
  now?: () => number;
  timeoutMs?: number;
  ttlMs?: number;
}

const PROVIDER = "opencode-go";
const DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1/usage";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_TTL_MS = 60_000;
const WINDOW_LABELS = ["rolling", "weekly", "monthly"] as const;

interface CacheEntry {
  at: number;
  value: ProviderUsage;
}

let cache: CacheEntry | undefined;

/** Clear the process-local TTL cache (e.g. on model switch). */
export function clearOpencodeGoUsageCache(): void {
  cache = undefined;
}

function failure(message: string): ProviderUsage {
  return { provider: PROVIDER, windows: [], error: message };
}

function windowFrom(label: string, raw: unknown): UsageWindow | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const percent = typeof record.percent === "number" && Number.isFinite(record.percent) ? record.percent : null;
  const resetsAt = typeof record.resetsAt === "string" ? record.resetsAt : undefined;
  return resetsAt ? { label, percent, resetsAt } : { label, percent };
}

export async function fetchOpencodeGoUsage(options: OpencodeGoOptions = {}): Promise<ProviderUsage> {
  const keyEnv = options.keyEnv ?? "OPENCODE_API_KEY";
  const key = process.env[keyEnv];
  if (!key) return failure(`${keyEnv} not set`);

  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (cache && now() - cache.at < ttlMs) return cache.value;

  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch: UsageFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));

  try {
    const response = await doFetch(baseUrl, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) return failure(`usage API HTTP ${response.status}`);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return failure("usage API returned non-JSON");
    }

    const usage = (payload as { usage?: unknown } | null)?.usage;
    if (typeof usage !== "object" || usage === null) return failure("usage API payload missing 'usage'");

    const windows: UsageWindow[] = [];
    for (const label of WINDOW_LABELS) {
      const window = windowFrom(label, (usage as Record<string, unknown>)[label]);
      if (window) windows.push(window);
    }
    if (windows.length === 0) return failure("usage API payload had no windows");

    const value: ProviderUsage = {
      provider: PROVIDER,
      windows,
      note: "percent-only; provider reports no spend or tokens",
    };
    cache = { at: now(), value };
    return value;
  } catch (error) {
    return failure(error instanceof Error ? error.message : "usage request failed");
  }
}

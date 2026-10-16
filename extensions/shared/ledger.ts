/**
 * Node-safe HTTP client for the Jev ledger server (`shared/ledger-server.ts`,
 * started with Bun). This module contains no SQLite import, so it is safe to load
 * inside Pi's Node runtime.
 *
 * Every failure - server not running, timeout, non-200, malformed body - resolves
 * to `{ rows: [], error }`. It never throws and never writes.
 */

export interface LedgerRow {
  [key: string]: unknown;
}

export interface LedgerResult<T = LedgerRow> {
  rows: T[];
  error?: string;
}

export interface LedgerResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type LedgerFetch = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<LedgerResponseLike>;

export interface LedgerClientOptions {
  baseUrl?: string;
  fetchImpl?: LedgerFetch;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:37650";
const DEFAULT_TIMEOUT_MS = 2000;

function baseUrl(options?: LedgerClientOptions): string {
  const configured = options?.baseUrl ?? process.env.PI_JEV_LEDGER_URL ?? DEFAULT_BASE_URL;
  return configured.replace(/\/+$/, "");
}

async function get<T>(path: string, options?: LedgerClientOptions): Promise<LedgerResult<T>> {
  const doFetch: LedgerFetch = options?.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const response = await doFetch(`${baseUrl(options)}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { rows: [], error: `ledger HTTP ${response.status}` };

    const payload = (await response.json()) as { rows?: unknown; error?: unknown };
    if (payload && typeof payload.error === "string" && payload.error.length > 0) {
      return { rows: [], error: payload.error };
    }
    if (!payload || !Array.isArray(payload.rows)) {
      return { rows: [], error: "ledger returned no rows array" };
    }
    return { rows: payload.rows as T[] };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : "ledger request failed" };
  }
}

export function recentCalls(limit = 50, options?: LedgerClientOptions): Promise<LedgerResult> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.trunc(limit))) : 50;
  return get(`/recent-calls?limit=${safeLimit}`, options);
}

export function decisionCounts(options?: LedgerClientOptions): Promise<LedgerResult<{ decision: string; count: number }>> {
  return get(`/decision-counts`, options);
}

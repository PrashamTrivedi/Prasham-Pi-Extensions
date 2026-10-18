/**
 * Node-safe HTTP client for the Jev ledger server (`shared/ledger-server.ts`,
 * started with Bun). This module contains no SQLite import, so it is safe to load
 * inside Pi's Node runtime.
 *
 * Every failure - server not running, timeout, non-200, malformed body - resolves
 * to `{ rows: [], error }`. It never throws and never writes.
 *
 * When the real fetch is used against the default local server and the connection
 * fails, the client lazily starts the Bun server once and retries, so the workbench
 * never shows "fetch failed" just because the server has not been started. Tests
 * inject a `fetchImpl` and never trigger the spawn.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
const SERVER_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "ledger-server.ts");

function baseUrl(options?: LedgerClientOptions): string {
  const configured = options?.baseUrl ?? process.env.PI_JEV_LEDGER_URL ?? DEFAULT_BASE_URL;
  return configured.replace(/\/+$/, "");
}

/** True when the URL points at the local Bun server we may auto-start. */
export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

let starting: Promise<void> | undefined;

function serverUp(url: string): Promise<boolean> {
  return fetch(`${url}/decision-counts`, { signal: AbortSignal.timeout(400) })
    .then((response) => response.ok)
    .catch(() => false);
}

/** Start the local Bun server once and wait for it to answer (best effort). */
function ensureServer(url: string): Promise<void> {
  if (!starting) {
    starting = (async () => {
      if (await serverUp(url)) return;
      const child = spawn("bun", ["run", SERVER_SCRIPT], { detached: true, stdio: "ignore", env: process.env });
      child.on("error", () => { /* bun missing; the retry reports the original error */ });
      child.unref();
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (await serverUp(url)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    })().finally(() => {
      starting = undefined;
    });
  }
  return starting;
}

async function get<T>(path: string, options?: LedgerClientOptions): Promise<LedgerResult<T>> {
  const doFetch: LedgerFetch = options?.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = baseUrl(options);

  const attempt = async (): Promise<{ result: LedgerResult<T>; network: boolean }> => {
    try {
      const response = await doFetch(`${base}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) return { result: { rows: [], error: `ledger HTTP ${response.status}` }, network: false };
      const payload = (await response.json()) as { rows?: unknown; error?: unknown };
      if (payload && typeof payload.error === "string" && payload.error.length > 0) {
        return { result: { rows: [], error: payload.error }, network: false };
      }
      if (!payload || !Array.isArray(payload.rows)) {
        return { result: { rows: [], error: "ledger returned no rows array" }, network: false };
      }
      return { result: { rows: payload.rows as T[] }, network: false };
    } catch (error) {
      return {
        result: { rows: [], error: error instanceof Error ? error.message : "ledger request failed" },
        network: true,
      };
    }
  };

  const first = await attempt();
  if (first.network && !options?.fetchImpl && isLocalUrl(base)) {
    await ensureServer(base);
    return (await attempt()).result;
  }
  return first.result;
}

export function recentCalls(limit = 50, options?: LedgerClientOptions): Promise<LedgerResult> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.trunc(limit))) : 50;
  return get(`/recent-calls?limit=${safeLimit}`, options);
}

export function decisionCounts(options?: LedgerClientOptions): Promise<LedgerResult<{ decision: string; count: number }>> {
  return get(`/decision-counts`, options);
}

export function sessionCalls(limit = 50, options?: LedgerClientOptions): Promise<LedgerResult> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(5000, Math.trunc(limit))) : 50;
  return get(`/session-calls?limit=${safeLimit}`, options);
}

export function sessionSummary(options?: LedgerClientOptions): Promise<LedgerResult> {
  return get(`/session-summary`, options);
}

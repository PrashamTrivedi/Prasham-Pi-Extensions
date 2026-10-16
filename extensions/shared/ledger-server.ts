/**
 * Bun-only read-only HTTP view over the Jev decision ledger.
 *
 * Runtime split: Pi runs under Node, where `bun:sqlite` is unavailable, and the
 * test runner is Bun, where `node:sqlite` is unavailable. So the SQLite binding
 * lives *only* here, in a process started with Bun; the extension side
 * (`shared/ledger.ts`) is a plain HTTP client. This module must never be
 * re-exported from `shared/index.ts`, or `bun:sqlite` would enter the Node
 * extension graph.
 *
 * Run: `bun run extensions/shared/ledger-server.ts`
 * Env: `PI_JEV_LEDGER_DB` (default `~/.jev-harness/jev.db`),
 *      `PI_JEV_LEDGER_PORT` (default `37650`).
 */
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { clamp } from "./config.ts";
import { readSessionEntries, summarizeSession } from "./session.ts";

export interface LedgerRow {
  [key: string]: unknown;
}

export interface LedgerHandlerOptions {
  dbPath: string;
  /** Path to the session JSONL; defaults to `PI_SESSION_LEDGER` or ~/.pi/agent/state/session.jsonl. */
  sessionPath?: string;
}

export type LedgerHandler = (request: Request) => Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Pure request handler; the database is opened lazily and read-only on first use. */
export function createLedgerHandler(options: LedgerHandlerOptions): LedgerHandler {
  let database: Database | undefined;

  const sessionPath = options.sessionPath ?? process.env.PI_SESSION_LEDGER ?? join(homedir(), ".pi", "agent", "state", "session.jsonl");

  const open = (): Database => {
    if (!database) database = new Database(options.dbPath, { readonly: true });
    return database;
  };

  return async (request: Request): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return json({ error: "invalid request url" }, 400);
    }

    try {
      if (url.pathname === "/recent-calls") {
        const requested = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
        const limit = clamp(Number.isFinite(requested) ? requested : 50, 1, 500);
        const rows = open().query("SELECT * FROM jev_calls ORDER BY id DESC LIMIT ?").all(limit);
        return json({ rows });
      }
      if (url.pathname === "/decision-counts") {
        const rows = open()
          .query("SELECT decision, COUNT(*) AS count FROM jev_calls GROUP BY decision ORDER BY count DESC")
          .all();
        return json({ rows });
      }
      if (url.pathname === "/session-calls") {
        const requested = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
        const limit = clamp(Number.isFinite(requested) ? requested : 50, 1, 5000);
        return json({ rows: readSessionEntries(limit, sessionPath) });
      }
      if (url.pathname === "/session-summary") {
        return json({ rows: [summarizeSession(readSessionEntries(100_000, sessionPath))] });
      }
      return json({ error: "not found" }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "ledger read failed" }, 500);
    }
  };
}

if (import.meta.main) {
  const dbPath = process.env.PI_JEV_LEDGER_DB ?? join(homedir(), ".jev-harness", "jev.db");
  const requestedPort = Number.parseInt(process.env.PI_JEV_LEDGER_PORT ?? "37650", 10);
  const port = clamp(Number.isFinite(requestedPort) ? requestedPort : 37650, 1, 65535);
  Bun.serve({ hostname: "127.0.0.1", port, fetch: createLedgerHandler({ dbPath }) });
  console.log(`Jev ledger server listening on http://127.0.0.1:${port} (db: ${dbPath})`);
}

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLedgerHandler } from "../../extensions/shared/ledger-server.ts";

let root: string;
let dbPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-mods-ledger-"));
  dbPath = join(root, "jev.db");
  const db = new Database(dbPath);
  db.exec(
    "CREATE TABLE jev_calls (id INTEGER PRIMARY KEY, ts TEXT, agent TEXT, event TEXT, decision TEXT, mode TEXT, session_id TEXT, tool TEXT, model TEXT, state TEXT, questions TEXT, answers TEXT, input_tokens INTEGER, latency_ms INTEGER, status TEXT, error TEXT)",
  );
  const insert = db.prepare("INSERT INTO jev_calls (ts, agent, event, decision, status) VALUES (?, ?, ?, ?, ?)");
  insert.run("t1", "pi", "tool_call", "allow", "ok");
  insert.run("t2", "pi", "tool_call", "deny", "ok");
  insert.run("t3", "pi", "tool_call", "allow", "ok");
  db.close();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("createLedgerHandler", () => {
  test("recent-calls respects the limit and returns JSON", async () => {
    const handler = createLedgerHandler({ dbPath });
    const response = await handler(new Request("http://127.0.0.1:37650/recent-calls?limit=2"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { rows: unknown[] };
    expect(body.rows).toHaveLength(2);
  });

  test("decision-counts groups rows", async () => {
    const handler = createLedgerHandler({ dbPath });
    const response = await handler(new Request("http://127.0.0.1:37650/decision-counts"));
    const body = (await response.json()) as { rows: Array<{ decision: string; count: number }> };
    expect(body.rows.find((row) => row.decision === "allow")?.count).toBe(2);
    expect(body.rows.find((row) => row.decision === "deny")?.count).toBe(1);
  });

  test("a missing database yields a JSON error, not a crash", async () => {
    const handler = createLedgerHandler({ dbPath: join(root, "missing.db") });
    const response = await handler(new Request("http://127.0.0.1:37650/recent-calls"));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  });

  test("an unknown path is 404", async () => {
    const handler = createLedgerHandler({ dbPath });
    expect((await handler(new Request("http://127.0.0.1:37650/nope"))).status).toBe(404);
  });
});

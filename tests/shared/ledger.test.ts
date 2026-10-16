import { describe, expect, test } from "bun:test";
import {
  decisionCounts,
  recentCalls,
  type LedgerClientOptions,
  type LedgerResponseLike,
} from "../../extensions/shared/ledger.ts";

function jsonResponse(value: unknown, status = 200): LedgerResponseLike {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

describe("ledger client", () => {
  test("returns rows from the server", async () => {
    const options: LedgerClientOptions = { fetchImpl: async () => jsonResponse({ rows: [{ id: 1 }] }) };
    const result = await recentCalls(10, options);
    expect(result.rows).toEqual([{ id: 1 }]);
    expect(result.error).toBeUndefined();
  });

  test("a non-200 becomes an error, not a throw", async () => {
    const options: LedgerClientOptions = { fetchImpl: async () => jsonResponse({}, 500) };
    const result = await decisionCounts(options);
    expect(result.rows).toEqual([]);
    expect(result.error).toContain("500");
  });

  test("a connection failure becomes an error", async () => {
    const options: LedgerClientOptions = {
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    };
    const result = await recentCalls(5, options);
    expect(result.rows).toEqual([]);
    expect(result.error).toContain("ECONNREFUSED");
  });

  test("a bad payload becomes an error", async () => {
    const options: LedgerClientOptions = { fetchImpl: async () => jsonResponse({ nope: true }) };
    const result = await recentCalls(5, options);
    expect(result.rows).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  test("a server-reported error is surfaced", async () => {
    const options: LedgerClientOptions = { fetchImpl: async () => jsonResponse({ error: "boom" }) };
    const result = await decisionCounts(options);
    expect(result.error).toBe("boom");
  });
});

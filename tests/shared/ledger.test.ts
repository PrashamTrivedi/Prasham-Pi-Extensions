import { describe, expect, test } from "bun:test";
import {
  decisionCounts,
  isLocalUrl,
  LEDGER_RESTART_COOLDOWN_MS,
  recentCalls,
  resetRestartState,
  restartAllowed,
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

describe("server restart supervision", () => {
  test("a failed poll restarts the server at most once per cooldown", () => {
    expect(LEDGER_RESTART_COOLDOWN_MS).toBe(15_000);
    const now = 1_000_000;
    // No attempt yet, or the cooldown has passed: a restart is allowed.
    expect(restartAllowed(0, now)).toBe(true);
    expect(restartAllowed(now - 15_000, now)).toBe(true);
    expect(restartAllowed(now - 20_000, now)).toBe(true);
    // A recent attempt blocks another one, so a zombie port cannot fork-bomb the cockpit.
    expect(restartAllowed(now - 1_000, now)).toBe(false);
    expect(restartAllowed(now, now)).toBe(false);
    expect(restartAllowed(now - 1_000, now, 500)).toBe(true);
    resetRestartState();
  });
});

describe("isLocalUrl", () => {
  test("local hosts only", () => {
    expect(isLocalUrl("http://127.0.0.1:37650")).toBe(true);
    expect(isLocalUrl("http://localhost:37650")).toBe(true);
    expect(isLocalUrl("http://[::1]:37650")).toBe(true);
    expect(isLocalUrl("https://decisions.prashamhtrivedi.app")).toBe(false);
    expect(isLocalUrl("not a url")).toBe(false);
  });
});

import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clearOpencodeGoUsageCache,
  fetchOpencodeGoUsage,
  type UsageFetch,
  type UsageFetchResponse,
} from "../../extensions/usage/opencode-go.ts";

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "fixtures", "opencode-go-usage.json"), "utf8"),
) as unknown;

function ok(value: unknown): UsageFetchResponse {
  return { ok: true, status: 200, json: async () => value };
}

function status(code: number): UsageFetchResponse {
  return { ok: false, status: code, json: async () => ({}) };
}

beforeEach(() => {
  clearOpencodeGoUsageCache();
  process.env.OPENCODE_API_KEY = "test-key";
});

describe("fetchOpencodeGoUsage", () => {
  test("maps the live payload to exactly three windows", async () => {
    const usage = await fetchOpencodeGoUsage({ fetchImpl: async () => ok(fixture) });
    expect(usage.provider).toBe("opencode-go");
    expect(usage.windows.map((window) => window.label)).toEqual(["rolling", "weekly", "monthly"]);
    expect(usage.windows.map((window) => window.percent)).toEqual([2, 0, 0]);
    expect(usage.windows[0]?.resetsAt).toBe("2026-10-15T18:02:13.000Z");
    expect(usage.windows[2]?.resetsAt).toBe("2026-11-15T12:17:12.000Z");
    expect(usage.error).toBeUndefined();
    expect(usage.note).toBeTruthy();
  });

  test("a non-200 response yields an error without throwing", async () => {
    const usage = await fetchOpencodeGoUsage({ fetchImpl: async () => status(404) });
    expect(usage.windows).toEqual([]);
    expect(usage.error).toContain("404");
  });

  test("a non-JSON body yields an error", async () => {
    const usage = await fetchOpencodeGoUsage({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("bad json");
        },
      }),
    });
    expect(usage.windows).toEqual([]);
    expect(usage.error).toBeTruthy();
  });

  test("a payload without windows yields an error", async () => {
    const usage = await fetchOpencodeGoUsage({ fetchImpl: async () => ok({ usage: {} }) });
    expect(usage.windows).toEqual([]);
    expect(usage.error).toBeTruthy();
  });

  test("a missing key yields an error naming the env var", async () => {
    delete process.env.OPENCODE_API_KEY;
    const usage = await fetchOpencodeGoUsage({ fetchImpl: async () => ok(fixture) });
    expect(usage.error).toContain("OPENCODE_API_KEY");
  });

  test("a thrown fetch yields an error", async () => {
    const usage = await fetchOpencodeGoUsage({
      fetchImpl: async () => {
        throw new Error("ETIMEDOUT");
      },
    });
    expect(usage.error).toContain("ETIMEDOUT");
  });

  test("TTL caches within the window and the key is only ever sent as a bearer header", async () => {
    let calls = 0;
    let seenAuthorization = "";
    const fetchImpl: UsageFetch = async (_input, init) => {
      calls += 1;
      seenAuthorization = init?.headers?.Authorization ?? "";
      return ok(fixture);
    };
    let clock = 0;
    await fetchOpencodeGoUsage({ fetchImpl, now: () => clock, ttlMs: 1000 });
    clock = 500;
    const cached = await fetchOpencodeGoUsage({ fetchImpl, now: () => clock, ttlMs: 1000 });
    expect(calls).toBe(1);
    expect(cached.error).toBeUndefined();
    expect(seenAuthorization).toBe("Bearer test-key");
    expect(JSON.stringify(cached)).not.toContain("test-key");
  });
});

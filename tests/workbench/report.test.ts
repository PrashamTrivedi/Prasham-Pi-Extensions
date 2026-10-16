import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSessionEntries,
  recordSessionEntry,
  summarizeSession,
} from "../../extensions/shared/session.ts";

let root: string;
let path: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-mods-session-"));
  path = join(root, "session.jsonl");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("session ledger", () => {
  test("records and reads entries in order", () => {
    recordSessionEntry({ ts: 1, kind: "tool", tool: "read", latencyMs: 5 }, path);
    recordSessionEntry({ ts: 2, kind: "message", input: 100, output: 40 }, path);
    const rows = readSessionEntries(10, path);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.tool).toBe("read");
  });

  test("a missing file returns an empty array", () => {
    expect(readSessionEntries(10, join(root, "nope.jsonl"))).toEqual([]);
  });

  test("summarize counts calls, tokens, and tools", () => {
    const summary = summarizeSession([
      { ts: 1, kind: "tool", tool: "read" },
      { ts: 2, kind: "tool", tool: "read" },
      { ts: 3, kind: "tool", tool: "bash" },
      { ts: 4, kind: "message", input: 10, output: 5 },
    ]);
    expect(summary.calls).toBe(3);
    expect(summary.tools.read).toBe(2);
    expect(summary.tokens).toBe(15);
  });

  test("limit returns the most recent entries", () => {
    for (let index = 0; index < 5; index += 1) {
      recordSessionEntry({ ts: index, kind: "tool", tool: `t${index}` }, path);
    }
    const rows = readSessionEntries(2, path);
    expect(rows.map((row) => row.tool)).toEqual(["t3", "t4"]);
  });
});

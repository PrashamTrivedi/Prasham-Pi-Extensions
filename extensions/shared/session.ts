/**
 * Local, append-only session ledger (Node `fs`; plain JSONL, safe in Pi).
 * Read by `/report` and served read-only by `ledger-server.ts`.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface SessionEntry {
  ts: number;
  kind: "tool" | "message";
  tool?: string;
  latencyMs?: number;
  input?: number;
  output?: number;
  model?: string;
}

export interface SessionSummary {
  entries: number;
  calls: number;
  tokens: number;
  tools: Record<string, number>;
}

export function sessionLedgerPath(): string {
  return process.env.PI_SESSION_LEDGER ?? join(homedir(), ".pi", "agent", "state", "session.jsonl");
}

export function recordSessionEntry(entry: SessionEntry, path: string = sessionLedgerPath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Never let accounting take the session down.
  }
}

export function readSessionEntries(limit = 10_000, path: string = sessionLedgerPath()): SessionEntry[] {
  let lines: string[];
  try {
    lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
  const out: SessionEntry[] = [];
  const start = Math.max(0, lines.length - Math.max(1, limit));
  for (let index = start; index < lines.length; index += 1) {
    try {
      out.push(JSON.parse(lines[index] as string) as SessionEntry);
    } catch {
      // skip malformed line
    }
  }
  return out;
}

export function summarizeSession(entries: readonly SessionEntry[]): SessionSummary {
  const tools: Record<string, number> = {};
  let calls = 0;
  let tokens = 0;
  for (const entry of entries) {
    if (entry.kind === "tool") {
      calls += 1;
      if (entry.tool) tools[entry.tool] = (tools[entry.tool] ?? 0) + 1;
    }
    tokens += (entry.input ?? 0) + (entry.output ?? 0);
  }
  return { entries: entries.length, calls, tokens, tools };
}

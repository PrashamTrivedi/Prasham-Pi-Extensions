/**
 * Shared Jev bridge.
 *
 * Two ways to consult Jev (TypeSafe System One) from this package without editing the
 * jev-harness codebase:
 *
 *  - `runJevDecision` spawns the existing jev-harness Pi adapter as a subprocess and returns
 *    its merged verdict JSON. This is the same bridge `jev-gate` used inline.
 *  - `askJev` is a thin, direct HTTP client for the Jev decisions endpoint. It mirrors the
 *    jev-harness wire contract (config, credentials, headers) but performs no logging or
 *    ledger writes: the caller takes the decision locally.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HARNESS_DIR = process.env.PI_JEV_HARNESS_DIR ?? join(homedir(), ".claude", "skills", "jev-harness");
export const ADAPTER = join(HARNESS_DIR, "adapters", "pi", "run.ts");
const ADAPTER_TIMEOUT_MS = 8000;

export interface Verdicts {
  gate?: { action: "deny" | "ask"; reason: string };
  rewrite?: { input: Record<string, unknown>; note: string };
  replace?: { output: string; note: string };
  cont?: { reason: string };
  context?: string[];
  notify?: string[];
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}
export type Answer = NoulAnswer | { type: string; [key: string]: unknown };
export type Answers = Record<string, Answer>;

export interface AskJevResult {
  answers: Answers;
  model: string;
  inputTokens: number;
}

interface JevClientConfig {
  endpoint: string;
  apiKeyName: string;
  model: string;
  timeoutMs: number;
}

const JEV_CLIENT_DEFAULTS: JevClientConfig = {
  endpoint: "https://api.typesafe.ai/v1/systemone",
  apiKeyName: "TYPESAFE_API_KEY",
  model: "jev-latest",
  timeoutMs: 4000,
};

/** Runtime home for the thin client. Mirrors jev-harness's `JEV_HARNESS_HOME` override. */
function jevHome(): string {
  return process.env.JEV_HARNESS_HOME ?? join(homedir(), ".jev-harness");
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function loadJevConfig(): JevClientConfig {
  const file = join(jevHome(), "config.json");
  let user: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) user = parsed as Record<string, unknown>;
    } catch {
      // A malformed config falls back to the defaults.
    }
  }
  return {
    endpoint: asString(user.endpoint, JEV_CLIENT_DEFAULTS.endpoint),
    apiKeyName: asString(user.apiKeyName, JEV_CLIENT_DEFAULTS.apiKeyName),
    model: asString(user.model, JEV_CLIENT_DEFAULTS.model),
    timeoutMs: asNumber(user.timeoutMs, JEV_CLIENT_DEFAULTS.timeoutMs),
  };
}

/** Env first, then `~/.jev-harness/credentials` (`KEY=value` lines). */
function readSecret(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const file = join(jevHome(), "credentials");
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && match[1] === name) return match[2];
  }
  return undefined;
}

/**
 * Run the jev-harness adapter subprocess for `eventName` and resolve with its verdict JSON.
 * Resolves `undefined` on a transport failure (timeout, spawn error, or non-JSON stdout) so
 * callers can distinguish "Jev answered neutral/safe" (`{}`) from "Jev unavailable" and fail
 * closed. A successful adapter run always resolves a parsed `Verdicts` object (possibly `{}`).
 */
export function runJevDecision(eventName: string, payload: Record<string, unknown>): Promise<Verdicts | undefined> {
  return new Promise((resolve) => {
    let stdout = "";
    const child = spawn("bun", [ADAPTER, eventName], { stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already exited */ }
      resolve(undefined);
    }, ADAPTER_TIMEOUT_MS);
    child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      console.error(`jev: adapter failed (${HARNESS_DIR}):`, error.message);
      resolve(undefined);
    });
    child.on("close", () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(stdout.trim()) as Verdicts); } catch { resolve(undefined); }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

/**
 * Shell-approval coordination between `sandbox-dev` (runs first, owns the prompt for commands its
 * deterministic policy flags) and `jev-gate` (runs second). When `sandbox-dev` has already resolved
 * a shell command's safety, `jev-gate` skips its own shell-safety gate so the human is prompted at
 * most once per tool call.
 */
const shellHandled = new Set<string>();

export function markShellApprovalHandled(toolCallId: string): void {
  shellHandled.add(toolCallId);
}

export function shellApprovalHandled(toolCallId: string): boolean {
  return shellHandled.has(toolCallId);
}

/**
 * Ask Jev a set of questions directly. Reads the endpoint/model/timeout and the bearer key the
 * same way jev-harness does, but performs no logging. Throws on any failure so callers can fail
 * closed.
 */
export async function askJev(state: unknown, questions: Record<string, unknown>): Promise<AskJevResult> {
  const config = loadJevConfig();
  const key = readSecret(config.apiKeyName);
  if (!key) throw new Error(`${config.apiKeyName} not set (env or ~/.jev-harness/credentials)`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Deadline-Ms": String(config.timeoutMs),
      },
      body: JSON.stringify({ model: config.model, state, questions }),
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`jev request failed: ${message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`jev HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  let data: { answers?: Answers; model?: string; usage?: { input_tokens?: number } };
  try {
    data = (await response.json()) as typeof data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`jev returned non-JSON: ${message}`);
  }

  return {
    answers: data.answers ?? {},
    model: asString(data.model, config.model),
    inputTokens: data.usage?.input_tokens ?? 0,
  };
}

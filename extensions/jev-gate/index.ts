/**
 * `jev-gate` — run the jev-harness decision framework for Pi.
 *
 * Mirrors how jev-harness is wired into Claude Code / Cursor / Antigravity: on every
 * relevant Pi event it normalizes to the neutral HookEvent, invokes the Bun adapter
 * (`~/.claude/skills/jev-harness/adapters/pi/run.ts`) as a subprocess with the event on
 * stdin, and applies the merged verdict (block / confirm / rewrite / replace output /
 * notify / continue). The adapter logs to the same `jev.db` ledger as the other agents.
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const HARNESS_DIR = process.env.PI_JEV_HARNESS_DIR ?? join(homedir(), ".claude", "skills", "jev-harness");
const ADAPTER = join(HARNESS_DIR, "adapters", "pi", "run.ts");
const TIMEOUT_MS = 8000;

export type ToolKind = "shell" | "read" | "write" | "edit" | "mcp" | "fetch" | "subagent" | "browser" | "other";

export interface JevToolCall {
  name: string;
  kind: ToolKind;
  input: Record<string, unknown>;
  command?: string;
  description?: string;
  path?: string;
  content?: string;
  range?: { start?: number; end?: number };
  url?: string;
  mcpServer?: string;
  mcpTool?: string;
  mcpArgs?: Record<string, unknown>;
  output?: string;
  subagentPrompt?: string;
  subagentModel?: string;
}

interface Verdicts {
  gate?: { action: "deny" | "ask"; reason: string };
  rewrite?: { input: Record<string, unknown>; note: string };
  replace?: { output: string; note: string };
  cont?: { reason: string };
  context?: string[];
  notify?: string[];
}

function asStr(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Map a Pi tool name + input to the neutral jev-harness ToolCall. Pure. */
export function mapToolCall(name: string, input: Record<string, unknown>): JevToolCall {
  const base = { name, input };
  if (name === "bash") {
    return { ...base, kind: "shell", command: asStr(input.command), description: asStr(input.description) };
  }
  if (name === "read") {
    const offset = typeof input.offset === "number" ? input.offset : undefined;
    const limit = typeof input.limit === "number" ? input.limit : undefined;
    return {
      ...base,
      kind: "read",
      path: asStr(input.path),
      range: offset || limit ? { start: offset, end: limit ? (offset ?? 1) + limit - 1 : undefined } : undefined,
    };
  }
  if (name === "write") return { ...base, kind: "write", path: asStr(input.path), content: asStr(input.content) };
  if (name === "edit") {
    const edits = Array.isArray(input.edits) ? (input.edits as Array<{ newText?: unknown }>) : [];
    const content = edits.map((edit) => String(edit.newText ?? "")).join("\n") || asStr(input.content);
    return { ...base, kind: "edit", path: asStr(input.path), content };
  }
  if (name === "spawn_agents") {
    const agents = Array.isArray(input.agents) ? (input.agents as Array<{ task?: unknown; model?: unknown }>) : [];
    return {
      ...base,
      kind: "subagent",
      subagentPrompt: asStr(agents[0]?.task ?? input.task),
      subagentModel: asStr(agents[0]?.model ?? input.model),
    };
  }
  if (name.startsWith("mcp__")) {
    const [, server, ...rest] = name.split("__");
    return { ...base, kind: "mcp", mcpServer: server, mcpTool: rest.join("__"), mcpArgs: input };
  }
  if (name === "web_fetch" || name === "fetch") return { ...base, kind: "fetch", url: asStr(input.url) };
  return { ...base, kind: "other" };
}

/** Join the text parts of a Pi tool result. Pure. */
export function flattenContent(content: Array<{ type?: string; text?: string }>): string {
  return content
    .filter((part) => part?.type === "text")
    .map((part) => String(part.text ?? ""))
    .join("\n")
    .trim();
}

/** Run the adapter subprocess and resolve with its verdict JSON (neutral `{}` on any failure). */
function runAdapter(eventName: string, payload: Record<string, unknown>): Promise<Verdicts> {
  return new Promise((resolve) => {
    let stdout = "";
    const child = spawn("bun", [ADAPTER, eventName], { stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already exited */ }
      resolve({});
    }, TIMEOUT_MS);
    child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      console.error(`jev-gate: adapter failed (${HARNESS_DIR}):`, error.message);
      resolve({});
    });
    child.on("close", () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(stdout.trim()) as Verdicts); } catch { resolve({}); }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function sessionId(ctx: ExtensionContext): string {
  try { return ctx.sessionManager.getSessionId(); } catch { return "unknown"; }
}

function lastAssistant(ctx: ExtensionContext): string {
  const entries = ctx.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as { message?: { role?: string; content?: Array<{ type?: string; text?: string }> } };
    if (entry?.message?.role !== "assistant") continue;
    const text = (entry.message.content ?? [])
      .filter((part) => part?.type === "text")
      .map((part) => part.text ?? "")
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

export default function jevGate(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const tool = mapToolCall(event.toolName, event.input as unknown as Record<string, unknown>);
    const verdicts = await runAdapter("pre_tool", {
      sessionId: sessionId(ctx),
      cwd: ctx.cwd,
      transcriptPath: process.env.PI_SESSION_FILE,
      tool,
    });
    for (const note of verdicts.notify ?? []) ctx.ui.notify(note, "info");
    if (verdicts.gate?.action === "deny") return { block: true, reason: `jev: ${verdicts.gate.reason}` };
    if (verdicts.gate?.action === "ask") {
      if (!ctx.hasUI) return { block: true, reason: `jev: ${verdicts.gate.reason} (no UI to confirm)` };
      const ok = await ctx.ui.confirm("jev permission", verdicts.gate.reason);
      return ok ? undefined : { block: true, reason: "jev: denied by user" };
    }
    if (verdicts.rewrite) {
      Object.assign(event.input as Record<string, unknown>, verdicts.rewrite.input);
      ctx.ui.notify(`jev: ${verdicts.rewrite.note}`, "info");
    }
    return undefined;
  });

  pi.on("tool_result", async (event, ctx) => {
    const tool = mapToolCall(event.toolName, event.input as unknown as Record<string, unknown>);
    tool.output = flattenContent(event.content as Array<{ type?: string; text?: string }>);
    const verdicts = await runAdapter(event.isError ? "tool_failure" : "post_tool", {
      sessionId: sessionId(ctx),
      cwd: ctx.cwd,
      transcriptPath: process.env.PI_SESSION_FILE,
      tool,
    });
    for (const note of verdicts.notify ?? []) ctx.ui.notify(note, "info");
    if (verdicts.replace) return { content: [{ type: "text", text: verdicts.replace.output }] };
    const context = verdicts.context ?? [];
    if (context.length) {
      return { content: [...event.content, { type: "text", text: `\n\n${context.join("\n")}` }] };
    }
    return undefined;
  });

  pi.on("agent_before_settle", async (event, ctx) => {
    if (event.outcome !== "completed") return;
    const verdicts = await runAdapter("stop", {
      sessionId: sessionId(ctx),
      cwd: ctx.cwd,
      transcriptPath: process.env.PI_SESSION_FILE,
      lastAssistantText: lastAssistant(ctx),
    });
    const entries: Array<{ type: "custom_message"; customType: string; content: string; display: true }> = [];
    for (const note of verdicts.notify ?? []) entries.push({ type: "custom_message", customType: "jev", content: note, display: true });
    if (verdicts.cont) {
      entries.push({ type: "custom_message", customType: "jev", content: verdicts.cont.reason, display: true });
      return { continue: true, entries };
    }
    if (entries.length) return { entries };
    return undefined;
  });
}

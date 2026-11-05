/**
 * `jev-gate` — run the jev-harness decision framework for Pi.
 *
 * Mirrors how jev-harness is wired into Claude Code / Cursor / Antigravity: on every
 * relevant Pi event it normalizes to the neutral HookEvent, invokes the Bun adapter
 * (`~/.claude/skills/jev-harness/adapters/pi/run.ts`) as a subprocess with the event on
 * stdin, and applies the merged verdict (block / confirm / rewrite / replace output /
 * notify / continue). The adapter logs to the same `jev.db` ledger as the other agents.
 *
 * `sandbox-dev` owns the `tool_call` decision: it asks the decision server about every tool
 * call and turns a non-approval into one human prompt. This extension therefore handles
 * results and the stop event only — one gate, one owner, one server call per tool call.
 *
 * The harness reads Claude-shaped transcripts. `../shared/jev-transcript.ts` mirrors the
 * Pi session into that shape so usage-token decisions (compact-advisor) and prompt/turn
 * decisions see the real conversation instead of an undefined path.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runJevDecision, type Verdicts } from "../shared/jev.ts";
import { mirrorTranscript, type TranscriptMirror } from "../shared/jev-transcript.ts";
import { flattenContent, mapToolCall, type JevToolCall } from "../shared/tool-call.ts";

// Re-exported for the mapping tests and for any extension that wants the neutral shape.
export { flattenContent, mapToolCall } from "../shared/tool-call.ts";
export type { JevToolCall, ToolKind } from "../shared/tool-call.ts";

export interface ToolResultEventLike {
  toolName: string;
  input?: unknown;
  content: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

export interface DecisionBase {
  sessionId: string;
  cwd: string;
  transcriptPath?: string;
}

/** Payloads are plain JSON for the adapter, so they stay index-signature compatible. */
export interface ToolResultPayload extends DecisionBase {
  tool: JevToolCall;
  [key: string]: unknown;
}
export interface StopDecisionPayload extends DecisionBase {
  lastAssistantText: string;
  reentry: boolean;
  [key: string]: unknown;
}

/**
 * The neutral payload for a tool result. A failed result carries the same text as
 * `tool.error`, which is what jev-harness's `failure-triage` applies on.
 */
export function toolResultPayload(event: ToolResultEventLike, base: DecisionBase): ToolResultPayload {
  const tool = mapToolCall(event.toolName, (event.input ?? {}) as Record<string, unknown>);
  const output = flattenContent(event.content);
  tool.output = output;
  if (event.isError) tool.error = output;
  return { sessionId: base.sessionId, cwd: base.cwd, transcriptPath: base.transcriptPath, tool };
}

/** The neutral payload for a stop, including the Claude `stop_hook_active` equivalent. */
export function stopPayload(base: DecisionBase & { lastAssistantText: string; reentry: boolean }): StopDecisionPayload {
  return { sessionId: base.sessionId, cwd: base.cwd, transcriptPath: base.transcriptPath, lastAssistantText: base.lastAssistantText, reentry: base.reentry };
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

export interface JevGateOptions {
  /** Test seam: replaces the adapter subprocess call. */
  decide?: (event: string, payload: Record<string, unknown>) => Promise<Verdicts | undefined>;
  /** Test seam: where mirrors are written (defaults to the system temp dir). */
  mirrorRoot?: string;
}

export default function jevGate(pi: ExtensionAPI, options: JevGateOptions = {}) {
  const decide = options.decide ?? runJevDecision;
  /** Per-session mirrors, so each result event appends only the new session bytes. */
  const mirrors = new Map<string, TranscriptMirror>();

  /** Claude-shaped mirror of this session; the harness reads usage and prompts from it. */
  function transcriptPath(ctx: ExtensionContext, id: string): string | undefined {
    let source: string | undefined;
    try { source = ctx.sessionManager.getSessionFile?.() ?? undefined; } catch { source = undefined; }
    try {
      const mirror = mirrorTranscript(id, { source, entries: ctx.sessionManager.getBranch(), previous: mirrors.get(id), root: options.mirrorRoot });
      if (mirror) mirrors.set(id, mirror);
      return mirror?.path ?? source;
    } catch {
      return source;
    }
  }

  pi.on("tool_result", async (event, ctx) => {
    const id = sessionId(ctx);
    const payload = toolResultPayload(event as ToolResultEventLike, { sessionId: id, cwd: ctx.cwd, transcriptPath: transcriptPath(ctx, id) });
    const verdicts = (await decide(event.isError ? "tool_failure" : "post_tool", payload)) ?? {};
    for (const note of verdicts.notify ?? []) ctx.ui.notify(note, "info");
    if (verdicts.replace) return { content: [{ type: "text", text: verdicts.replace.output }] };
    const context = verdicts.context ?? [];
    if (context.length) {
      return { content: [...event.content, { type: "text", text: `\n\n${context.join("\n")}` }] };
    }
    return undefined;
  });

  /** Sessions where this stop already continued once (Claude's `stop_hook_active`). */
  const continued = new Set<string>();

  pi.on("agent_before_settle", async (event, ctx) => {
    if (event.outcome !== "completed") return;
    const id = sessionId(ctx);
    const reentry = continued.has(id);
    const payload = stopPayload({ sessionId: id, cwd: ctx.cwd, transcriptPath: transcriptPath(ctx, id), lastAssistantText: lastAssistant(ctx), reentry });
    const verdicts = (await decide("stop", payload)) ?? {};
    const entries: Array<{ type: "custom_message"; customType: string; content: string; display: true }> = [];
    for (const note of verdicts.notify ?? []) entries.push({ type: "custom_message", customType: "jev", content: note, display: true });
    // Never continue twice for one stop: promise-continue and compact-advisor gate on reentry.
    if (verdicts.cont && !reentry) {
      continued.add(id);
      entries.push({ type: "custom_message", customType: "jev", content: verdicts.cont.reason, display: true });
      return { continue: true, entries };
    }
    // This stop settled without a continuation, so the next turn starts a fresh chain.
    continued.delete(id);
    if (entries.length) return { entries };
    return undefined;
  });
}

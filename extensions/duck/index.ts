/**
 * `/duck` — a questions-only second opinion on the current plan, via an in-process
 * nested call (`ctx.modelRegistry.streamSimple`). No subprocess, no floating overlay.
 *
 * The panel is a docked `setWidget` above the editor, so it reserves layout space and
 * never covers the transcript (DeepSeek Pro reviewed and endorsed this over a
 * side-rail custom editor). Widgets take no keyboard input, so the interaction lives
 * in commands: `/duck` runs or closes, `/duck answer` opens the AskUserQuestion-style
 * questionnaire for the questions the model returned.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { renderPanel, type PanelTheme } from "../shared/panel.ts";
import { runQuestionnaire } from "../shared/questionnaire.ts";
import { composeDuckAnswers, toQuestionnaireQuestions } from "./answers.ts";
import { buildDuckPrompt } from "./prompt.ts";
import { parseDuckQuestions, type DuckQuestion } from "./questions.ts";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TITLE = "duck";
const WIDGET_KEY = "duck";
/** Question rows the docked panel shows before it stops (widgets cannot scroll). */
const WIDGET_BODY_LIMIT = 14;

function textOfMessage(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text") {
      parts.push(String((part as { text?: unknown }).text ?? ""));
    }
  }
  return parts.join("\n").trim();
}

function usageOf(message: unknown): { input?: number; output?: number } | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const usage = (message as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const record = usage as Record<string, unknown>;
  return {
    input: typeof record.input === "number" ? record.input : undefined,
    output: typeof record.output === "number" ? record.output : undefined,
  };
}

function errorOf(message: unknown): string {
  if (typeof message === "object" && message !== null) {
    const errorMessage = (message as { errorMessage?: unknown }).errorMessage;
    if (typeof errorMessage === "string" && errorMessage.length > 0) return errorMessage;
  }
  return "model error";
}

/** Latest assistant text from the active branch, used as the plan. */
export function latestAssistantText(ctx: ExtensionContext): string {
  const entries = ctx.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as unknown;
    if (typeof entry !== "object" || entry === null) continue;
    const message = (entry as { message?: unknown }).message;
    if (typeof message !== "object" || message === null) continue;
    if ((message as { role?: unknown }).role !== "assistant") continue;
    const text = textOfMessage(message);
    if (text.length > 0) return text;
  }
  return "";
}

export interface DuckResult {
  text: string;
  usage?: { input?: number; output?: number };
  error?: string;
}

/** Structural subset of `AssistantMessageEvent`; keeps accumulation testable. */
export type DuckEvent = {
  type: string;
  delta?: string;
  partial?: unknown;
  message?: unknown;
  error?: unknown;
};

/** Drive a nested stream to completion, accumulating text and usage. */
export async function accumulateDuck(
  stream: AsyncIterable<DuckEvent>,
  onDelta?: (text: string) => void,
): Promise<DuckResult> {
  let text = "";
  let final: unknown;
  let error: string | undefined;
  for await (const event of stream) {
    if (event.type === "text_delta" && typeof event.delta === "string") {
      text += event.delta;
      onDelta?.(text);
    } else if (event.type === "done") {
      final = event.message;
    } else if (event.type === "error") {
      final = event.error;
      error = errorOf(event.error);
    }
  }
  return { text: text.trim() || textOfMessage(final), usage: usageOf(final), error };
}

/** opencode routes requests by session; nested calls must send its attribution header. */
export function nestedHeaders(
  model: { provider: string; baseUrl: string },
  sessionId: string,
): Record<string, string> | undefined {
  const isOpencode =
    model.provider === "opencode" || model.provider === "opencode-go" || model.baseUrl.includes("opencode.ai");
  if (!isOpencode) return undefined;
  return { "x-opencode-session": sessionId, "x-opencode-client": "pi" };
}

const QUESTION_MARKER = /^\s*(?:[-*•]|\d+[.)]|Q\d*\s*[:.)])\s*/i;

/** True when a line reads as a question (a list marker or a trailing `?`). */
function isQuestionLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  return trimmed.endsWith("?") || QUESTION_MARKER.test(trimmed);
}

export interface DuckCap {
  text: string;
  /** Questions dropped past the cap. */
  omitted: number;
}

/**
 * Keep at most `max` questions in the free-text fallback, preserving the lines of
 * the kept ones. Text with no recognisable question lines is returned unchanged.
 */
export function capDuckQuestions(text: string, max = 5): DuckCap {
  const lines = text.split("\n");
  let seen = 0;
  let cut = -1;
  let omitted = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!isQuestionLine(lines[index]!)) continue;
    seen += 1;
    if (seen === max) cut = index;
    else if (seen > max) omitted += 1;
  }
  if (cut === -1 || omitted === 0) return { text, omitted: 0 };
  return { text: lines.slice(0, cut + 1).join("\n"), omitted };
}

export interface DuckView {
  text: string;
  phase: "asking" | "done";
  usage?: { input?: number; output?: number };
  error?: string;
  spinner: string;
  /** Structured questions recovered from a completed answer. */
  questions: DuckQuestion[];
}

function duckStatus(view: DuckView): string {
  if (view.error !== undefined) return "error";
  if (view.phase === "asking") return `${view.spinner} asking…`;
  const structured = view.questions.length > 0 ? `${view.questions.length} questions · ` : "";
  return `${structured}in ${view.usage?.input ?? 0} / out ${view.usage?.output ?? 0}`;
}

/** Body rows for the docked panel. Pure; structured questions win over raw text. */
export function duckRows(view: DuckView): string[] {
  if (view.error !== undefined) return [`duck failed: ${view.error}`];
  if (view.questions.length > 0) {
    const rows: string[] = [];
    for (const question of view.questions) {
      rows.push(`• ${question.header} — ${question.question}`);
      if (question.options.length > 0) rows.push(`    ${question.options.map((option) => option.label).join(" · ")}`);
    }
    return rows;
  }
  if (view.text.length > 0) {
    const capped = capDuckQuestions(view.text);
    return capped.omitted > 0 ? [...capped.text.split("\n"), "", `…and ${capped.omitted} more`] : capped.text.split("\n");
  }
  return [view.phase === "asking" ? "waiting for the model…" : "(the model returned no questions)"];
}

/** Compose the docked duck panel. Docked above the editor; cannot take focus. */
export function buildDuckPanel(theme: PanelTheme, view: DuckView, width: number, label: string): string[] {
  const footer =
    view.questions.length > 0 && view.phase === "done"
      ? "/duck answer · /duck to close"
      : "/duck to close";
  return renderPanel(theme, width, {
    title: TITLE,
    right: `${label} · ${duckStatus(view)}`,
    body: duckRows(view),
    footer,
    limit: WIDGET_BODY_LIMIT,
  }).lines;
}

let live: { view: DuckView; label: string } | undefined;
let requestRender: (() => void) | undefined;
let spinner: ReturnType<typeof setInterval> | undefined;

function stopSpinner(): void {
  if (spinner !== undefined) {
    clearInterval(spinner);
    spinner = undefined;
  }
}

function close(ctx: ExtensionContext): void {
  stopSpinner();
  live = undefined;
  requestRender = undefined;
  ctx.ui.setWidget(WIDGET_KEY, undefined);
}

function install(ctx: ExtensionContext): void {
  ctx.ui.setWidget(
    WIDGET_KEY,
    (tui, theme) => {
      requestRender = () => tui.requestRender();
      return {
        render: (width: number) => (live ? buildDuckPanel(theme, live.view, width, live.label) : []),
        invalidate: () => {},
      };
    },
    { placement: "aboveEditor" },
  );
}

function run(ctx: ExtensionContext, focus: string): void {
  const model = ctx.model;
  if (!model) {
    ctx.ui.notify("duck: no active model", "error");
    return;
  }
  const plan = latestAssistantText(ctx) || "(no plan in this session yet)";
  const view: DuckView = { text: "", phase: "asking", spinner: SPINNER[0]!, questions: [] };
  live = { view, label: `${model.provider}/${model.id}` };
  install(ctx);
  stopSpinner();
  spinner = setInterval(() => {
    if (view.phase !== "asking") return;
    view.spinner = SPINNER[(SPINNER.indexOf(view.spinner) + 1) % SPINNER.length]!;
    requestRender?.();
  }, 120);

  void (async () => {
    const sessionId = ctx.sessionManager.getSessionId();
    const headers = nestedHeaders(model, sessionId);
    try {
      const stream = ctx.modelRegistry.streamSimple(
        model,
        { messages: [{ role: "user", content: buildDuckPrompt(plan, focus), timestamp: Date.now() }] },
        headers ? { sessionId, headers } : { sessionId },
      );
      const result = await accumulateDuck(stream, (partial) => {
        view.text = partial;
        requestRender?.();
      });
      view.usage = result.usage;
      view.error = result.error;
      if (result.error === undefined) view.questions = parseDuckQuestions(result.text).questions;
    } catch (error) {
      view.error = error instanceof Error ? error.message : String(error);
    } finally {
      view.phase = "done";
      stopSpinner();
      requestRender?.();
    }
  })();
}

async function answer(ctx: ExtensionContext): Promise<void> {
  const questions = live?.view.questions ?? [];
  if (questions.length === 0) {
    ctx.ui.notify("duck: no structured questions yet — run /duck first", "warning");
    return;
  }
  const answers = await runQuestionnaire(ctx, toQuestionnaireQuestions(questions));
  if (!answers || answers.length === 0) return;
  // `setEditorText` replaces, so keep whatever draft is already there.
  const existing = ctx.ui.getEditorText();
  const block = composeDuckAnswers(questions, answers);
  ctx.ui.setEditorText(existing.trim().length > 0 ? `${existing.trimEnd()}\n\n${block}` : block);
  ctx.ui.notify("duck: answers added to the editor", "info");
}

export default function duck(pi: ExtensionAPI) {
  pi.registerCommand("duck", {
    description: "Ask a questions-only second opinion, docked above the editor",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      const focus = args.trim();
      if (focus === "close") {
        close(ctx);
        return;
      }
      if (focus === "answer") {
        await answer(ctx);
        return;
      }
      if (focus.length === 0 && live) {
        close(ctx);
        return;
      }
      run(ctx, focus);
    },
  });

  pi.on("session_shutdown", async () => {
    stopSpinner();
    live = undefined;
    requestRender = undefined;
  });
}

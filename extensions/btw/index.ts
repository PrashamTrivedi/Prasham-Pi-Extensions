/**
 * `/btw` — a main-chat-only side chat.
 *
 * The window answers from the current chat transcript alone, using an in-process
 * nested model call. It never appends a session entry, sends a message, or runs a
 * tool, so the main chat's context is untouched. `alt+s` in the window, or
 * `/btw send` after closing, stages a compact summary in the editor for the next
 * main-chat message.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { FABRIC_AGENTS_WIDGET, beginFullScreen, endFullScreen } from "../shared/full-screen.ts";
import { accumulateNested, nestedHeaders, type NestedUsage } from "../shared/nested.ts";
import { BTW_OVERLAY_OPTIONS, btwMode, panelHeight, terminalColumns, terminalRows } from "./layout.ts";
import { modelLabel, outputLimit, resolveBtwModels, type BtwModelResolution } from "./model.ts";
import {
  buildBtwQuestion,
  buildBtwSystemPrompt,
  buildSummaryPrompt,
  buildSummarySystemPrompt,
  renderSideChat,
  type BtwSideMessage,
} from "./prompt.ts";
import { BtwScreen, type BtwScreenState } from "./screen.ts";
import {
  appendToDraft,
  firstQuestion,
  formatSummaryBlock,
  lastAnswer,
  parseSummary,
  shortAnswer,
  stripCitations,
  trimAnswer,
} from "./summary.ts";
import { renderTranscript, transcriptBudget, transcriptFromMessages, type BtwTranscript } from "./transcript.ts";

const STATUS_KEY = "btw";

export interface PendingBtw {
  side: BtwSideMessage[];
  model: Model<Api>;
  models: Model<Api>[];
}

/** The only side chat kept for `/btw send`; never written to disk or the session. */
let pending: PendingBtw | undefined;

/** True inside a Fabric worker, where BTW must not exist. */
export function isSubagent(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.PI_FABRIC_AGENT);
}

function notify(ctx: ExtensionContext, text: string, kind: "info" | "warning" | "error" = "info"): void {
  if (ctx.hasUI) ctx.ui.notify(text, kind);
}

function orderModels(preferred: Model<Api>, models: readonly Model<Api>[]): Model<Api>[] {
  const key = modelLabel(preferred);
  return [preferred, ...models.filter((model) => modelLabel(model) !== key)];
}

interface StreamResult {
  text: string;
  usage?: NestedUsage;
  error?: string;
}

/** One nested request. Throws only when the provider rejects the call setup. */
async function streamOnce(
  ctx: ExtensionContext,
  model: Model<Api>,
  systemPrompt: string,
  userPrompt: string,
  signal: AbortSignal,
  purpose: "answer" | "summary",
  onDelta?: (text: string) => void,
): Promise<StreamResult> {
  const sessionId = ctx.sessionManager.getSessionId();
  const headers = nestedHeaders(model, sessionId);
  const stream = ctx.modelRegistry.streamSimple(
    model,
    {
      systemPrompt,
      messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
    },
    {
      signal,
      sessionId,
      maxTokens: outputLimit(model, purpose),
      ...(headers ? { headers } : {}),
    },
  );
  return accumulateNested(stream, onDelta);
}

/** Summarize the side chat, trying the successful model first and then the rest. */
async function summarizeWithFallback(
  ctx: ExtensionContext,
  models: readonly Model<Api>[],
  side: readonly BtwSideMessage[],
): Promise<string | undefined> {
  const controller = new AbortController();
  for (const model of models) {
    try {
      const result = await streamOnce(
        ctx,
        model,
        buildSummarySystemPrompt(),
        buildSummaryPrompt(side),
        controller.signal,
        "summary",
      );
      if (result.text.trim()) return result.text.trim();
    } catch {
      // Try the next candidate; a summary is optional and has a fallback.
    }
  }
  return undefined;
}

/** Stage `BTW: <question>` plus a compact answer into the editor. */
async function stageSummary(
  ctx: ExtensionContext,
  side: readonly BtwSideMessage[],
  model: Model<Api>,
  models: readonly Model<Api>[],
): Promise<void> {
  if (!lastAnswer(side)) {
    notify(ctx, "BTW has no answer to summarize.", "warning");
    return;
  }
  if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, "BTW: summarizing…");
  try {
    let body = shortAnswer(side);
    if (!body) {
      const summary = await summarizeWithFallback(ctx, orderModels(model, models), side);
      body = summary ? parseSummary(summary).body || summary : undefined;
    }
    if (!body) body = trimAnswer(lastAnswer(side) ?? "");
    body = stripCitations(body);
    if (!body) {
      notify(ctx, "BTW could not summarize the side chat.", "warning");
      return;
    }
    const block = formatSummaryBlock(firstQuestion(side) || "Side chat", body);
    const existing = ctx.ui.getEditorText?.() ?? "";
    ctx.ui.setEditorText(appendToDraft(existing, block));
    pending = undefined;
    notify(ctx, "BTW summary staged in the editor. Review and send it as your next message.", "info");
  } finally {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  }
}

async function sendPending(ctx: ExtensionContext): Promise<void> {
  if (!pending) {
    notify(ctx, "No BTW side chat to summarize. Open /btw first.", "info");
    return;
  }
  await stageSummary(ctx, pending.side, pending.model, pending.models);
}

async function openBtw(ctx: ExtensionContext, initial?: string): Promise<void> {
  const blocks = transcriptFromMessages(ctx.sessionManager.buildSessionProjection().messages);
  if (blocks.length === 0) {
    notify(ctx, "BTW needs at least one message in this chat.", "warning");
    return;
  }

  const resolution: BtwModelResolution = resolveBtwModels({
    registry: ctx.modelRegistry,
    current: ctx.model as Model<Api> | undefined,
    override: process.env.PI_BTW_MODEL,
  });
  if (resolution.models.length === 0) {
    notify(ctx, resolution.warning ?? "BTW has no model available. Set PI_BTW_MODEL or enable a free model.", "error");
    return;
  }

  let preferred = resolution.models[0]!;
  const side: BtwSideMessage[] = [];
  const state: BtwScreenState = {
    model: modelLabel(preferred),
    messages: side,
    streaming: false,
    ...(resolution.warning ? { notice: resolution.warning } : {}),
  };

  let screen: BtwScreen | undefined;
  let abort: AbortController | undefined;
  const outcome = { value: "close" as "close" | "summary" };
  let closed = false;

  const refresh = (): void => screen?.refresh();
  const updateNotice = (transcript: BtwTranscript): void => {
    const parts = [
      resolution.warning,
      transcript.truncated ? `Transcript truncated: ${transcript.dropped} older block(s) omitted.` : undefined,
    ].filter((part): part is string => Boolean(part));
    state.notice = parts.length > 0 ? parts.join(" ") : undefined;
  };
  const budgetedTranscript = (prior: readonly BtwSideMessage[]): BtwTranscript => {
    const sideText = renderSideChat(prior);
    return renderTranscript(blocks, transcriptBudget(preferred, sideText.length + 4_000));
  };

  const ask = (question: string): void => {
    void (async () => {
      if (closed || state.streaming) return;
      pending = undefined;
      const prior = [...side];
      const transcript = budgetedTranscript(prior);
      updateNotice(transcript);
      side.push({ role: "user", text: question });
      const assistant: BtwSideMessage = { role: "assistant", text: "" };
      side.push(assistant);
      state.streaming = true;
      state.status = "thinking…";
      refresh();

      const controller = new AbortController();
      abort = controller;
      const note = transcript.truncated ? "\n\n[NOTE: the transcript was truncated to the most recent blocks.]" : "";
      const userPrompt = buildBtwQuestion({ transcript: transcript.text + note, side: prior, question });
      const candidates = orderModels(preferred, resolution.models);
      let lastError: string | undefined;

      for (const [index, candidate] of candidates.entries()) {
        if (controller.signal.aborted) return;
        assistant.text = "";
        assistant.error = undefined;
        state.model = modelLabel(candidate);
        refresh();
        try {
          const result = await streamOnce(
            ctx,
            candidate,
            buildBtwSystemPrompt(),
            userPrompt,
            controller.signal,
            "answer",
            (partial) => {
              assistant.text = partial;
              refresh();
            },
          );
          if (result.text.trim()) {
            assistant.text = result.text.trim();
            if (result.error) assistant.error = result.error;
            preferred = candidate;
            state.model = modelLabel(candidate);
            break;
          }
          lastError = result.error ?? "The model returned no text.";
          if (index === candidates.length - 1) assistant.error = lastError;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          if (index === candidates.length - 1) assistant.error = lastError;
        }
      }

      if (controller.signal.aborted) return;
      state.streaming = false;
      if (!assistant.text && !assistant.error) assistant.error = lastError ?? "No answer.";
      if (
        assistant.text.trim() &&
        !/free/i.test(preferred.id) &&
        !process.env.PI_BTW_MODEL?.trim() &&
        !resolution.warning
      ) {
        state.notice = [state.notice, `Free model unavailable; using ${modelLabel(preferred)}.`]
          .filter((part): part is string => Boolean(part))
          .join(" ");
      }
      if (assistant.error && !assistant.text) state.status = `BTW failed: ${assistant.error}`;
      else state.status = undefined;
      if (assistant.text.trim()) {
        pending = {
          side,
          model: preferred,
          models: orderModels(preferred, resolution.models),
        };
      }
      refresh();
    })();
  };

  const mode = btwMode(terminalColumns(process.stdout.columns), terminalRows(process.stdout.rows));
  const overlay = mode === "panel";
  if (!overlay) beginFullScreen();
  try {
    if (!overlay) ctx.ui.setWidget(FABRIC_AGENTS_WIDGET, undefined);
    await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
      screen = new BtwScreen({
        tui,
        theme,
        state,
        mode,
        ...(overlay ? { height: panelHeight } : {}),
        onAsk: ask,
        onSummary: () => {
          outcome.value = "summary";
          closed = true;
          abort?.abort();
          done();
        },
        onClose: () => {
          closed = true;
          abort?.abort();
          done();
        },
      });
      if (initial?.trim()) queueMicrotask(() => ask(initial.trim()));
      return screen;
    }, overlay ? { overlay: true, overlayOptions: { ...BTW_OVERLAY_OPTIONS } } : undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify(ctx, `BTW could not open: ${message}`, "error");
  } finally {
    closed = true;
    abort?.abort();
    screen = undefined;
    if (!overlay) endFullScreen();
  }

  if (outcome.value === "summary") {
    await stageSummary(ctx, side, preferred, orderModels(preferred, resolution.models));
  }
}

async function runBtw(args: string, ctx: ExtensionContext): Promise<void> {
  if (isSubagent()) {
    notify(ctx, "BTW is available only in the main chat.", "warning");
    return;
  }
  if (ctx.mode !== "tui") {
    notify(ctx, "BTW needs the interactive TUI. Run Pi in interactive mode.", "info");
    return;
  }
  const text = args.trim();
  if (!text) {
    await openBtw(ctx);
    return;
  }
  if (text === "send" || text === "summary") {
    await sendPending(ctx);
    return;
  }
  if (text === "help") {
    notify(
      ctx,
      "Usage: /btw [question] opens the side chat; alt+s stages a summary; /btw send stages the last side chat's summary; esc closes.",
      "info",
    );
    return;
  }
  await openBtw(ctx, text);
}

export default function btw(pi: ExtensionAPI) {
  if (isSubagent()) return;
  pi.on("session_shutdown", () => {
    pending = undefined;
  });
  pi.registerCommand("btw", {
    description: "Ask a side question about this chat in a full-window side chat; summary can be staged in the editor",
    handler: async (args, ctx) => {
      await runBtw(args, ctx);
    },
  });
}

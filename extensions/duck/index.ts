/**
 * `/duck` — an interactive, questions-only second opinion on the current plan,
 * via an in-process nested call (`ctx.modelRegistry.streamSimple`). No subprocess.
 *
 * The overlay opens immediately (spinner + live streaming text), scrolls with
 * arrows/j/k/PgUp/PgDn/g/G, and shows nested-call token usage in the header when
 * the stream finishes. `esc` closes it.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { buildDuckPrompt } from "./prompt.ts";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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

interface PanelState {
  text: string;
  view: "asking" | "done";
  usage?: { input?: number; output?: number };
  error?: string;
  spinner: string;
  scroll: number;
  height: number;
  total: number;
}

export function buildPanelLines(
  state: PanelState,
  width: number,
  label: string,
): string[] {
  const status =
    state.error !== undefined
      ? "error"
      : state.view === "asking"
        ? `${state.spinner} asking…`
        : `in ${state.usage?.input ?? 0} / out ${state.usage?.output ?? 0}`;
  const header = truncateToWidth(`duck · ${label} · ${status}`, width);

  const body = state.error
    ? wrapTextWithAnsi(`duck failed: ${state.error}`, width)
    : wrapTextWithAnsi(
        state.text.length > 0
          ? state.text
          : state.view === "asking"
            ? "waiting for the model…"
            : "(the model returned no questions)",
        width,
      );

  const hint = truncateToWidth("↑/↓ scroll · g/G top/bottom · esc close", width);
  const all = [header, "", ...body, "", hint];
  state.total = all.length;
  const maxScroll = Math.max(0, all.length - state.height);
  state.scroll = Math.min(state.scroll, maxScroll);
  return all.slice(state.scroll, state.scroll + state.height);
}

export default function duck(pi: ExtensionAPI) {
  pi.registerCommand("duck", {
    description: "Ask a questions-only second opinion about the current plan",
    handler: async (args, ctx) => {
      const model = ctx.model;
      if (!model) {
        ctx.ui.notify("duck: no active model", "error");
        return;
      }
      if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;

      const plan = latestAssistantText(ctx) || "(no plan in this session yet)";
      const label = `${model.provider}/${model.id}`;

      await ctx.ui.custom<void>(
        (tui, _theme, _keybindings, done) => {
          const state: PanelState = {
            text: "",
            view: "asking",
            spinner: SPINNER[0],
            scroll: 0,
            height: Math.max(6, Math.floor(tui.terminal.rows * 0.7)),
            total: 0,
          };
          const render = (): void => tui.requestRender();
          const spinner = setInterval(() => {
            if (state.view !== "asking") return;
            const index = (SPINNER.indexOf(state.spinner) + 1) % SPINNER.length;
            state.spinner = SPINNER[index];
            render();
          }, 120);

          void (async () => {
            const sessionId = ctx.sessionManager.getSessionId();
            const headers = nestedHeaders(model, sessionId);
            try {
              const stream = ctx.modelRegistry.streamSimple(
                model,
                { messages: [{ role: "user", content: buildDuckPrompt(plan, args), timestamp: Date.now() }] },
                headers ? { sessionId, headers } : { sessionId },
              );
              const result = await accumulateDuck(stream, (partial) => {
                state.text = partial;
                render();
              });
              state.usage = result.usage;
              state.error = result.error;
            } catch (error) {
              state.error = error instanceof Error ? error.message : String(error);
            } finally {
              state.view = "done";
              clearInterval(spinner);
              render();
            }
          })();

          const maxScroll = (): number => Math.max(0, state.total - state.height);
          return {
            render: (width: number): string[] => buildPanelLines(state, width, label),
            handleInput: (data: string): void => {
              if (data === "\u001b" || data === "q") {
                clearInterval(spinner);
                done();
              } else if (data === "\u001b[A" || data === "k") {
                state.scroll = Math.max(0, state.scroll - 1);
                render();
              } else if (data === "\u001b[B" || data === "j") {
                state.scroll = Math.min(maxScroll(), state.scroll + 1);
                render();
              } else if (data === "\u001b[5~") {
                state.scroll = Math.max(0, state.scroll - state.height);
                render();
              } else if (data === "\u001b[6~") {
                state.scroll = Math.min(maxScroll(), state.scroll + state.height);
                render();
              } else if (data === "g") {
                state.scroll = 0;
                render();
              } else if (data === "G") {
                state.scroll = maxScroll();
                render();
              }
            },
            invalidate: () => {},
            dispose: () => clearInterval(spinner),
          };
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: "right-center",
            width: "50%",
            minWidth: 40,
            maxHeight: "80%",
            visible: (width) => width >= 80,
          },
        },
      );
    },
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.mode === "tui" || ctx.mode === "rpc") ctx.ui.setWidget("duck", undefined);
  });
}

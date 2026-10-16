/**
 * `/duck` — an interactive, questions-only second opinion on the current plan,
 * via an in-process nested call (`ctx.modelRegistry.streamSimple`). No subprocess.
 *
 * The overlay opens immediately (spinner + live streaming text) as a themed
 * panel, scrolls with arrows/j/k/PgUp/PgDn/g/G/Home/End, follows the stream until
 * the user scrolls, and closes with `esc`/`q` or by running `/duck` again.
 *
 * Key handling goes through pi-tui's `matchesKey`, so it works on terminals that
 * negotiate the Kitty keyboard protocol as well as legacy terminals. Raw escape
 * comparisons break under Kitty CSI-u encodings and are deliberately avoided.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { renderPanel, type PanelLayout, type PanelTheme } from "../shared/panel.ts";
import { buildDuckPrompt } from "./prompt.ts";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TITLE = "duck";

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

export type DuckAction = "close" | "lineUp" | "lineDown" | "pageUp" | "pageDown" | "home" | "end";

/**
 * Map one terminal input chunk to a panel action. `matchesKey` understands both
 * legacy sequences (`\x1b[A`) and Kitty-protocol encodings (`\x1b[1;1A`,
 * `\x1b[27u`), which is what the previous raw-byte comparisons missed.
 */
export function duckKeyAction(data: string): DuckAction | undefined {
  if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") return "close";
  if (matchesKey(data, "up") || data === "k") return "lineUp";
  if (matchesKey(data, "down") || data === "j") return "lineDown";
  if (matchesKey(data, "pageUp")) return "pageUp";
  if (matchesKey(data, "pageDown")) return "pageDown";
  if (matchesKey(data, "home") || data === "g") return "home";
  if (matchesKey(data, "end") || data === "G") return "end";
  return undefined;
}

/** Body viewport height for a terminal with `terminalRows` rows. */
export function duckBodyRows(terminalRows: number): number {
  return Math.max(4, Math.min(Math.floor(terminalRows * 0.8) - 3, 24));
}

export interface DuckPanelState {
  text: string;
  view: "asking" | "done";
  usage?: { input?: number; output?: number };
  error?: string;
  spinner: string;
  scroll: number;
  /** Follow the newest output until the user scrolls away. */
  follow: boolean;
  limit: number;
}

function duckStatus(state: DuckPanelState): string {
  if (state.error !== undefined) return "error";
  if (state.view === "asking") return `${state.spinner} asking…`;
  return `in ${state.usage?.input ?? 0} / out ${state.usage?.output ?? 0}`;
}

function duckBody(state: DuckPanelState): string[] {
  if (state.error !== undefined) return [`duck failed: ${state.error}`];
  if (state.text.length > 0) return state.text.split("\n");
  return [state.view === "asking" ? "waiting for the model…" : "(the model returned no questions)"];
}

/** Compose the duck panel, including the scroll-range hint in the footer. */
export function buildDuckPanel(
  theme: PanelTheme,
  state: DuckPanelState,
  width: number,
  label: string,
): PanelLayout {
  const right = `${label} · ${duckStatus(state)}`;
  const body = duckBody(state);
  const offset = state.follow ? Number.MAX_SAFE_INTEGER : state.scroll;
  const probe = renderPanel(theme, width, { title: TITLE, right, body, offset, limit: state.limit });
  const range =
    probe.total > state.limit
      ? ` · lines ${probe.offset + 1}–${Math.min(probe.total, probe.offset + state.limit)} of ${probe.total}`
      : "";
  const footer = `↑↓ scroll · PgUp/PgDn · g/G · esc close${range}`;
  return renderPanel(theme, width, { title: TITLE, right, body, footer, offset: probe.offset, limit: state.limit });
}

let activeDuck: (() => void) | undefined;

export default function duck(pi: ExtensionAPI) {
  pi.registerCommand("duck", {
    description: "Ask a questions-only second opinion about the current plan",
    handler: async (args, ctx) => {
      // Running /duck again closes the open panel (keyboard-independent escape hatch).
      if (activeDuck) {
        activeDuck();
        return;
      }
      const model = ctx.model;
      if (!model) {
        ctx.ui.notify("duck: no active model", "error");
        return;
      }
      if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;

      const plan = latestAssistantText(ctx) || "(no plan in this session yet)";
      const label = `${model.provider}/${model.id}`;
      let closed = false;

      await ctx.ui
        .custom<void>(
          (tui, theme, _keybindings, done) => {
            const state: DuckPanelState = {
              text: "",
              view: "asking",
              spinner: SPINNER[0],
              scroll: 0,
              follow: true,
              limit: duckBodyRows(tui.terminal.rows),
            };
            const render = (): void => tui.requestRender();
            const spinner = setInterval(() => {
              if (state.view !== "asking") return;
              const index = (SPINNER.indexOf(state.spinner) + 1) % SPINNER.length;
              state.spinner = SPINNER[index];
              render();
            }, 120);
            const close = (): void => {
              if (closed) return;
              closed = true;
              clearInterval(spinner);
              done();
            };
            activeDuck = close;

            const scrollBy = (delta: number): void => {
              state.follow = false;
              state.scroll = Math.max(0, state.scroll + delta);
              render();
            };

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

            return {
              render: (width: number): string[] => {
                state.limit = duckBodyRows(tui.terminal.rows);
                const layout = buildDuckPanel(theme, state, width, label);
                state.scroll = layout.offset;
                return layout.lines;
              },
              handleInput: (data: string): void => {
                const action = duckKeyAction(data);
                if (action === undefined) return;
                if (action === "close") {
                  close();
                } else if (action === "lineUp") {
                  scrollBy(-1);
                } else if (action === "lineDown") {
                  scrollBy(1);
                } else if (action === "pageUp") {
                  scrollBy(-state.limit);
                } else if (action === "pageDown") {
                  scrollBy(state.limit);
                } else if (action === "home") {
                  state.follow = false;
                  state.scroll = 0;
                  render();
                } else if (action === "end") {
                  state.follow = true;
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
        )
        .finally(() => {
          activeDuck = undefined;
        });
    },
  });
}

/**
 * Pure rendering for the BTW side-chat screen. Keeping layout out of the
 * component makes wrapping, scrolling, and narrow-width behavior testable
 * without a terminal.
 */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { fitScreen } from "../shared/full-screen.ts";
import type { BtwSideMessage } from "./prompt.ts";
import { stripControls } from "./text.ts";

export type BtwColor =
  | "text"
  | "accent"
  | "muted"
  | "dim"
  | "success"
  | "error"
  | "warning"
  | "border"
  | "borderAccent";

export interface BtwTheme {
  fg(color: BtwColor, text: string): string;
  bold(text: string): string;
}

export interface BtwViewInput {
  model: string;
  messages: readonly BtwSideMessage[];
  streaming: boolean;
  /** Live hint such as "thinking…" or "free model unavailable". */
  status?: string;
  /** Transcript truncation or model warning; shown in the footer. */
  notice?: string;
  /** Editor lines from the screen; already width-bounded. */
  inputLines: readonly string[];
  /** Body scroll offset; clamped against the freshly computed maximum. */
  offset: number;
}

export interface BtwViewResult {
  lines: string[];
  /** Maximum body offset after this render. */
  maxOffset: number;
  bodyRows: number;
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

function bodyLines(theme: BtwTheme, messages: readonly BtwSideMessage[], streaming: boolean, width: number): string[] {
  if (messages.length === 0) {
    return [theme.fg("dim", "Ask anything about this chat. Answers use only the transcript above, nothing else.")];
  }
  const inner = Math.max(1, width - 2);
  const lines: string[] = [];
  for (const [index, message] of messages.entries()) {
    const last = index === messages.length - 1;
    const label = message.role === "user"
      ? theme.fg("accent", theme.bold("You"))
      : theme.fg("success", theme.bold("BTW"));
    const caret = streaming && last && message.role === "assistant" ? "▍" : "";
    const text = stripControls(message.text).trim() || (message.error ? "" : "…");
    const wrapped = wrapTextWithAnsi(`${text}${caret}`, inner);
    lines.push(truncateToWidth(label, width));
    for (const line of wrapped) lines.push(truncateToWidth(`  ${line}`, width));
    if (message.error) {
      for (const line of wrapTextWithAnsi(`[error: ${stripControls(message.error)}]`, inner)) {
        lines.push(truncateToWidth(`  ${theme.fg("error", line)}`, width));
      }
    }
    if (!last) lines.push("");
  }
  return lines;
}

/** Render exactly `height` lines for the side chat. */
export function renderBtwView(input: BtwViewInput, theme: BtwTheme, width: number, height: number): BtwViewResult {
  const renderWidth = Math.max(1, width);
  const renderHeight = Math.max(6, Math.floor(height));
  const inputLines = input.inputLines.length > 0 ? [...input.inputLines] : [""];
  const header = truncateToWidth(
    `${theme.fg("accent", theme.bold("◆ BTW · side chat"))} ${theme.fg("muted", `· ${input.model}`)} ${theme.fg("dim", "· grounded in this chat only")}`,
    renderWidth,
  );
  const rule = truncateToWidth(theme.fg("borderAccent", "─".repeat(renderWidth)), renderWidth);
  const separator = truncateToWidth(theme.fg("border", "─".repeat(renderWidth)), renderWidth);
  const keys = "enter ask · alt+s summary · pgup/pgdn scroll · esc close";
  const state = input.notice || input.status;
  const footer = truncateToWidth(
    state
      ? `${theme.fg("warning", state)}  ${theme.fg("dim", keys)}`
      : theme.fg("dim", keys),
    renderWidth,
  );

  const body = bodyLines(theme, input.messages, input.streaming, renderWidth);
  const bodyRows = Math.max(1, renderHeight - 2 - inputLines.length - 2);
  const maxOffset = Math.max(0, body.length - bodyRows);
  const offset = Math.min(Math.max(0, Math.floor(input.offset)), maxOffset);
  const visible = body.slice(offset, offset + bodyRows);
  while (visible.length < bodyRows) visible.push("");
  const scrollHint = maxOffset > 0 && visible.length > 0
    ? theme.fg("dim", ` ${offset + 1}-${Math.min(body.length, offset + bodyRows)}/${body.length}`)
    : "";

  const lines = [
    header,
    rule,
    ...visible,
    separator,
    ...inputLines,
    scrollHint ? pad(footer, Math.max(0, renderWidth - visibleWidth(scrollHint))) + scrollHint : footer,
  ];
  return { lines: fitScreen(lines, renderHeight, renderWidth), maxOffset, bodyRows };
}

/**
 * Pure rendering for the BTW side-chat screen. Keeping layout out of the
 * component makes wrapping, scrolling, and narrow-width behavior testable
 * without a terminal.
 *
 * Message bodies render through Pi's own `Markdown` component with the same
 * theme tokens, padding, and user-message background the main chat uses, so a
 * side-chat answer looks like (and is colored like) an answer in the chat.
 */
import { Markdown, truncateToWidth, visibleWidth, wrapTextWithAnsi, type MarkdownTheme } from "@earendil-works/pi-tui";
import { highlightCode, type ThemeBg, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { fitScreen } from "../shared/full-screen.ts";
import { renderPanel } from "../shared/panel.ts";
import type { BtwSideMessage } from "./prompt.ts";
import { stripControls } from "./text.ts";

/** Same horizontal padding the main chat gives its messages. */
const MESSAGE_PADDING_X = 1;

/** Per-theme render caches; a switched theme must not reuse another theme's ANSI. */
const markdownThemes = new WeakMap<BtwTheme, MarkdownTheme>();
const lineCaches = new WeakMap<BtwTheme, Map<string, string[]>>();
const LINE_CACHE_LIMIT = 256;

function lineCache(theme: BtwTheme): Map<string, string[]> {
  let cache = lineCaches.get(theme);
  if (!cache) {
    cache = new Map();
    lineCaches.set(theme, cache);
  }
  return cache;
}

export interface BtwTheme {
  fg(color: ThemeColor, text: string): string;
  bg(color: ThemeBg, text: string): string;
  bold(text: string): string;
  italic?(text: string): string;
  underline?(text: string): string;
  strikethrough?(text: string): string;
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

/** The exact markdown token map the interactive chat uses, plus syntax highlighting. */
function markdownTheme(theme: BtwTheme): MarkdownTheme {
  const cached = markdownThemes.get(theme);
  if (cached) return cached;
  const identity = (text: string): string => text;
  const created: MarkdownTheme = {
    heading: (text) => theme.fg("mdHeading", text),
    link: (text) => theme.fg("mdLink", text),
    linkUrl: (text) => theme.fg("mdLinkUrl", text),
    code: (text) => theme.fg("mdCode", text),
    codeBlock: (text) => theme.fg("mdCodeBlock", text),
    codeBlockBorder: (text) => theme.fg("mdCodeBlockBorder", text),
    quote: (text) => theme.fg("mdQuote", text),
    quoteBorder: (text) => theme.fg("mdQuoteBorder", text),
    hr: (text) => theme.fg("mdHr", text),
    listBullet: (text) => theme.fg("mdListBullet", text),
    bold: (text) => theme.bold(text),
    italic: theme.italic ?? identity,
    underline: theme.underline ?? identity,
    strikethrough: theme.strikethrough ?? identity,
    // Pi's highlighter is bound to the interactive theme singleton, which only
    // exists inside the TUI. Outside it (tests, non-TUI hosts) show plain code.
    highlightCode: (code, lang) => {
      try {
        return highlightCode(code, lang);
      } catch {
        return code.split("\n");
      }
    },
  };
  markdownThemes.set(theme, created);
  return created;
}

/** One side-chat message, rendered like its counterpart in the main chat. */
function messageLines(
  theme: BtwTheme,
  message: BtwSideMessage,
  caret: string,
  width: number,
  cacheable: boolean,
): string[] {
  const user = message.role === "user";
  const text = stripControls(message.text).trim() || (message.error ? "" : "…");
  const error = message.error ? stripControls(message.error) : "";
  // The screen re-renders on every keystroke and stream delta. Finished messages
  // are reused; the in-flight answer changes with every delta, so caching it would
  // only churn the LRU with hundreds of partial renders.
  const cache = cacheable ? lineCache(theme) : undefined;
  const key = `${width}\u0000${message.role}\u0000${caret.length}\u0000${text}\u0000${error}`;
  const cached = cache?.get(key);
  if (cached) return cached;
  const markdown = new Markdown(
    `${text}${caret}`,
    MESSAGE_PADDING_X,
    // The main chat gives user messages a padded background block and lets the
    // assistant text sit directly on the page with a leading spacer instead.
    user ? 1 : 0,
    markdownTheme(theme),
    user
      ? { color: (value) => theme.fg("userMessageText", value), bgColor: (value) => theme.bg("userMessageBg", value) }
      : undefined,
    user ? { preserveOrderedListMarkers: true, preserveBackslashEscapes: true } : undefined,
  );
  const limit = Math.max(1, width);
  const lines = markdown.render(limit).map((line) => truncateToWidth(line, limit));
  if (error) {
    const wrapped = wrapTextWithAnsi(`[error: ${error}]`, Math.max(1, limit - 1));
    lines.push(...wrapped.map((line) => truncateToWidth(theme.fg("error", line), limit)));
  }
  if (cache) {
    if (cache.size >= LINE_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, lines);
  }
  return lines;
}

function bodyLines(theme: BtwTheme, messages: readonly BtwSideMessage[], streaming: boolean, width: number): string[] {
  if (messages.length === 0) {
    return [theme.fg("dim", "Ask anything about this chat. Answers use only the transcript above, nothing else.")];
  }
  const lines: string[] = [];
  for (const [index, message] of messages.entries()) {
    const last = index === messages.length - 1;
    const active = streaming && last && message.role === "assistant";
    const caret = active ? "▍" : "";
    // The main chat separates an assistant block from what came before with a spacer.
    if (message.role === "assistant") lines.push("");
    lines.push(...messageLines(theme, message, caret, width, !active));
  }
  return lines;
}

/**
 * Render the docked side panel: the shared framed/background panel with the
 * transcript window and a fixed editor at the bottom. Every line is exactly
 * `width` columns and there are exactly `height` rows.
 */
export function renderBtwPanel(input: BtwViewInput, theme: BtwTheme, width: number, height: number): BtwViewResult {
  const renderWidth = Math.max(1, width);
  const renderHeight = Math.max(8, Math.floor(height));
  // Two frame borders plus the single leading space `renderPanel` adds per row.
  const contentWidth = Math.max(1, renderWidth - 3);
  // Top border + body + footer rule + footer + bottom border.
  const bodyRows = Math.max(1, renderHeight - 4);
  let inputLines = input.inputLines.length > 0 ? [...input.inputLines] : [""];
  // Keep at least one transcript row and the blank separator on tiny panels.
  const maxInput = Math.max(1, bodyRows - 2);
  if (inputLines.length > maxInput) inputLines = inputLines.slice(-maxInput);
  const transcriptRows = Math.max(1, bodyRows - inputLines.length - 1);

  const transcript = bodyLines(theme, input.messages, input.streaming, contentWidth);
  const maxOffset = Math.max(0, transcript.length - transcriptRows);
  const offset = Math.min(Math.max(0, Math.floor(input.offset)), maxOffset);
  const visible = transcript.slice(offset, offset + transcriptRows);
  while (visible.length < transcriptRows) visible.push("");
  const body = [...visible, "", ...inputLines];
  while (body.length < bodyRows) body.push("");

  const keys = "enter ask · alt+s summary · wheel/pgup scroll · esc close";
  const state = input.notice || input.status;
  const scrollHint = maxOffset > 0
    ? theme.fg("dim", ` ${offset + 1}-${Math.min(transcript.length, offset + transcriptRows)}/${transcript.length}`)
    : "";
  const hintWidth = visibleWidth(scrollHint);
  const label = truncateToWidth(state ? `${state}  ${keys}` : keys, Math.max(0, contentWidth - hintWidth));
  const footer = scrollHint ? pad(label, Math.max(0, contentWidth - hintWidth)) + scrollHint : label;
  const panel = renderPanel(theme, renderWidth, {
    title: "◆ BTW · side chat",
    right: input.model,
    body: body.slice(0, bodyRows),
    footer,
    limit: bodyRows,
  });
  return { lines: panel.lines, maxOffset, bodyRows: transcriptRows };
}

/** Render exactly `height` lines for the narrow, full-width overlay. */
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
  const keys = "enter ask · alt+s summary · wheel/pgup scroll · esc close";
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

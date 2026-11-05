/**
 * Standalone Pi Fabric TUI surfaces.
 *
 * Integration: construct these with the `theme` received from a Pi UI callback.
 * After `handleInput`, call `tui.requestRender()` (or pass `onChange`) so the
 * terminal is repainted. Every renderer bounds output to the supplied width.
 */
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui";
import { clean } from "./activity.ts";
import { agentBand, paintAgent, renderAgentRow, type AgentRow, type AgentRowStatus } from "./agents.ts";
export type { AgentRow, AgentRowStatus } from "./agents.ts";

export type FabricAgentStatus = "queued" | "running" | "waiting" | "done" | "error" | "cancelled";

/** The small theme contract makes these usable from extensions and tool renderers. */
export interface FabricTheme {
  fg(color: "text" | "accent" | "muted" | "dim" | "success" | "error" | "warning" | "border" | "borderAccent", text: string): string;
  bold(text: string): string;
  /** Present on Pi's real theme; lets agents carry generated colours rather than theme tokens. */
  style?(text: string, style: { fg?: unknown; bg?: unknown; bold?: boolean }): string;
  /** Dark or light, used to pick a readable lightness for generated agent colours. */
  appearance?: "dark" | "light";
}

/** A serialisable agent row shared by all three surfaces. */
export interface FabricAgentView {
  id: string;
  label: string;
  model: string;
  status: FabricAgentStatus;
  task?: string;
  parentId?: string;
  startedAt?: string;
  finishedAt?: string;
  result?: string;
  patch?: string;
  error?: string;
  activity?: string;
  events?: string;
  tools?: string;
  resultPath?: string;
  patchPath?: string;
  /** Folded session usage; the cards show cost, tokens and the last tool. */
  cost?: number;
  tokens?: number;
  lastTool?: string;
  /** Saved Pi session file for this run; the full transcript is replayed from it. */
  sessionPath?: string;
}

const statusIcon: Record<FabricAgentStatus, string> = {
  queued: "○", running: "●", waiting: "◌", done: "✓", error: "×", cancelled: "×",
};
const statusColor: Record<FabricAgentStatus, "success" | "error" | "warning" | "accent" | "muted"> = {
  queued: "warning", running: "accent", waiting: "warning", done: "success", error: "error", cancelled: "error",
};
const short = (id: string) => id.slice(0, 6);
const terminal = (status: FabricAgentStatus) => status === "done" || status === "error" || status === "cancelled";

function countSummary(agents: readonly FabricAgentView[]): string {
  const count = (status: FabricAgentStatus) => agents.filter((agent) => agent.status === status).length;
  return `${count("running")} running · ${count("waiting")} waiting · ${count("queued")} queued · ${count("done")} done · ${count("error") + count("cancelled")} stopped`;
}
function plainPad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}
function boundedLines(text: string | undefined, width: number, maxLines: number): string[] {
  if (!text || width < 1 || maxLines < 1) return [];
  const lines = wrapTextWithAnsi(text.replace(/\s+/g, " ").trim(), width);
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), truncateToWidth(lines[maxLines - 1] ?? "", width, "…")];
}

/** A tool result being compared; content is optional and bounded when displayed. */
export interface ComparisonResult {
  label: string;
  status?: "success" | "error" | "warning" | "neutral";
  summary: string;
  details?: string;
  metrics?: Readonly<Record<string, string | number>>;
}
export interface ComparisonCardData {
  title?: string;
  left: ComparisonResult;
  /** Omit to render one full-width card instead of a pair with a placeholder. */
  right?: ComparisonResult;
  /** Switch to stacked cards below this many columns. Default: 76. */
  sideBySideAt?: number;
  /** Total body lines per card (not counting title/border). Default: 7. */
  maxBodyLines?: number;
}

function resultColor(result: ComparisonResult): "success" | "error" | "warning" | "muted" {
  return result.status === "success" ? "success" : result.status === "error" ? "error" : result.status === "warning" ? "warning" : "muted";
}
function renderResultCard(result: ComparisonResult, theme: FabricTheme, width: number, maxBodyLines: number): string[] {
  const inner = Math.max(1, width - 2);
  const title = theme.fg(resultColor(result), theme.bold(result.label));
  const body = boundedLines(result.summary, inner, Math.max(1, maxBodyLines - 1));
  const metricText = Object.entries(result.metrics ?? {}).map(([key, value]) => `${key}: ${value}`).join(" · ");
  const details = boundedLines(result.details, inner, Math.max(0, maxBodyLines - body.length - (metricText ? 1 : 0)));
  const contents = [title, ...body, ...(metricText ? [theme.fg("dim", truncateToWidth(metricText, inner))] : []), ...details].slice(0, maxBodyLines);
  const border = theme.fg("border", "─".repeat(inner));
  return [theme.fg("border", `┌${"─".repeat(inner)}┐`), ...contents.map((line) => theme.fg("border", "│") + plainPad(truncateToWidth(line, inner), inner) + theme.fg("border", "│")), theme.fg("border", `└${"─".repeat(inner)}┘`)];
}

/**
 * A responsive comparison card. At narrow widths it renders two bounded cards
 * vertically; otherwise the cards share a row. Suitable for `renderResult`.
 */
export function renderComparisonResultCard(data: ComparisonCardData, theme: FabricTheme, width: number): string[] {
  if (width < 1) return [];
  const title = data.title ? [truncateToWidth(theme.fg("accent", theme.bold(data.title)), width)] : [];
  const maxBody = Math.max(1, data.maxBodyLines ?? 7);
  // A single result is one card at full width: never a placeholder card beside it.
  if (!data.right) return [...title, ...renderResultCard(data.left, theme, width, maxBody)].map(line => truncateToWidth(line, width));
  const sideBySide = width >= (data.sideBySideAt ?? 76);
  if (!sideBySide) return [...title, ...renderResultCard(data.left, theme, width, maxBody), ...renderResultCard(data.right, theme, width, maxBody)].map(line => truncateToWidth(line, width));
  const gap = 2;
  const cardWidth = Math.max(3, Math.floor((width - gap) / 2));
  const left = renderResultCard(data.left, theme, cardWidth, maxBody);
  const right = renderResultCard(data.right, theme, cardWidth, maxBody);
  return [...title, ...left.map((line, index) => truncateToWidth(plainPad(line, cardWidth) + " ".repeat(gap) + (right[index] ?? ""), width))];
}

/* ---------- full-run transcript ---------- */

/**
 * One replayable block of a saved Pi session. A single JSONL line can produce
 * several entries (an assistant message may hold text, thinking, and tool calls).
 */
export type TranscriptEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "toolCall"; name: string; args: string }
  | { kind: "toolResult"; name: string; text: string; isError: boolean }
  | { kind: "note"; text: string };

/** What a viewer reloads: session JSONL plus an optional banner (truncation, read error). */
export interface TranscriptSource {
  text: string;
  notice?: string;
  /**
   * Byte offset in the file where `text` ends. Live tailing resumes from here,
   * so a head-trimmed transcript keeps following instead of re-reading the file.
   */
  offset?: number;
  /** False when the file could not be read, so live tailing should not start. */
  live?: boolean;
}

/** Per-block caps keep one huge tool result from crowding out the run. */
export const TRANSCRIPT_TEXT_LIMIT = 8000;
export const TRANSCRIPT_ARGS_LIMIT = 400;

/** Strips terminal escapes without the short default cap `clean` applies. */
function stripControls(value: string): string { return clean(value, Number.POSITIVE_INFINITY); }
function boundedText(value: string, limit = TRANSCRIPT_TEXT_LIMIT): string {
  const text = stripControls(value).replace(/\r\n/g, "\n").trimEnd();
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… truncated ${text.length - limit} characters`;
}
function argText(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value ?? {}) ?? ""; } catch { return ""; }
}
function partsOf(message: { content?: unknown }): unknown[] {
  if (typeof message.content === "string") return [{ type: "text", text: message.content }];
  return Array.isArray(message.content) ? message.content : [];
}
function blockText(parts: readonly unknown[]): string {
  return parts
    .map((part) => {
      const block = part as { type?: string; text?: string; mimeType?: string };
      if (block?.type === "text") return block.text ?? "";
      if (block?.type === "image") return `[image ${block.mimeType ?? "attached"}]`;
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

/**
 * Parses one session JSONL line into display blocks. Terminal control sequences
 * are stripped, block sizes are bounded, and unrecognised lines yield nothing so
 * a corrupt or truncated file still replays everything around it.
 */
export function parseSessionLine(line: string): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let entry: Record<string, unknown>;
  try { entry = JSON.parse(trimmed) as Record<string, unknown>; }
  catch { return []; }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];

  const type = entry.type;
  if (type === "model_change") return [{ kind: "note", text: `model → ${[entry.provider, entry.modelId].filter(Boolean).join("/")}` }];
  if (type === "thinking_level_change") return [{ kind: "note", text: `thinking → ${String(entry.thinkingLevel ?? "default")}` }];
  if (type === "branch_summary" && typeof entry.summary === "string") return [{ kind: "note", text: `branch summary: ${boundedText(entry.summary)}` }];
  if (type !== "message") return [];

  const message = entry.message as { role?: unknown; content?: unknown; toolName?: unknown; isError?: unknown } | undefined;
  if (!message || typeof message !== "object") return [];
  const parts = partsOf(message);
  const entries: TranscriptEntry[] = [];

  if (message.role === "user") {
    for (const part of parts) {
      const block = part as { type?: string; text?: string; mimeType?: string };
      if (block?.type === "image") entries.push({ kind: "note", text: `[image ${block.mimeType ?? "attached"}]` });
      else if (block?.type === "text" && block.text?.trim()) entries.push({ kind: "user", text: boundedText(block.text) });
    }
    return entries;
  }
  if (message.role === "assistant") {
    for (const part of parts) {
      const block = part as { type?: string; text?: string; thinking?: string; name?: string; arguments?: unknown };
      if (block?.type === "text" && block.text?.trim()) entries.push({ kind: "assistant", text: boundedText(block.text) });
      else if (block?.type === "thinking" && block.thinking?.trim()) entries.push({ kind: "thinking", text: boundedText(block.thinking) });
      else if (block?.type === "toolCall") entries.push({ kind: "toolCall", name: String(block.name ?? "tool"), args: boundedText(argText(block.arguments).replace(/\s+/g, " "), TRANSCRIPT_ARGS_LIMIT) });
    }
    return entries;
  }
  if (message.role === "toolResult") {
    const text = boundedText(blockText(parts));
    return [{ kind: "toolResult", name: String(message.toolName ?? "tool"), text: text || "(no output)", isError: message.isError === true }];
  }
  // System prompts and custom extension messages stay out of the replayed run.
  return entries;
}

/** Parses a whole session file body (JSONL) in order. */
export function parseSessionText(text: string): TranscriptEntry[] {
  return text.split("\n").flatMap(parseSessionLine);
}

/**
 * A replayable transcript as Markdown, for handing the run to an editor. Tool
 * arguments go in an indented block so a fence inside them cannot break the file.
 */
export function transcriptMarkdown(label: string, meta: string, entries: readonly TranscriptEntry[]): string {
  const lines: string[] = [`# ${label}`, meta ? `_${meta}_` : "", ""];
  for (const entry of entries) {
    switch (entry.kind) {
      case "user": lines.push("## You", "", entry.text, ""); break;
      case "assistant": lines.push("## Assistant", "", entry.text, ""); break;
      case "thinking": lines.push("### Thinking", "", entry.text, ""); break;
      case "toolCall": lines.push(`### \u2699 ${entry.name}`, "", ...entry.args.split("\n").map((line) => `    ${line}`), ""); break;
      case "toolResult": lines.push(`### ${entry.isError ? "\u2717" : "\u2713"} ${entry.name}`, "", entry.text, ""); break;
      case "note": lines.push(`> ${entry.text}`, ""); break;
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Message header labels; `band` paints them in the owning agent's hue. */
function describeEntry(entry: TranscriptEntry, theme: FabricTheme, band?: (text: string) => string): { label: string; body: string } {
  const paint = band ?? ((text: string) => text);
  switch (entry.kind) {
    case "user": return { label: theme.fg("accent", theme.bold("You")), body: entry.text };
    case "assistant": return { label: paint(theme.bold("Assistant")), body: entry.text };
    case "thinking": return { label: paint("thinking"), body: entry.text };
    case "toolCall": return { label: paint(`⚙ ${entry.name}`), body: entry.args };
    case "toolResult": return { label: paint(`${entry.isError ? "✗" : "✓"} ${entry.name}`), body: entry.text };
    case "note": return { label: theme.fg("dim", "·"), body: entry.text };
  }
}

/* ---------- transcript panes ---------- */

/** What one column of the transcript screen needs to know about its agent. */
export interface TranscriptPaneSpec {
  id: string;
  label: string;
  model: string;
  status: AgentRowStatus;
  hue: number;
  /** The coordinator chat, painted with the theme accent rather than a generated hue. */
  main?: boolean;
  /** Saved session file this pane replays. */
  path?: string;
  /** Folded usage (`$0.04 · 128k · read`) shown in the header. */
  usage?: string;
  /** Initial load; live updates arrive through the overlay's `appendText`. */
  read?: () => TranscriptSource;
}

export interface TranscriptPaneOptions {
  theme: FabricTheme;
  spec: TranscriptPaneSpec;
  /** Body rows before `setHeight` is called. Default: 20. */
  maxRows?: number;
}

/**
 * One agent's conversation as a column: a hue-tinted header, a rule, and the
 * replayed session body. Parsing, incremental append, scrolling and width safety
 * live here; the overlay arranges one or two of these side by side.
 */
/** Rendered lines per transcript block, wrapped for one width and appended incrementally. */
/** Which blocks a reader wants to see; toggling either one re-wraps the body. */
export interface TranscriptFilters {
  showThinking: boolean;
  collapseResults: boolean;
}

export const DEFAULT_TRANSCRIPT_FILTERS: TranscriptFilters = { showThinking: true, collapseResults: false };

interface WrapBlock {
  lines: string[];
  /** A failed tool result: `e` jumps between these. */
  error: boolean;
}

interface WrapCache {
  width: number;
  showThinking: boolean;
  collapseResults: boolean;
  /** Source entries already wrapped (thinking may be skipped, so this is not `blocks.length`). */
  entries: number;
  blocks: WrapBlock[];
  /** `blocks` joined with a blank line between them. */
  flat: string[];
  /** Flat line index where each failed block starts. */
  errors: number[];
}

export class TranscriptPane {
  private readonly theme: FabricTheme;
  private readonly spec: TranscriptPaneSpec;
  private source: TranscriptSource = { text: "" };
  private entries: TranscriptEntry[] = [];
  /** Index in `source.text` after the last parsed complete line. */
  private parsedChars = 0;
  private wrap?: WrapCache;
  private offset = 0;
  private maxOffset = 0;
  private maxRows: number;
  /** Following pins the view to the newest lines; scrolling up turns it off. */
  private following = true;
  /** Entries that arrived while paused, counted for the header tag. */
  private pending = 0;
  /** Full re-wraps (width or filters changed); appends reuse the cache, so this stays low. */
  private rebuilds = 0;
  private filters: TranscriptFilters = { ...DEFAULT_TRANSCRIPT_FILTERS };
  /** Width of the last render, so search can lay the body out before painting it. */
  private lastWidth = 80;

  constructor(options: TranscriptPaneOptions) {
    this.theme = options.theme;
    this.spec = options.spec;
    this.maxRows = Math.max(3, options.maxRows ?? 20);
    if (this.spec.read) this.setSource(this.spec.read());
  }
  private band(): ((text: string) => string) | undefined {
    const band = this.theme.style ? agentBand(this.theme, this.spec.hue) : undefined;
    return band && this.theme.style
      ? (text: string) => this.theme.style!(text, { fg: band.fg, bg: band.bg })
      : undefined;
  }
  get id(): string { return this.spec.id; }
  get label(): string { return this.spec.label; }
  get hue(): number { return this.spec.hue; }
  /** Saved session file this pane replays, if any. */
  get path(): string | undefined { return this.spec.path; }
  get filterState(): TranscriptFilters { return { ...this.filters }; }
  /** `t`: hide or show thinking blocks. Returns the new state. */
  toggleThinking(): boolean {
    this.filters = { ...this.filters, showThinking: !this.filters.showThinking };
    this.wrap = undefined;
    return this.filters.showThinking;
  }
  /** `r`: collapse each tool result to one line. Returns the new state. */
  toggleResults(): boolean {
    this.filters = { ...this.filters, collapseResults: !this.filters.collapseResults };
    this.wrap = undefined;
    return this.filters.collapseResults;
  }
  /** Flat body line indices whose text contains `query`, case-insensitively. */
  findMatches(query: string): number[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return this.bodyLines(this.lastWidth)
      .map((line, index) => (line.toLowerCase().includes(needle) ? index : -1))
      .filter((index) => index >= 0);
  }
  /** Flat body line indices of failed tool results, for `e`. */
  errorLines(): number[] {
    this.bodyLines(this.lastWidth);
    return [...(this.wrap?.errors ?? [])];
  }
  /** Moves the view to a flat body line and pauses following. */
  jumpToLine(line: number): void {
    this.following = false;
    this.offset = Math.max(0, line);
  }
  /** The whole run as Markdown, independent of the current scroll position or width. */
  markdown(): string {
    return transcriptMarkdown(this.spec.label, [this.spec.model, this.spec.status].filter(Boolean).join(" \u00b7 "), this.entries);
  }
  invalidate(): void { this.wrap = undefined; }
  /** Sizes the body so header + rule + body fills `height` lines exactly. */
  setHeight(height: number): void { this.maxRows = Math.max(3, Math.floor(height) - 2); }
  setSource(source: TranscriptSource): void {
    this.source = source;
    // Only complete lines are parsed; a half-written trailing line waits for its newline.
    const lastNewline = source.text.lastIndexOf("\n");
    this.parsedChars = lastNewline + 1;
    this.entries = parseSessionText(source.text.slice(0, this.parsedChars));
    this.wrap = undefined;
    this.maxOffset = 0;
    // A transcript opens at the end: the newest lines are what the human came for.
    this.following = true;
    this.pending = 0;
    this.offset = Number.MAX_SAFE_INTEGER;
  }
  /** Parses only newly written lines, so following a live run does not re-read the file. */
  appendText(chunk: string): boolean {
    if (!chunk) return false;
    this.source = { ...this.source, text: this.source.text + chunk };
    const end = this.source.text.lastIndexOf("\n");
    if (end < this.parsedChars) return false;
    const fresh = this.source.text.slice(this.parsedChars, end).split("\n").flatMap(parseSessionLine);
    this.parsedChars = end + 1;
    if (!fresh.length) return false;
    this.entries = [...this.entries, ...fresh];
    if (!this.following) this.pending += fresh.length;
    return true;
  }
  /** Handles the scroll keys; returns true when the view moved. */
  scroll(input: string): boolean {
    const page = Math.max(1, this.maxRows - 2);
    const before = this.resolvedOffset();
    // `f` and End resume following; the sentinel is resolved by the next render.
    if (matchesKey(input, Key.end) || input === "G" || input === "f") {
      const wasFollowing = this.following;
      this.following = true;
      this.pending = 0;
      this.offset = Number.MAX_SAFE_INTEGER;
      return !wasFollowing || before !== this.maxOffset;
    }
    if (matchesKey(input, Key.home) || input === "g") {
      this.following = false;
      this.offset = 0;
      return before !== 0;
    }
    // While following, the view is pinned to the end; scrolling starts from there.
    if (this.following) this.offset = this.maxOffset;
    let next = this.offset;
    if (matchesKey(input, Key.pageDown) || input === " " || input === "j") next += page;
    else if (matchesKey(input, Key.pageUp) || input === "k") next -= page;
    else if (matchesKey(input, Key.down)) next += 1;
    else if (matchesKey(input, Key.up)) next -= 1;
    else return false;
    next = Math.min(Math.max(0, next), this.maxOffset);
    // Scrolling back down to the bottom resumes following, so nothing is missed.
    this.following = next >= this.maxOffset;
    if (this.following) this.pending = 0;
    this.offset = next;
    return before !== this.resolvedOffset();
  }
  /** The sentinel and the follow pin both resolve to the current end. */
  private resolvedOffset(): number {
    return this.following || this.offset === Number.MAX_SAFE_INTEGER ? this.maxOffset : this.offset;
  }
  getState(): { offset: number; maxOffset: number; entries: number; rows: number; following: boolean; pending: number; rebuilds: number } {
    return { offset: this.resolvedOffset(), maxOffset: this.maxOffset, entries: this.entries.length, rows: this.maxRows, following: this.following, pending: this.pending, rebuilds: this.rebuilds };
  }
  /** The visible body rows only, for a host that draws its own frame (the peek panel). */
  visibleRows(width: number, rows: number): string[] {
    const body = this.bodyLines(width);
    this.lastWidth = Math.max(1, width);
    const max = Math.max(0, body.length - Math.max(1, rows));
    this.maxOffset = max;
    this.offset = this.following ? max : Math.min(Math.max(0, this.offset), max);
    const start = this.resolvedOffset();
    return body.slice(start, start + Math.max(1, rows));
  }
  /** Header, rule and body, padded to exactly `height` lines. */
  render(width: number, height: number, focused = false): string[] {
    if (width < 1) return [];
    const rows = Math.max(1, height - 2);
    const body = this.bodyLines(width);
    this.lastWidth = width;
    const max = Math.max(0, body.length - rows);
    this.maxOffset = max;
    this.offset = this.following ? max : Math.min(Math.max(0, this.offset), max);
    const name = this.spec.main ? this.theme.fg("accent", this.theme.bold(this.spec.label)) : paintAgent(this.theme, this.spec.hue, this.spec.label);
    const meta = [this.spec.model, this.spec.status, this.spec.usage].filter(Boolean).join(" · ");
    // A read error or head trim is explained on the header; otherwise a paused
    // view counts what arrived while the human was reading.
    const tag = this.source.notice
      ? this.theme.fg("dim", `· ${this.source.notice}`)
      : this.following ? undefined
      : this.pending > 0 ? this.theme.fg("warning", `+${this.pending} new`) : this.theme.fg("warning", "paused");
    const cursor = focused ? this.theme.fg("accent", "› ") : "";
    const header = truncateToWidth(`${cursor}${name} ${this.theme.fg("muted", `· ${meta}`)}${tag ? ` · ${tag}` : ""}`, width);
    const tint = this.spec.main ? this.theme.fg("borderAccent", "─".repeat(Math.max(1, width))) : paintAgent(this.theme, this.spec.hue, "─".repeat(Math.max(1, width)));
    const rule = truncateToWidth(tint, width);
    const visible = body.slice(this.resolvedOffset(), this.resolvedOffset() + rows);
    const lines = [header, rule, ...visible];
    while (lines.length < height) lines.push("");
    return lines.slice(0, Math.max(1, height)).map((line) => truncateToWidth(line, width));
  }
  /**
   * Wrapped body lines. Blocks are cached per width and only the entries parsed
   * since the last render are wrapped, so a live run appends instead of re-wrapping
   * the whole transcript every second.
   */
  private bodyLines(width: number): string[] {
    this.lastWidth = Math.max(1, width);
    const matches = this.wrap?.width === width
      && this.wrap.showThinking === this.filters.showThinking
      && this.wrap.collapseResults === this.filters.collapseResults;
    let current: WrapCache;
    if (matches) current = this.wrap!;
    else {
      current = { width, showThinking: this.filters.showThinking, collapseResults: this.filters.collapseResults, entries: 0, blocks: [], flat: [], errors: [] };
      this.wrap = current;
      this.rebuilds += 1;
    }
    const inner = Math.max(1, width - 2);
    const paint = this.band();
    for (let index = current.entries; index < this.entries.length; index++) {
      const entry = this.entries[index]!;
      const block = this.wrapEntry(entry, width, inner, paint);
      if (block) {
        if (current.flat.length) current.flat.push("");
        if (block.error) current.errors.push(current.flat.length);
        current.flat.push(...block.lines);
        current.blocks.push(block);
      }
    }
    current.entries = this.entries.length;
    return current.flat;
  }
  /** One entry as a block, honouring the filters; undefined means "hidden". */
  private wrapEntry(entry: TranscriptEntry, width: number, inner: number, paint: ((text: string) => string) | undefined): WrapBlock | undefined {
    if (entry.kind === "thinking" && !this.filters.showThinking) return undefined;
    const described = describeEntry(entry, this.theme, paint);
    let body = described.body;
    if (entry.kind === "toolResult" && this.filters.collapseResults) {
      const rows = body.split("\n");
      if (rows.length > 1) body = `${rows[0]} (+${rows.length - 1} line${rows.length === 2 ? "" : "s"})`;
    }
    const lines = [truncateToWidth(described.label, width)];
    for (const raw of body.split("\n")) {
      for (const wrapped of wrapTextWithAnsi(raw || " ", inner)) lines.push(truncateToWidth(`  ${wrapped}`, width));
    }
    return { lines, error: entry.kind === "toolResult" && entry.isError };
  }
}

/* ---------- agent transcript screen ---------- */

/** Below this width two columns cannot both stay readable. */
export const MIN_TWO_COLUMN_WIDTH = 80;

export interface AgentTranscriptOptions {
  theme: FabricTheme;
  specs: readonly TranscriptPaneSpec[];
  onClose?: () => void;
  /** `o`: the caller writes a Markdown copy and opens it in the editor. */
  onOpen?: (pane: TranscriptPane) => void;
  /** `y`: the caller copies the raw session file path. */
  onCopy?: (pane: TranscriptPane) => void;
}

/**
 * The full-window transcript screen: one agent, or two side by side (a comparison
 * group). Each column keeps its own parser, scroll position and hue. Keys: tab
 * switches focus, `s` toggles one/two columns, page keys scroll the focused
 * column, esc steps back; `o` and `y` hand the focused run to the caller.
 * Reading keys: `/` searches incrementally, `n`/`N` walk matches, `t` hides
 * thinking, `r` collapses tool results, `e` jumps to the next failure.
 */
export class AgentTranscriptOverlay implements Component {
  private readonly theme: FabricTheme;
  private readonly panes: TranscriptPane[];
  private readonly onClose?: () => void;
  private readonly onOpen?: (pane: TranscriptPane) => void;
  private readonly onCopy?: (pane: TranscriptPane) => void;
  private columns: 1 | 2;
  private focus = 0;
  private height = 24;
  /** Search state: the query is kept after Enter so `n`/`N` can walk it. */
  private query = "";
  private searching = false;
  /** Index of the match the view sits on, for `n`/`N`. */
  private matchIndex = -1;

  constructor(options: AgentTranscriptOptions) {
    this.theme = options.theme;
    this.onClose = options.onClose;
    this.onOpen = options.onOpen;
    this.onCopy = options.onCopy;
    this.panes = options.specs.slice(0, 2).map((spec) => new TranscriptPane({ theme: options.theme, spec }));
    this.columns = this.panes.length > 1 ? 2 : 1;
  }
  /** All panes, including any not currently visible because the pair is capped at two. */
  get allPanes(): readonly TranscriptPane[] { return this.panes; }
  paneAt(index: number): TranscriptPane | undefined { return this.panes[index]; }
  setFocus(index: number): void { this.focus = Math.min(Math.max(0, index), Math.max(0, this.panes.length - 1)); }
  setHeight(rows: number): void { this.height = Math.max(6, Math.floor(rows)); }
  invalidate(): void { for (const pane of this.panes) pane.invalidate(); }
  /** Feeds live bytes to a pane by agent id; returns true when anything new parsed. */
  appendText(id: string, chunk: string): boolean {
    const pane = this.panes.find((item) => item.id === id);
    return pane ? pane.appendText(chunk) : false;
  }
  setSource(id: string, source: TranscriptSource): void {
    this.panes.find((item) => item.id === id)?.setSource(source);
  }
  private effectiveColumns(width: number): 1 | 2 {
    return this.columns === 2 && this.panes.length > 1 && width >= MIN_TWO_COLUMN_WIDTH ? 2 : 1;
  }
  handleInput(input: string): void {
    const focused = this.panes[this.focus];
    if (this.searching) {
      if (matchesKey(input, Key.escape)) { this.searching = false; this.query = ""; this.matchIndex = -1; return; }
      if (matchesKey(input, Key.enter)) { this.searching = false; return; }
      if (matchesKey(input, Key.backspace)) this.query = this.query.slice(0, -1);
      else if (input.length === 1 && input >= " ") this.query += input;
      else return;
      // Incremental: every keystroke jumps to the first match after the last one.
      this.jump(1, true);
      return;
    }
    if (matchesKey(input, Key.escape)) {
      // Esc clears a search first, so a reader does not lose the run by accident.
      if (this.query) { this.query = ""; this.matchIndex = -1; return; }
      this.onClose?.();
      return;
    }
    if (input === "/") { this.searching = true; this.query = ""; this.matchIndex = -1; return; }
    if (input === "n" || input === "N") { if (this.query) this.jump(input === "n" ? 1 : -1, false); return; }
    if (input === "t") { focused?.toggleThinking(); return; }
    if (input === "r") { focused?.toggleResults(); return; }
    if (input === "e") { this.jumpError(); return; }
    if (input === "s" && this.panes.length > 1) { this.columns = this.columns === 2 ? 1 : 2; return; }
    if (matchesKey(input, Key.tab) && this.panes.length > 1) { this.focus = (this.focus + 1) % this.panes.length; return; }
    if (input === "o") { if (focused) this.onOpen?.(focused); return; }
    if (input === "y") { if (focused) this.onCopy?.(focused); return; }
    if (focused) focused.scroll(input);
  }
  /** Walks the focused pane's matches; `fromStart` ignores the current index (typing). */
  private jump(direction: 1 | -1, fromStart: boolean): void {
    const pane = this.panes[this.focus];
    if (!pane) return;
    const matches = pane.findMatches(this.query);
    if (!matches.length) { this.matchIndex = -1; return; }
    if (fromStart) this.matchIndex = direction > 0 ? 0 : matches.length - 1;
    else this.matchIndex = (this.matchIndex + direction + matches.length) % matches.length;
    pane.jumpToLine(matches[this.matchIndex]!);
  }
  /** `e`: the next failed tool result in the focused pane, wrapping once. */
  private jumpError(): void {
    const pane = this.panes[this.focus];
    if (!pane) return;
    const errors = pane.errorLines();
    if (!errors.length) return;
    const current = pane.getState().offset;
    const next = errors.find((line) => line > current);
    pane.jumpToLine(next ?? errors[0]!);
  }
  /** Matches for the footer; undefined while there is no query. */
  private matchSummary(pane: TranscriptPane | undefined): string | undefined {
    if (!this.query) return undefined;
    const total = pane?.findMatches(this.query).length ?? 0;
    return `${this.searching ? "/" : ""}${this.query}${this.searching ? "▍" : ""} · ${total} match${total === 1 ? "" : "es"}`;
  }
  render(width: number): string[] {
    if (width < 1) return [];
    const height = this.height;
    const bodyHeight = Math.max(3, height - 2);
    const columns = this.effectiveColumns(width);
    const focused = this.panes[this.focus] ?? this.panes[0];
    if (!focused) return Array.from({ length: height }, () => "");
    const footer = this.footer(width, columns);
    if (columns === 1 || this.panes.length < 2) {
      const lines = focused.render(width, bodyHeight, false);
      return [...lines, "", footer].slice(0, height).map((line) => truncateToWidth(line, width));
    }
    const colWidth = Math.max(1, Math.floor((width - 1) / 2));
    const gap = truncateToWidth(this.theme.fg("border", "│"), 1);
    const left = this.panes[0]!.render(colWidth, bodyHeight, this.focus === 0);
    const right = this.panes[1]!.render(colWidth, bodyHeight, this.focus === 1);
    const lines: string[] = [];
    for (let index = 0; index < bodyHeight; index++) {
      const l = truncateToWidth(left[index] ?? "", colWidth);
      const r = truncateToWidth(right[index] ?? "", colWidth);
      const padded = l + " ".repeat(Math.max(0, colWidth - visibleWidth(l)));
      lines.push(truncateToWidth(`${padded}${gap}${r}`, width));
    }
    return [...lines, "", footer].slice(0, height).map((line) => truncateToWidth(line, width));
  }
  private footer(width: number, columns: 1 | 2): string {
    const focused = this.panes[this.focus];
    const search = this.matchSummary(focused);
    if (search) {
      const hint = this.searching ? "enter keep · esc clear" : "n/N next · / new · esc clear";
      return truncateToWidth(`${this.theme.fg("warning", search)} ${this.theme.fg("dim", hint)}`, width);
    }
    // The narrow-terminal note goes first so a truncation cannot hide the explanation.
    const filters = focused?.filterState;
    const parts = ["tab focus", "s one/two", "f follow", "/ search", "o open", "y path", "pgup/pgdn scroll", "esc back"];
    if (filters && !filters.showThinking) parts.unshift("t thinking hidden");
    if (filters?.collapseResults) parts.unshift("r results one line");
    const narrow = this.panes.length > 1 && columns === 1 && width < MIN_TWO_COLUMN_WIDTH;
    if (narrow) return truncateToWidth(`${this.theme.fg("warning", "one column: too narrow for two")} ${this.theme.fg("dim", parts.join(" · "))}`, width);
    return truncateToWidth(this.theme.fg("dim", parts.join(" · ")), width);
  }
}

/* ---------- agents screen ---------- */

export interface AgentsScreenOptions {
  theme: FabricTheme;
  rows: readonly AgentRow[];
  onOpen: (row: AgentRow) => void;
  /** Flip the collapsed state of a row that has descendants. */
  onToggle: (row: AgentRow) => void;
  /** Ask the caller to cancel this agent (and its descendants). */
  onCancel: (row: AgentRow) => void;
  onClose: () => void;
}

/**
 * The `/agents` list: main first, then the tree, with group rows, collapse and an
 * inline cancel confirmation. It is the only keyboard path to a transcript.
 */
export class AgentsScreen implements Component {
  private readonly theme: FabricTheme;
  private readonly onOpen: AgentsScreenOptions["onOpen"];
  private readonly onToggle: AgentsScreenOptions["onToggle"];
  private readonly onCancel: AgentsScreenOptions["onCancel"];
  private readonly onClose: AgentsScreenOptions["onClose"];
  private rows: AgentRow[];
  private selected = 0;
  private offset = 0;
  private height = 20;
  private confirm?: AgentRow;

  constructor(options: AgentsScreenOptions) {
    this.theme = options.theme;
    this.onOpen = options.onOpen;
    this.onToggle = options.onToggle;
    this.onCancel = options.onCancel;
    this.onClose = options.onClose;
    this.rows = [...options.rows];
  }
  setHeight(rows: number): void { this.height = Math.max(6, Math.floor(rows)); }
  /** Keeps the same selection when rows change, and clamps when it expires underneath. */
  setRows(rows: readonly AgentRow[]): void {
    const selectedId = this.rows[this.selected]?.id;
    this.rows = [...rows];
    const next = this.rows.findIndex((row) => row.id === selectedId);
    this.selected = next >= 0 ? next : Math.min(this.selected, Math.max(0, this.rows.length - 1));
    this.clamp();
  }
  getState(): { selectedId?: string; confirming?: string } {
    return { selectedId: this.rows[this.selected]?.id, confirming: this.confirm?.id };
  }
  invalidate(): void { /* Rendering is calculated fresh each frame. */ }
  handleInput(input: string): void {
    if (this.confirm) {
      if (input === "y" || input === "Y") { const row = this.confirm; this.confirm = undefined; this.onCancel(row); return; }
      if (input === "n" || input === "N" || matchesKey(input, Key.escape)) { this.confirm = undefined; return; }
      return;
    }
    if (matchesKey(input, Key.escape)) { this.onClose(); return; }
    if (matchesKey(input, Key.enter)) { const row = this.rows[this.selected]; if (row) this.onOpen(row); return; }
    if (input === "x") { const row = this.rows[this.selected]; if (row && row.kind !== "main") this.confirm = row; return; }
    if (matchesKey(input, Key.right) || input === " ") { const row = this.rows[this.selected]; if (row?.collapsed) this.onToggle(row); return; }
    if (matchesKey(input, Key.left)) { const row = this.rows[this.selected]; if (row && row.collapsed === false) this.onToggle(row); return; }
    if (matchesKey(input, Key.up) || input === "k") this.selected -= 1;
    else if (matchesKey(input, Key.down) || input === "j") this.selected += 1;
    else if (matchesKey(input, Key.home) || input === "g") this.selected = 0;
    else if (matchesKey(input, Key.end) || input === "G") this.selected = this.rows.length - 1;
    else return;
    this.clamp();
  }
  render(width: number): string[] {
    if (width < 1) return [];
    const rows = Math.max(3, this.height - 3);
    const start = Math.max(0, Math.min(this.selected - Math.floor(rows / 2), Math.max(0, this.rows.length - rows)));
    // Count agents, not rows: a collapsed group stands for all of its members.
    const live = this.rows.reduce((total, row) => total + (row.kind === "group" ? (row.members?.length ?? 0) : 1), 0);
    const title = truncateToWidth(this.theme.fg("accent", this.theme.bold(`Agents  ${live} live`)), width);
    const list = this.rows.length
      ? this.rows.slice(start, start + rows).map((row, index) => renderAgentRow(row, this.theme, width, { cursor: start + index === this.selected }))
      : [this.theme.fg("dim", "No live agents. Delegated agents appear here as soon as they spawn.")];
    const position = this.rows.length > rows ? `rows ${start + 1}-${Math.min(this.rows.length, start + rows)}/${this.rows.length} · ` : "";
    const footer = this.confirm
      ? this.theme.fg("warning", this.confirm.kind === "group"
        ? `Cancel all ${this.confirm.members?.length ?? 0} agents in this group (and their descendants)? y/n`
        : `Cancel "${this.confirm.label}" and its descendants? y/n`)
      : this.theme.fg("dim", `${position}↑↓ select · → expand · ← collapse · enter open · x cancel · esc close`);
    return [title, ...list, "", truncateToWidth(footer, width)].slice(0, this.height).map((line) => truncateToWidth(line, width));
  }
  private clamp(): void { this.selected = Math.min(Math.max(0, this.selected), Math.max(0, this.rows.length - 1)); }
}

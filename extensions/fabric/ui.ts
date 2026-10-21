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
  right: ComparisonResult;
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
export class TranscriptPane {
  private readonly theme: FabricTheme;
  private readonly spec: TranscriptPaneSpec;
  private source: TranscriptSource = { text: "" };
  private entries: TranscriptEntry[] = [];
  /** Index in `source.text` after the last parsed complete line. */
  private parsedChars = 0;
  private cache?: { width: number; text: string; lines: string[] };
  private offset = 0;
  private maxOffset = 0;
  private maxRows: number;

  constructor(options: TranscriptPaneOptions) {
    this.theme = options.theme;
    this.spec = options.spec;
    this.maxRows = Math.max(3, options.maxRows ?? 20);
    if (this.spec.read) this.setSource(this.spec.read());
  }
  get id(): string { return this.spec.id; }
  get label(): string { return this.spec.label; }
  get hue(): number { return this.spec.hue; }
  invalidate(): void { this.cache = undefined; }
  /** Sizes the body so header + rule + body fills `height` lines exactly. */
  setHeight(height: number): void { this.maxRows = Math.max(3, Math.floor(height) - 2); }
  setSource(source: TranscriptSource): void {
    this.source = source;
    // Only complete lines are parsed; a half-written trailing line waits for its newline.
    const lastNewline = source.text.lastIndexOf("\n");
    this.parsedChars = lastNewline + 1;
    this.entries = parseSessionText(source.text.slice(0, this.parsedChars));
    this.cache = undefined;
    this.maxOffset = 0;
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
    this.cache = undefined;
    return true;
  }
  /** Handles the scroll keys; returns true when the view moved. */
  scroll(input: string): boolean {
    const page = Math.max(1, this.maxRows - 2);
    const before = this.offset;
    if (matchesKey(input, Key.pageDown) || input === " " || input === "j") this.offset += page;
    else if (matchesKey(input, Key.pageUp) || input === "k") this.offset -= page;
    else if (matchesKey(input, Key.down)) this.offset += 1;
    else if (matchesKey(input, Key.up)) this.offset -= 1;
    else if (matchesKey(input, Key.home) || input === "g") this.offset = 0;
    // "End" is resolved against the next layout, so it lands at the real end even
    // when the content or the width changed since the last render.
    else if (matchesKey(input, Key.end) || input === "G") { this.offset = Number.MAX_SAFE_INTEGER; return true; }
    else return false;
    this.offset = Math.min(Math.max(0, this.offset), this.maxOffset);
    return this.offset !== before;
  }
  getState(): { offset: number; maxOffset: number; entries: number; rows: number } {
    // The "jump to end" sentinel is resolved by the next render; report it already resolved.
    const offset = this.offset === Number.MAX_SAFE_INTEGER ? this.maxOffset : this.offset;
    return { offset, maxOffset: this.maxOffset, entries: this.entries.length, rows: this.maxRows };
  }
  /** Header, rule and body, padded to exactly `height` lines. */
  render(width: number, height: number, focused = false): string[] {
    if (width < 1) return [];
    const rows = Math.max(1, height - 2);
    const body = this.bodyLines(width);
    const max = Math.max(0, body.length - rows);
    this.maxOffset = max;
    this.offset = Math.min(Math.max(0, this.offset), max);
    const name = this.spec.main ? this.theme.fg("accent", this.theme.bold(this.spec.label)) : paintAgent(this.theme, this.spec.hue, this.spec.label);
    const meta = [this.spec.model, this.spec.status].filter(Boolean).join(" · ");
    const cursor = focused ? this.theme.fg("accent", "› ") : "";
    const header = truncateToWidth(`${cursor}${name} ${this.theme.fg("muted", `· ${meta}`)}`, width);
    const tint = this.spec.main ? this.theme.fg("borderAccent", "─".repeat(Math.max(1, width))) : paintAgent(this.theme, this.spec.hue, "─".repeat(Math.max(1, width)));
    const rule = truncateToWidth(tint, width);
    const visible = body.slice(this.offset, this.offset + rows);
    const lines = [header, rule, ...visible];
    while (lines.length < height) lines.push("");
    return lines.slice(0, Math.max(1, height)).map((line) => truncateToWidth(line, width));
  }
  private bodyLines(width: number): string[] {
    if (this.cache && this.cache.width === width && this.cache.text === this.source.text) return this.cache.lines;
    const inner = Math.max(1, width - 2);
    const band = this.theme.style ? agentBand(this.theme, this.spec.hue) : undefined;
    const paint = band && this.theme.style
      ? (text: string) => this.theme.style!(text, { fg: band.fg, bg: band.bg })
      : undefined;
    const lines: string[] = [];
    for (const entry of this.entries) {
      const { label, body } = describeEntry(entry, this.theme, paint);
      lines.push(truncateToWidth(label, width));
      for (const raw of body.split("\n")) {
        for (const wrapped of wrapTextWithAnsi(raw || " ", inner)) lines.push(truncateToWidth(`  ${wrapped}`, width));
      }
      lines.push("");
    }
    if (lines.length) lines.pop();
    this.cache = { width, text: this.source.text, lines };
    return lines;
  }
}

/* ---------- agent transcript screen ---------- */

/** Below this width two columns cannot both stay readable. */
export const MIN_TWO_COLUMN_WIDTH = 80;

export interface AgentTranscriptOptions {
  theme: FabricTheme;
  specs: readonly TranscriptPaneSpec[];
  onClose?: () => void;
}

/**
 * The full-window transcript screen: one agent, or two side by side (a comparison
 * group). Each column keeps its own parser, scroll position and hue. Keys: tab
 * switches focus, `s` toggles one/two columns, page keys scroll the focused
 * column, esc steps back.
 */
export class AgentTranscriptOverlay implements Component {
  private readonly theme: FabricTheme;
  private readonly panes: TranscriptPane[];
  private readonly onClose?: () => void;
  private columns: 1 | 2;
  private focus = 0;
  private height = 24;

  constructor(options: AgentTranscriptOptions) {
    this.theme = options.theme;
    this.onClose = options.onClose;
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
    if (matchesKey(input, Key.escape)) { this.onClose?.(); return; }
    if (input === "s" && this.panes.length > 1) { this.columns = this.columns === 2 ? 1 : 2; return; }
    if (matchesKey(input, Key.tab) && this.panes.length > 1) { this.focus = (this.focus + 1) % this.panes.length; return; }
    const focused = this.panes[this.focus];
    if (focused) focused.scroll(input);
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
    // The narrow-terminal note goes first so a truncation cannot hide the explanation.
    const parts = ["tab focus", "s one/two", "pgup/pgdn scroll", "esc back"];
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

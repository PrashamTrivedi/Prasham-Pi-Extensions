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

export type FabricAgentStatus = "queued" | "running" | "waiting" | "done" | "error" | "cancelled";

/** The small theme contract makes these usable from extensions and tool renderers. */
export interface FabricTheme {
  fg(color: "text" | "accent" | "muted" | "dim" | "success" | "error" | "warning" | "border" | "borderAccent", text: string): string;
  bold(text: string): string;
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

export type InspectorTab = "team" | "activity" | "tools" | "result" | "patch" | "compare";
const inspectorTabs: InspectorTab[] = ["team", "activity", "tools", "result", "patch", "compare"];
export interface InspectorData {
  title?: string;
  agents: readonly FabricAgentView[];
  /** Number of content rows visible at once. Default: 14. */
  maxRows?: number;
}
export interface InspectorOptions {
  theme: FabricTheme;
  data: InspectorData;
  onChange?: (state: Readonly<InspectorState>) => void;
  onClose?: () => void;
  /** Called on Enter for the selected agent; the caller usually opens its transcript. */
  onOpen?: (agent: FabricAgentView) => void;
  /** Called on `a`; the caller flips its pruned/all filter and re-supplies the data. */
  onToggleFilter?: () => void;
}
export interface InspectorState {
  selectedId?: string;
  tab: InspectorTab;
  pinnedIds: readonly string[];
  scrollOffset: number;
}

/**
 * Interactive overlay component for `/team`. Keys: ↑/↓ or j/k select,
 * ←/→ or tab switch tabs, p pin, home/end jump, page keys scroll, esc closes.
 * Pinning is local UI state; callers can persist `getState()` if desired.
 */
export class LiveTeamInspectorOverlay implements Component {
  private readonly theme: FabricTheme;
  private data: InspectorData;
  private selected = 0;
  private tab: InspectorTab = "team";
  private scrollOffset = 0;
  private readonly pinned = new Set<string>();
  private readonly onChange?: InspectorOptions["onChange"];
  private readonly onClose?: () => void;
  private readonly onOpen?: InspectorOptions["onOpen"];
  private readonly onToggleFilter?: InspectorOptions["onToggleFilter"];

  constructor(options: InspectorOptions) {
    this.theme = options.theme;
    this.data = options.data;
    this.onChange = options.onChange;
    this.onClose = options.onClose;
    this.onOpen = options.onOpen;
    this.onToggleFilter = options.onToggleFilter;
  }
  getState(): InspectorState {
    return { selectedId: this.agents()[this.selected]?.id, tab: this.tab, pinnedIds: [...this.pinned], scrollOffset: this.scrollOffset };
  }
  setData(data: InspectorData): void {
    const selectedId = this.agents()[this.selected]?.id;
    this.data = data;
    const next = this.agents().findIndex((agent) => agent.id === selectedId);
    this.selected = Math.max(0, next);
    this.clamp(); this.changed();
  }
  invalidate(): void { /* Render is calculated fresh so theme changes are safe. */ }
  handleInput(input: string): void {
    const agents = this.agents();
    const selectedId = agents[this.selected]?.id;
    let changedPins = false;
    if (matchesKey(input, Key.escape)) { this.onClose?.(); return; }
    if (matchesKey(input, Key.enter)) { const current = agents[this.selected]; if (current) this.onOpen?.(current); return; }
    if (input === "a") { this.onToggleFilter?.(); return; }
    if (matchesKey(input, Key.up) || input === "k") this.selected = Math.max(0, this.selected - 1);
    else if (matchesKey(input, Key.down) || input === "j") this.selected = Math.min(Math.max(0, agents.length - 1), this.selected + 1);
    else if (matchesKey(input, Key.home)) this.selected = 0;
    else if (matchesKey(input, Key.end)) this.selected = Math.max(0, agents.length - 1);
    else if (matchesKey(input, Key.tab) || matchesKey(input, Key.right) || input === "l") this.tab = this.nextTab(1);
    else if (matchesKey(input, Key.shift("tab")) || matchesKey(input, Key.left) || input === "h") this.tab = this.nextTab(-1);
    else if (input === "p") { const current = agents[this.selected]; if (current) { this.pinned.has(current.id) ? this.pinned.delete(current.id) : this.pinned.add(current.id); changedPins = true; } }
    else if (matchesKey(input, Key.pageUp)) this.scrollOffset -= this.rows();
    else if (matchesKey(input, Key.pageDown)) this.scrollOffset += this.rows();
    else return;
    // Pinning changes sort order, so keep focus on the same agent rather than its old index.
    if (changedPins && selectedId) this.selected = Math.max(0, this.agents().findIndex((agent) => agent.id === selectedId));
    if (selectedId !== this.agents()[this.selected]?.id || (!matchesKey(input, Key.pageUp) && !matchesKey(input, Key.pageDown) && input !== "p")) this.scrollOffset = 0;
    this.clamp(); this.changed();
  }
  render(width: number): string[] {
    if (width < 1) return [];
    const agents = this.agents(); const selected = agents[this.selected]; const rows = this.rows();
    const tabs = inspectorTabs.map((tab) => tab === this.tab ? this.theme.fg("accent", `[${tab}]`) : this.theme.fg("muted", ` ${tab} `)).join(" ");
    const header = `${this.data.title ?? "◆ PI FABRIC — live team"}  ${tabs}`;
    const pinText = this.pinned.size ? ` · ${this.pinned.size} pinned` : "";
    const lines = [truncateToWidth(this.theme.fg("accent", this.theme.bold(header)), width), truncateToWidth(this.theme.fg("muted", `${countSummary(agents)}${pinText}`), width)];
    const body = this.tab === "team" ? this.teamLines(agents, width) : this.tab === "compare" ? this.compareLines(agents, width) : this.detailLines(selected, width);
    // Selection never disappears below the viewport while navigating the team tab.
    if (this.tab === "team") {
      if (this.selected < this.scrollOffset) this.scrollOffset = this.selected;
      if (this.selected >= this.scrollOffset + rows) this.scrollOffset = this.selected - rows + 1;
    }
    const maxOffset = Math.max(0, body.length - rows);
    this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
    lines.push(...body.slice(this.scrollOffset, this.scrollOffset + rows));
    if (body.length > rows) lines.push(truncateToWidth(this.theme.fg("dim", `rows ${this.scrollOffset + 1}-${Math.min(body.length, this.scrollOffset + rows)}/${body.length}`), width));
    lines.push(truncateToWidth(this.theme.fg("dim", "↑↓/j k select · enter transcript · tab/←→ tabs · p pin · a filter · pgup/pgdn scroll · esc close"), width));
    return lines.map((line) => truncateToWidth(line, width));
  }
  private agents(): FabricAgentView[] { return [...this.data.agents].sort((a, b) => Number(this.pinned.has(b.id)) - Number(this.pinned.has(a.id))); }
  private rows(): number { return Math.max(3, this.data.maxRows ?? 14); }
  private nextTab(delta: number): InspectorTab { const tabs = inspectorTabs; return tabs[(tabs.indexOf(this.tab) + delta + tabs.length) % tabs.length]!; }
  private teamLines(agents: readonly FabricAgentView[], width: number): string[] {
    if (!agents.length) return [this.theme.fg("dim", "No delegated agents yet.")];
    return agents.map((agent, index) => {
      const cursor = index === this.selected ? this.theme.fg("accent", "›") : " ";
      const pin = this.pinned.has(agent.id) ? this.theme.fg("warning", "★") : " ";
      return truncateToWidth(`${cursor}${pin} ${this.theme.fg(statusColor[agent.status], statusIcon[agent.status])} ${agent.label} ${this.theme.fg("dim", `${short(agent.id)} · ${agent.model} · ${agent.status}`)}`, width);
    });
  }
  private detailLines(agent: FabricAgentView | undefined, width: number): string[] {
    if (!agent) return [this.theme.fg("dim", "No agent selected.")];
    const source = this.tab === "activity" ? agent.events : this.tab === "tools" ? agent.tools : this.tab === "result" ? agent.result : agent.patch;
    const fallback = this.tab === "result" ? (agent.error ?? "No result packet yet.") : "No patch captured yet.";
    const title = `${agent.label} · ${short(agent.id)} · ${agent.status}`;
    const path = this.tab === "patch" ? agent.patchPath : this.tab === "result" ? agent.resultPath : undefined;
    const transcript = agent.sessionPath ? [this.theme.fg("dim", `transcript: ${agent.sessionPath}`)] : [];
    return [this.theme.fg("accent", this.theme.bold(title)), ...(path ? wrapTextWithAnsi(path, Math.max(1, width)) : []), ...transcript.map(line => truncateToWidth(line, width)), ...(source || fallback).split("\n").flatMap(line => wrapTextWithAnsi(line || " ", Math.max(1, width)))];
  }
  private compareLines(agents: FabricAgentView[], width: number): string[] {
    const pinned = agents.filter(agent => this.pinned.has(agent.id)).slice(0, 2);
    if (pinned.length < 2) return ["Pin two agents with p in the team tab to compare."];
    const card = (agent: FabricAgentView): ComparisonResult => ({ label: agent.label, summary: agent.result || agent.activity || agent.status, details: agent.error, metrics: { model: agent.model, status: agent.status } });
    return renderComparisonResultCard({ left: card(pinned[0]!), right: card(pinned[1]!), maxBodyLines: 12 }, this.theme, width);
  }
  private clamp(): void { this.selected = Math.min(Math.max(0, this.selected), Math.max(0, this.agents().length - 1)); this.scrollOffset = Math.max(0, this.scrollOffset); }
  private changed(): void { this.invalidate(); this.onChange?.(this.getState()); }
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

function describeEntry(entry: TranscriptEntry, theme: FabricTheme): { label: string; body: string } {
  switch (entry.kind) {
    case "user": return { label: theme.fg("accent", theme.bold("You")), body: entry.text };
    case "assistant": return { label: theme.fg("text", theme.bold("Assistant")), body: entry.text };
    case "thinking": return { label: theme.fg("dim", "thinking"), body: entry.text };
    case "toolCall": return { label: theme.fg("warning", `⚙ ${entry.name}`), body: entry.args };
    case "toolResult": return { label: theme.fg(entry.isError ? "error" : "muted", `${entry.isError ? "✗" : "✓"} ${entry.name}`), body: entry.text };
    case "note": return { label: theme.fg("dim", "·"), body: entry.text };
  }
}

export interface TranscriptViewerOptions {
  theme: FabricTheme;
  title: string;
  /** Reloaded by `refresh()` so a still-running agent can be followed live. */
  read?: () => TranscriptSource;
  onClose?: () => void;
  /** Visible body rows. Default: 20. */
  maxRows?: number;
}

/**
 * Full-window replay of a saved session: user/assistant text, thinking, tool
 * calls, and tool results in order. Keys: pgup/pgdn or k/j scroll, home/end
 * (g/G) jump, esc closes. Every rendered line is bounded to the given width.
 */
export class TranscriptViewerOverlay implements Component {
  private readonly theme: FabricTheme;
  private title: string;
  private readonly read?: () => TranscriptSource;
  private readonly onClose?: () => void;
  private maxRows: number;
  private source: TranscriptSource = { text: "" };
  private entries: TranscriptEntry[] = [];
  /** Index in `source.text` after the last parsed complete line. */
  private parsedChars = 0;
  private cache?: { width: number; text: string; lines: string[] };
  private offset = 0;
  private maxOffset = 0;

  constructor(options: TranscriptViewerOptions) {
    this.theme = options.theme;
    this.title = options.title;
    this.read = options.read;
    this.onClose = options.onClose;
    this.maxRows = Math.max(3, options.maxRows ?? 20);
    if (this.read) this.setSource(this.read());
  }
  /** Theme changes drop the wrapped layout. */
  invalidate(): void { this.cache = undefined; }
  /** The header is not part of the wrapped layout, so a live status needs no relayout. */
  setTitle(title: string): void { this.title = title; }
  /**
   * Caps the body so this view fits in `rows` lines, leaving room for its own
   * chrome (title, count line, two rules, hint, optional notice). Called from
   * render so a terminal resize is picked up without reopening the transcript.
   */
  setHeight(rows: number): void {
    const chrome = 5 + (this.source.notice ? 1 : 0);
    this.maxRows = Math.max(3, Math.floor(rows) - chrome);
  }
  /** Re-reads the source; returns true when the transcript changed. */
  refresh(): boolean {
    if (!this.read) return false;
    const next = this.read();
    if (next.text === this.source.text && next.notice === this.source.notice) return false;
    // Keep following the tail only when the reader was already at the tail.
    const following = this.offset >= this.maxOffset && this.maxOffset > 0;
    this.setSource(next);
    if (following) this.offset = Number.MAX_SAFE_INTEGER;
    return true;
  }
  setSource(source: TranscriptSource): void {
    this.source = source;
    // Only complete lines are parsed; a half-written trailing line waits for its newline.
    const lastNewline = source.text.lastIndexOf("\n");
    this.parsedChars = lastNewline + 1;
    this.entries = parseSessionText(source.text.slice(0, this.parsedChars));
    this.cache = undefined;
    this.maxOffset = 0;
  }
  /**
   * Appends newly written session bytes, parsing only the new complete lines, so
   * following a live run costs the size of what was added rather than the file.
   * A trailing partial line is kept for the next call and never dropped.
   */
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
  getState(): { offset: number; maxOffset: number; entries: number; rows: number } {
    return { offset: this.offset, maxOffset: this.maxOffset, entries: this.entries.length, rows: this.maxRows };
  }
  handleInput(input: string): void {
    const page = Math.max(1, this.rows() - 2);
    if (matchesKey(input, Key.escape)) { this.onClose?.(); return; }
    if (matchesKey(input, Key.pageDown) || input === " " || input === "j") this.offset += page;
    else if (matchesKey(input, Key.pageUp) || input === "k") this.offset -= page;
    else if (matchesKey(input, Key.down)) this.offset += 1;
    else if (matchesKey(input, Key.up)) this.offset -= 1;
    else if (matchesKey(input, Key.home) || input === "g") this.offset = 0;
    else if (matchesKey(input, Key.end) || input === "G") this.offset = this.maxOffset;
    else return;
    this.offset = Math.min(Math.max(0, this.offset), this.maxOffset);
  }
  render(width: number): string[] {
    if (width < 1) return [];
    const body = this.bodyLines(width);
    const rows = this.rows();
    const max = Math.max(0, body.length - rows);
    this.maxOffset = max;
    this.offset = Math.min(Math.max(0, this.offset), max);
    const entries = this.entries.length;
    const meta = entries
      ? `${entries} entries · rows ${this.offset + 1}-${Math.min(body.length, this.offset + rows)}/${body.length}`
      : "No transcript entries saved yet.";
    const lines = [truncateToWidth(this.theme.fg("accent", this.theme.bold(this.title)), width), truncateToWidth(this.theme.fg("muted", meta), width)];
    if (this.source.notice) lines.push(truncateToWidth(this.theme.fg("warning", this.source.notice), width));
    lines.push(this.rule(width));
    const visible = body.slice(this.offset, this.offset + rows);
    if (!visible.length) lines.push(truncateToWidth(this.theme.fg("dim", "This run has not written any messages yet."), width));
    lines.push(...visible);
    lines.push(this.rule(width));
    lines.push(truncateToWidth(this.theme.fg("dim", "pgup/pgdn scroll · home/end jump · esc back"), width));
    return lines.map((line) => truncateToWidth(line, width));
  }
  private rule(width: number): string { return truncateToWidth(this.theme.fg("border", "─".repeat(Math.max(1, width))), width); }
  private rows(): number { return Math.max(3, this.maxRows); }
  private bodyLines(width: number): string[] {
    if (this.cache && this.cache.width === width && this.cache.text === this.source.text) return this.cache.lines;
    const inner = Math.max(1, width - 2);
    const lines: string[] = [];
    for (const entry of this.entries) {
      const { label, body } = describeEntry(entry, this.theme);
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

/* ---------- run picker ---------- */

/** Short relative age for run lists. Pure so lists stay deterministic in tests. */
export function relativeAge(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export interface TranscriptPickerOptions {
  theme: FabricTheme;
  /** Runs in the order they should be listed (the caller sorts newest first). */
  runs: readonly FabricAgentView[];
  onOpen: (run: FabricAgentView) => void;
  onClose?: () => void;
  /** Visible list rows. Default: 12. */
  maxRows?: number;
}

/**
 * Lists Fabric runs so a transcript can be opened without going through `/team`.
 * Keys: ↑/↓ or j/k select, home/end jump, enter opens, esc closes.
 */
export class TranscriptPickerOverlay implements Component {
  private readonly theme: FabricTheme;
  private readonly onOpen: (run: FabricAgentView) => void;
  private readonly onClose?: () => void;
  private readonly maxRows: number;
  private runs: FabricAgentView[];
  private selected = 0;

  constructor(options: TranscriptPickerOptions) {
    this.theme = options.theme;
    this.onOpen = options.onOpen;
    this.onClose = options.onClose;
    this.maxRows = Math.max(3, options.maxRows ?? 12);
    this.runs = [...options.runs];
  }
  /** Keeps the same run selected while the list refreshes under an open picker. */
  setRuns(runs: readonly FabricAgentView[]): void {
    const selectedId = this.runs[this.selected]?.id;
    this.runs = [...runs];
    const next = this.runs.findIndex((run) => run.id === selectedId);
    this.selected = Math.max(0, next);
    this.clamp();
  }
  invalidate(): void { /* Rendering is calculated fresh each frame. */ }
  handleInput(input: string): void {
    if (matchesKey(input, Key.escape)) { this.onClose?.(); return; }
    if (matchesKey(input, Key.enter)) { const run = this.runs[this.selected]; if (run) this.onOpen(run); return; }
    if (matchesKey(input, Key.up) || input === "k") this.selected -= 1;
    else if (matchesKey(input, Key.down) || input === "j") this.selected += 1;
    else if (matchesKey(input, Key.home) || input === "g") this.selected = 0;
    else if (matchesKey(input, Key.end) || input === "G") this.selected = this.runs.length - 1;
    else return;
    this.clamp();
  }
  render(width: number): string[] {
    if (width < 1) return [];
    const rows = this.rows();
    const start = Math.max(0, Math.min(this.selected - Math.floor(rows / 2), Math.max(0, this.runs.length - rows)));
    const lines = [truncateToWidth(this.theme.fg("accent", this.theme.bold(`Run transcripts  ${this.runs.length} run${this.runs.length === 1 ? "" : "s"}`)), width)];
    if (!this.runs.length) {
      lines.push(truncateToWidth(this.theme.fg("dim", "No Fabric runs in this session yet. Spawn agents, then reopen this list."), width));
      lines.push(truncateToWidth(this.theme.fg("dim", "esc close"), width));
      return lines.map((line) => truncateToWidth(line, width));
    }
    for (const [index, run] of this.runs.slice(start, start + rows).entries()) {
      const cursor = start + index === this.selected ? this.theme.fg("accent", "›") : " ";
      const icon = this.theme.fg(statusColor[run.status], statusIcon[run.status]);
      const meta = [short(run.id), run.model, run.status, relativeAge(run.finishedAt ?? run.startedAt)].filter(Boolean).join(" · ");
      const missing = run.sessionPath ? "" : this.theme.fg("warning", " · no transcript yet");
      lines.push(truncateToWidth(`${cursor} ${icon} ${run.label} ${this.theme.fg("dim", meta)}${missing}`, width));
    }
    if (this.runs.length > rows) lines.push(truncateToWidth(this.theme.fg("dim", `rows ${start + 1}-${Math.min(this.runs.length, start + rows)}/${this.runs.length}`), width));
    lines.push(truncateToWidth(this.theme.fg("dim", "↑↓/j k select · enter open transcript · esc close"), width));
    return lines.map((line) => truncateToWidth(line, width));
  }
  private rows(): number { return Math.max(3, this.maxRows); }
  private clamp(): void { this.selected = Math.min(Math.max(0, this.selected), Math.max(0, this.runs.length - 1)); }
}

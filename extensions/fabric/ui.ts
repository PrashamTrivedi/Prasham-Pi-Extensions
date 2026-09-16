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
}

/** Input for the compact persistent widget. */
export interface CompactWidgetData {
  agents: readonly FabricAgentView[];
  maxAgents?: number;
  title?: string;
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

/**
 * Renders a concise tree-free widget intended for `ctx.ui.setWidget`.
 * It deliberately caps rows so a large team cannot crowd out the editor.
 */
export function renderCompactFabricWidget(data: CompactWidgetData, theme: FabricTheme, width = 80): string[] {
  if (width < 1) return [];
  const maxAgents = Math.max(0, data.maxAgents ?? 4);
  const lines = [theme.fg("accent", `${data.title ?? "◆ PI FABRIC"}  ${countSummary(data.agents)}`)];
  for (const agent of data.agents.slice(0, maxAgents)) {
    const prefix = `${statusIcon[agent.status]} ${agent.label} · `;
    const status = theme.fg(statusColor[agent.status], agent.activity || agent.status);
    lines.push(truncateToWidth(theme.fg("muted", prefix) + status, width));
  }
  if (data.agents.length > maxAgents) lines.push(truncateToWidth(theme.fg("dim", `… ${data.agents.length - maxAgents} more agents`), width));
  return lines.map((line) => truncateToWidth(line, width));
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

  constructor(options: InspectorOptions) {
    this.theme = options.theme;
    this.data = options.data;
    this.onChange = options.onChange;
    this.onClose = options.onClose;
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
    lines.push(truncateToWidth(this.theme.fg("dim", "↑↓/j k select · tab/←→ tabs · p pin · pgup/pgdn scroll · esc close"), width));
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
    return [this.theme.fg("accent", this.theme.bold(title)), ...(path ? wrapTextWithAnsi(path, Math.max(1, width)) : []), ...(source || fallback).split("\n").flatMap(line => wrapTextWithAnsi(line || " ", Math.max(1, width)))];
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

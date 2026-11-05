/**
 * Fabric's presentation model: the agent tree behind the rows below the prompt
 * and the `/agents` screen. Pure apart from the TUI width helpers, so the shapes,
 * ordering, grouping and colours are unit-testable without a terminal.
 */
import { okhslColor, truncateToWidth, type Color } from "@earendil-works/pi-tui";
import type { FabricAgentStatus, FabricTheme } from "./ui.ts";

/** A row can also be the main chat, whose status is simply busy or idle. */
export type AgentRowStatus = FabricAgentStatus | "idle";

export interface AgentSnapshot {
  id: string;
  /** `main` is the coordinator chat; `agent` is a delegated run. */
  kind: "main" | "agent";
  label: string;
  model: string;
  status: AgentRowStatus;
  activity?: string;
  startedAt?: string;
  finishedAt?: string;
  parentId?: string;
  /** Agents created by one spawn call share this, so they compare as a group. */
  batchId?: string;
  sessionPath?: string;
  /** A failed run the human has already opened; it leaves the rows from then on. */
  dismissed?: boolean;
  /** Folded usage (`$0.04 · 128k · read`) from the child session. */
  usage?: string;
}

export interface AgentRow {
  /** Agent id, or `group:<batchId>` for a comparison group. */
  id: string;
  kind: "main" | "agent" | "group";
  label: string;
  model: string;
  status: AgentRowStatus;
  activity?: string;
  elapsedMs?: number;
  sessionPath?: string;
  parentId?: string;
  depth: number;
  /** Stable 0..1 hue, assigned across everything currently visible. */
  hue: number;
  /** 1-based position in the row list; `/agents <n>` and Alt+<n> target it. */
  number?: number;
  /** Group rows only: the members that open side by side. */
  members?: string[];
  /** Group rows only: per-status counts like `2● 1×`, so one icon cannot hide a failure. */
  counts?: string;
  /** Folded session usage, shown on wide rows only. */
  usage?: string;
  /** True when this row hides descendants (agent or group). */
  collapsed?: boolean;
  /** Number of direct children hidden under a collapsed row. */
  hiddenChildren?: number;
}

const statusIcon: Record<AgentRowStatus, string> = {
  idle: "◇", queued: "○", running: "●", waiting: "◌", done: "✓", error: "×", cancelled: "×",
};
const statusColor: Record<AgentRowStatus, "success" | "error" | "warning" | "accent" | "muted"> = {
  idle: "muted", queued: "warning", running: "accent", waiting: "warning", done: "success", error: "error", cancelled: "error",
};

/** Compact elapsed time: 45s, 12m, 3h, 2d. */
export function formatElapsed(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "";
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** 32-bit FNV-1a, so an agent keeps the same hue across processes and sessions. */
function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Hue in 0..1, chosen so nearby ids still land far apart. */
export function hueOf(id: string): number { return (hashId(id) % 360) / 360; }

function hueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 1;
  return raw > 0.5 ? 1 - raw : raw;
}

/**
 * Assigns hues so agents visible at the same time stay distinguishable: the same
 * id always starts at the same hue, and a near-collision is nudged deterministically.
 */
export function assignHues(ids: readonly string[], minGap = 0.05): Map<string, number> {
  const assigned = new Map<string, number>();
  const taken: number[] = [];
  for (const id of [...new Set(ids)].sort()) {
    let hue = hueOf(id);
    for (let attempt = 0; attempt < 64 && taken.some((other) => hueDistance(other, hue) < minGap); attempt++) {
      hue = (hue + 0.137) % 1;
    }
    taken.push(hue);
    assigned.set(id, hue);
  }
  return assigned;
}

const fallbackPalette = ["accent", "success", "warning", "error", "muted"] as const;

/** A foreground colour for an agent's name; falls back to a theme token without `style`. */
export function agentForeground(theme: FabricTheme, hue: number): string | Color {
  if (!theme.style) return fallbackPalette[Math.min(fallbackPalette.length - 1, Math.floor(hue * fallbackPalette.length))]!;
  const dark = theme.appearance !== "light";
  return okhslColor(hue * 360, 0.6, dark ? 0.76 : 0.42);
}
/** Background + foreground for a message header band: tinted, readable in both themes. */
export function agentBand(theme: FabricTheme, hue: number): { bg: Color; fg: Color } {
  const dark = theme.appearance !== "light";
  return {
    bg: okhslColor(hue * 360, 0.32, dark ? 0.2 : 0.9),
    fg: okhslColor(hue * 360, 0.34, dark ? 0.93 : 0.15),
  };
}

/** Paints text in an agent's hue, using a generated colour when the theme supports it. */
export function paintAgent(theme: FabricTheme, hue: number, text: string): string {
  const color = agentForeground(theme, hue);
  if (theme.style) return theme.style(text, { fg: color });
  return theme.fg(color as Parameters<FabricTheme["fg"]>[0], text);
}

export interface TreeInput {
  /** Live delegated agents (already filtered by the idle sweep). */
  agents: readonly AgentSnapshot[];
  /** The coordinator chat, or undefined before it is known. */
  main?: AgentSnapshot;
  /** Agent ids whose descendants are hidden (parents are expanded by default). */
  collapsed?: ReadonlySet<string>;
  /** Group ids (`group:<batchId>`) whose members are listed; groups are one row by default. */
  expandedGroups?: ReadonlySet<string>;
  /** Elapsed times are measured from this instant. */
  now?: number;
}

function elapsedFor(agent: AgentSnapshot, now: number): number | undefined {
  if (agent.status === "done" || agent.status === "error" || agent.status === "cancelled") {
    const started = agent.startedAt ? Date.parse(agent.startedAt) : Number.NaN;
    const finished = agent.finishedAt ? Date.parse(agent.finishedAt) : Number.NaN;
    return Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, finished - started) : undefined;
  }
  const started = agent.startedAt ? Date.parse(agent.startedAt) : Number.NaN;
  return Number.isFinite(started) ? Math.max(0, now - started) : undefined;
}

function groupStatus(members: readonly AgentSnapshot[]): AgentRowStatus {
  if (members.some((member) => member.status === "running")) return "running";
  if (members.some((member) => member.status === "queued" || member.status === "waiting")) return "waiting";
  if (members.some((member) => member.status === "error" || member.status === "cancelled")) return "error";
  return members.length ? members[0]!.status : "idle";
}

/**
 * A group row has one icon, so a failure among running siblings would disappear.
 * Counts keep every status visible: `2● 1×`.
 */
export function groupCounts(members: readonly AgentSnapshot[]): string {
  return statusCounts(members);
}

/** `3● 1◌ 2✓ 1×`: the per-status tally shared by group rows and the compact strip. */
export function statusCounts(agents: readonly AgentSnapshot[]): string {
  const count = (statuses: readonly AgentRowStatus[]): number =>
    agents.filter((agent) => statuses.includes(agent.status)).length;
  return ([
    ["●", count(["running"])],
    ["◌", count(["waiting"])],
    ["○", count(["queued"])],
    ["✓", count(["done"])],
    ["×", count(["error", "cancelled"])],
  ] as const)
    .filter(([, value]) => value > 0)
    .map(([icon, value]) => `${value}${icon}`)
    .join(" ");
}

/** Above this many live agents the rows collapse to one strip plus one line per failure. */
export const COMPACT_AGENT_ROWS = 3;

/**
 * The one-line replacement for a busy tree: `◆ fabric 3● 1◌ 2✓ 1× · /agents`.
 * A failure never hides behind the summary, so each failed run keeps its own line.
 */
export function renderAgentStrip(agents: readonly AgentSnapshot[], theme: FabricTheme, width: number): string[] {
  const counts = statusCounts(agents);
  const line = `${theme.fg("accent", theme.bold("◆ fabric"))}${counts ? ` ${theme.fg("muted", counts)}` : ""}${theme.fg("dim", " · /agents")}`;
  const failures = agents.filter((agent) => agent.status === "error");
  const hues = assignHues(failures.map((agent) => agent.id));
  return [
    truncateToWidth(line, width),
    ...failures.map((agent) => truncateToWidth(
      `  ${theme.fg("error", "×")} ${paintAgent(theme, hues.get(agent.id) ?? 0, agent.label)} ${theme.fg("muted", `· ${agent.activity ?? "failed"}`)}`,
      width,
    )),
  ];
}

/**
 * Flattens the agent tree into display rows: main first, then spawn order, with
 * descendants indented and multi-agent spawn batches collapsed into group rows.
 * Collapsing a parent (or a group) hides what is underneath it.
 */
export function buildTree(input: TreeInput): AgentRow[] {
  // A spawn batch is one row until `/agents` expands it, so the rows below the
  // prompt never repeat the same names twice.
  const now = input.now ?? Date.now();
  const collapsed = input.collapsed ?? new Set<string>();
  const expandedGroups = input.expandedGroups ?? new Set<string>();
  const agents = [...input.agents];
  const hueSource = [input.main?.id, ...agents.map((agent) => agent.id)].filter((id): id is string => Boolean(id));
  const hues = assignHues(hueSource);

  const rowFor = (agent: AgentSnapshot, depth: number): AgentRow => ({
    id: agent.id,
    kind: agent.kind,
    label: agent.label,
    model: agent.model,
    status: agent.status,
    activity: agent.activity,
    usage: agent.usage,
    elapsedMs: elapsedFor(agent, now),
    sessionPath: agent.sessionPath,
    parentId: agent.parentId,
    depth,
    hue: hues.get(agent.id) ?? 0,
  });

  const rows: AgentRow[] = [];
  if (input.main) rows.push(rowFor(input.main, 0));

  const visit = (parentId: string | undefined, depth: number) => {
    const children = agents.filter((agent) => agent.parentId === parentId);
    // Group siblings by spawn call, keeping the order the agents were created in.
    const buckets = new Map<string, AgentSnapshot[]>();
    for (const child of children) {
      const key = child.batchId ?? `single:${child.id}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(child); else buckets.set(key, [child]);
    }
    for (const [key, members] of buckets) {
      const groupId = `group:${key}`;
      if (members.length > 1) {
        const isCollapsed = !expandedGroups.has(groupId);
        rows.push({
          id: groupId,
          kind: "group",
          label: `${members.length} agents`,
          model: members[0]!.model,
          status: groupStatus(members),
          activity: members.map((member) => member.label).join(", "),
          elapsedMs: elapsedFor(members[0]!, now),
          depth,
          hue: hues.get(members[0]!.id) ?? 0,
          members: members.map((member) => member.id),
          counts: groupCounts(members),
          collapsed: isCollapsed,
          hiddenChildren: isCollapsed ? members.length : undefined,
        });
        if (isCollapsed) continue;
        for (const member of members) pushAgent(member, depth + 1);
        continue;
      }
      pushAgent(members[0]!, depth);
    }
  };

  const childCount = (id: string) => agents.filter((agent) => agent.parentId === id).length;
  const pushAgent = (agent: AgentSnapshot, depth: number) => {
    const kids = childCount(agent.id);
    const isCollapsed = kids > 0 && collapsed.has(agent.id);
    rows.push({ ...rowFor(agent, depth), collapsed: isCollapsed, hiddenChildren: isCollapsed ? kids : undefined });
    if (!isCollapsed) visit(agent.id, depth + 1);
  };

  // Direct children of main are parentId-less; they start one level under the main row.
  visit(undefined, input.main ? 1 : 0);
  // Numbers follow the visible order, so a person can type `/agents 3` for the third row.
  rows.forEach((row, index) => { row.number = index + 1; });
  return rows;
}

export interface RowsRenderOptions {
  /** Visible rows before the `+N more agents` line. Default: 6. */
  maxRows?: number;
}

/** One display line for an agent, group or the main chat. Never wraps. */
export function renderAgentRow(row: AgentRow, theme: FabricTheme, width: number, options: { cursor?: boolean; last?: boolean } = {}): string {
  const marker = row.kind === "main" ? "◆" : row.kind === "group" ? (row.collapsed ? "▸" : "▾") : statusIcon[row.status];
  const name = row.kind === "main" ? theme.fg("accent", theme.bold("main")) : paintAgent(theme, row.hue, row.label);
  // A collapsed row says what it is hiding, so nothing disappears silently.
  const collapsedHint = row.collapsed && row.hiddenChildren ? `${row.hiddenChildren} hidden` : undefined;
  // Usage is the first thing to go when the row is narrow; it is the least urgent.
  const usage = width >= 100 && row.kind !== "group" ? row.usage : undefined;
  const detail = (row.kind === "group" ? [row.activity, row.counts ?? row.status] : [row.model, usage, row.activity])
    .concat(formatElapsed(row.elapsedMs), collapsedHint)
    .filter((part) => Boolean(part))
    .join(" · ");
  const branch = row.depth === 0 ? "" : `${"│  ".repeat(Math.max(0, row.depth - 1))}${options.last ? "└─" : "├─"} `;
  const cursor = options.cursor ? theme.fg("accent", "›") : "";
  const icon = theme.fg(row.kind === "main" ? "accent" : statusColor[row.status], marker);
  const number = row.number === undefined ? "" : theme.fg("dim", `${row.number}.`);
  return truncateToWidth(`${cursor}${number ? `${number} ` : ""}${theme.fg("dim", branch)}${icon} ${name} ${theme.fg("muted", `· ${detail}`)}`, width);
}

/**
 * Renders the rows below the prompt. Every line is bounded to `width`, the list
 * never wraps, and the tail collapses into a count so the editor keeps its space.
 */
export function renderAgentRows(rows: readonly AgentRow[], theme: FabricTheme, width: number, options: RowsRenderOptions = {}): string[] {
  if (width < 1 || rows.length === 0) return [];
  const maxRows = Math.max(1, options.maxRows ?? 6);
  const kept = rows.slice(0, maxRows);
  const lines = kept.map((row, index) => {
    const next = kept[index + 1];
    const last = !next || next.depth <= row.depth;
    return renderAgentRow(row, theme, width, { last });
  });
  if (rows.length > maxRows) {
    lines.push(truncateToWidth(theme.fg("dim", `+ ${rows.length - maxRows} more agent${rows.length - maxRows === 1 ? "" : "s"}`), width));
  }
  return lines.map((line) => truncateToWidth(line, width));
}

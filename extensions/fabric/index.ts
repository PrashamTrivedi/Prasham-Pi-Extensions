import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, renameSync, openSync, closeSync, readSync } from "node:fs";
import { clean, publishActivity, readActivity, readPreview } from "./activity.ts";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { LiveTeamInspectorOverlay, renderComparisonResultCard, TranscriptPickerOverlay, TranscriptViewerOverlay, type FabricAgentView, type FabricTheme, type ComparisonResult, type TranscriptSource } from "./ui.ts";
import { Type, type Static } from "typebox";

type AgentStatus = "queued" | "running" | "waiting" | "done" | "error" | "cancelled";

export type ModelRule = { id: string; rank: number; description?: string };
export type FabricConfig = { maxActiveAgents: number; models: Record<string, ModelRule> };
type FabricAgent = {
  id: string;
  parentId?: string;
  model: string;
  task: string;
  label: string;
  status: AgentStatus;
  cwd: string;
  worktree: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  pid?: number;
  /** Directory holding this run's saved session JSONL. */
  sessionDir?: string;
  /** Saved session file; the full-run viewer replays it. */
  sessionPath?: string;
  resultPath?: string;
  patchPath?: string;
  baseCommit?: string;
  error?: string;
};
export type FabricState = { rootId: string; repo: string; createdAt: string; config: FabricConfig; agents: Record<string, FabricAgent> };

const ENTRY_PATH = fileURLToPath(import.meta.url);
const LEGACY_CONFIG_PATH = join(dirname(ENTRY_PATH), "config.json");
const ROOT_ENV = "PI_FABRIC_ROOT";
const AGENT_ENV = "PI_FABRIC_AGENT";
const MODEL_ENV = "PI_FABRIC_MODEL";
const DEFAULT_CONFIG: FabricConfig = { maxActiveAgents: 6, models: {} };

const AgentRequest = Type.Object({
  model: Type.String({ description: "Configured model alias or model id. It must be the caller's model or lower-ranked." }),
  task: Type.String({ description: "A self-contained task with a clear deliverable." }),
  label: Type.Optional(Type.String({ description: "Short label shown in the Fabric dashboard." })),
});
const SpawnParams = Type.Object({
  agents: Type.Array(AgentRequest, { minItems: 1, description: "Agents to queue. They start as global slots become free." }),
});
type SpawnParams = Static<typeof SpawnParams>;
const AwaitParams = Type.Object({
  agentIds: Type.Optional(Type.Array(Type.String(), { description: "Child ids to wait for. Defaults to all direct children." })),
});
type AwaitParams = Static<typeof AwaitParams>;
const StatusParams = Type.Object({
  agentIds: Type.Optional(Type.Array(Type.String())),
  includeResults: Type.Optional(Type.Boolean({ default: false })),
});
type StatusParams = Static<typeof StatusParams>;
const CancelParams = Type.Object({ agentId: Type.String({ description: "An agent id. Its descendants are cancelled too." }) });
type CancelParams = Static<typeof CancelParams>;

function fabricDir(rootId: string) { return join(tmpdir(), "pi-fabric", rootId); }
function statePath(rootId: string) { return join(fabricDir(rootId), "state.json"); }
function lockPath(rootId: string) { return join(fabricDir(rootId), ".lock"); }
function outputDir(rootId: string) { return join(fabricDir(rootId), "outputs"); }
function sessionsDir(rootId: string) { return join(fabricDir(rootId), "sessions"); }

/** A finished run leaves the live views this long after `finishedAt`. */
export const PRUNE_AFTER_MS = 5 * 60_000;
/** Upper bound for a replayed transcript; the saved file keeps everything. */
export const TRANSCRIPT_LIMIT = 4_000_000;

/**
 * Pi names saved sessions `<timestamp>_<session-id>.jsonl`, so the file for a run
 * is found by suffix rather than by a predictable name. Newest match wins.
 */
export function resolveSessionFile(dir: string, agentId: string): string | undefined {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(`_${agentId}.jsonl`))
      .sort()
      .map((name) => join(dir, name))
      .at(-1);
  } catch { return undefined; }
}

/** True when a terminal agent is older than the prune window; display-only. */
export function isPruned(agent: { status: AgentStatus; finishedAt?: string }, now = Date.now(), pruneAfterMs = PRUNE_AFTER_MS): boolean {
  if (!terminal(agent.status) || !agent.finishedAt) return false;
  const finished = Date.parse(agent.finishedAt);
  return Number.isFinite(finished) && now - finished > pruneAfterMs;
}

/** Agents the live views list: everything except runs pruned from the pane. */
export function visibleAgents<T extends { status: AgentStatus; finishedAt?: string }>(agents: T[], now = Date.now(), pruneAfterMs = PRUNE_AFTER_MS): T[] {
  return agents.filter((agent) => !isPruned(agent, now, pruneAfterMs));
}

/**
 * `/transcript <query>` accepts a full id, an id prefix, or a label fragment.
 * Exact ids win over prefixes, which win over labels, so short ids stay usable.
 */
export function matchRuns<T extends { id: string; label: string }>(agents: readonly T[], query: string): T[] {
  const wanted = query.trim();
  if (!wanted) return [];
  const exact = agents.filter((agent) => agent.id === wanted);
  if (exact.length) return exact;
  const prefixed = agents.filter((agent) => agent.id.startsWith(wanted));
  if (prefixed.length) return prefixed;
  const needle = wanted.toLowerCase();
  const labelled = agents.filter((agent) => agent.label.toLowerCase().includes(needle));
  if (labelled.length) return labelled;
  return agents.filter((agent) => agent.id.includes(needle));
}

/**
 * Reads session bytes written since `offset`, returning only whole lines. A
 * trailing partial line is left for the next call, and cutting on a newline
 * keeps a multi-byte character from being split while decoding.
 */
export function readSessionChunk(path: string, offset: number): { chunk: string; next: number } {
  try {
    const size = statSync(path).size;
    if (size <= offset) return { chunk: "", next: offset };
    const buffer = Buffer.alloc(size - offset);
    const fd = openSync(path, "r");
    let read: number;
    try { read = readSync(fd, buffer, 0, buffer.length, offset); } finally { closeSync(fd); }
    const text = buffer.subarray(0, read).toString("utf8");
    const cut = text.lastIndexOf("\n");
    if (cut < 0) return { chunk: "", next: offset };
    const chunk = text.slice(0, cut + 1);
    return { chunk, next: offset + Buffer.byteLength(chunk, "utf8") };
  } catch { return { chunk: "", next: offset }; }
}

/** Reads a saved transcript for replay, bounded so a huge run cannot stall the viewer. */
export function readTranscript(path: string, limit = TRANSCRIPT_LIMIT): TranscriptSource {
  try {
    const text = readFileSync(path, "utf8");
    if (text.length <= limit) return { text };
    return { text: text.slice(0, limit), notice: `Transcript truncated to the first ${limit} characters; ${path} keeps the whole run.` };
  } catch (error) {
    return { text: "", notice: `Unable to read ${path}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export type ConfigResolution = { config: FabricConfig; path?: string; source: "env" | "user" | "legacy" | "default" };

function validateConfig(value: unknown, path: string): FabricConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Pi Fabric config at ${path} must be a JSON object.`);
  const input = value as { maxActiveAgents?: unknown; models?: unknown };
  const maxActiveAgents = input.maxActiveAgents ?? DEFAULT_CONFIG.maxActiveAgents;
  if (typeof maxActiveAgents !== "number" || !Number.isInteger(maxActiveAgents) || maxActiveAgents < 1) throw new Error(`Pi Fabric config at ${path}: maxActiveAgents must be a positive integer.`);
  const models = input.models ?? {};
  if (!models || typeof models !== "object" || Array.isArray(models)) throw new Error(`Pi Fabric config at ${path}: models must be an object.`);
  const checked: Record<string, ModelRule> = {};
  for (const [alias, raw] of Object.entries(models as Record<string, unknown>)) {
    if (!alias.trim() || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Pi Fabric config at ${path}: model '${alias}' must be an object.`);
    const rule = raw as { id?: unknown; rank?: unknown; description?: unknown };
    if (typeof rule.id !== "string" || !rule.id.trim()) throw new Error(`Pi Fabric config at ${path}: model '${alias}' needs a non-empty id.`);
    if (typeof rule.rank !== "number" || !Number.isFinite(rule.rank)) throw new Error(`Pi Fabric config at ${path}: model '${alias}' needs a finite numeric rank.`);
    if (rule.description !== undefined && typeof rule.description !== "string") throw new Error(`Pi Fabric config at ${path}: model '${alias}' description must be a string.`);
    checked[alias] = { id: rule.id, rank: rule.rank, ...(rule.description === undefined ? {} : { description: rule.description }) };
  }
  return { maxActiveAgents: maxActiveAgents as number, models: checked };
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env, home = homedir(), legacyPath = LEGACY_CONFIG_PATH): ConfigResolution {
  const explicit = env.PI_FABRIC_CONFIG;
  const userPath = join(home, ".pi", "agent", "pi-fabric.config.json");
  const selected = explicit ? { path: resolve(explicit), source: "env" as const }
    : existsSync(userPath) ? { path: userPath, source: "user" as const }
    : existsSync(legacyPath) ? { path: legacyPath, source: "legacy" as const }
    : undefined;
  if (!selected) return { config: DEFAULT_CONFIG, source: "default" };
  let raw: string;
  try { raw = readFileSync(selected.path, "utf8"); }
  catch (error) { throw new Error(`Unable to read Pi Fabric config at ${selected.path}: ${error instanceof Error ? error.message : String(error)}`); }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (error) { throw new Error(`Invalid JSON in Pi Fabric config at ${selected.path}: ${error instanceof Error ? error.message : String(error)}`); }
  return { config: validateConfig(parsed, selected.path), path: selected.path, source: selected.source };
}

function withLock<T>(rootId: string, fn: () => T): T {
  const dir = fabricDir(rootId);
  mkdirSync(dir, { recursive: true });
  const lock = lockPath(rootId);
  const deadline = Date.now() + 10_000;
  while (true) {
    try { mkdirSync(lock); break; }
    catch {
      if (Date.now() > deadline) throw new Error("Pi Fabric state is busy; retry the operation.");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { return fn(); } finally { rmSync(lock, { recursive: true, force: true }); }
}
function loadState(rootId: string): FabricState { return JSON.parse(readFileSync(statePath(rootId), "utf8")) as FabricState; }
function saveState(rootId: string, state: FabricState) {
  const file = statePath(rootId); const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2)); renameSync(temp, file);
}
function terminal(status: AgentStatus) { return status === "done" || status === "error" || status === "cancelled"; }
function short(id: string) { return id.slice(0, 6); }
export function modelRule(config: FabricConfig, model: string): [string, ModelRule] | undefined {
  const entries = Object.entries(config.models);
  const exact = entries.find(([alias, rule]) => alias === model || rule.id === model);
  if (exact) return exact;
  // Pi reports the active model as provider/id. Permit an unqualified configured id only when it is unambiguous.
  const bare = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : "";
  const matches = bare ? entries.filter(([, rule]) => !rule.id.includes("/") && rule.id === bare) : [];
  return matches.length === 1 ? matches[0] : undefined;
}
/**
 * Models absent from the hierarchy are unrestricted: as a caller an unrecorded
 * model may delegate anywhere, and as a child it may be spawned from any caller.
 * Ranks only order delegation between models the hierarchy names.
 */
const UNRANKED_CALLER_RANK = Number.MAX_SAFE_INTEGER;
const UNRANKED_CHILD_RANK = 0;

export function effectiveRule(config: FabricConfig, model: string): [string, ModelRule] | undefined {
  if (!model) return undefined;
  if (Object.keys(config.models).length === 0) return [model, { id: model, rank: UNRANKED_CHILD_RANK, description: "current model" }];
  return modelRule(config, model) ?? [model, { id: model, rank: UNRANKED_CALLER_RANK, description: "unrecorded" }];
}
export function requestedRule(config: FabricConfig, callerModel: string, requestedModel: string): [string, ModelRule] | undefined {
  if (Object.keys(config.models).length === 0) return requestedModel === callerModel ? [callerModel, { id: callerModel, rank: UNRANKED_CHILD_RANK }] : undefined;
  return modelRule(config, requestedModel) ?? [requestedModel, { id: requestedModel, rank: UNRANKED_CHILD_RANK, description: "unrecorded" }];
}

/**
 * A root outlives an edit to the hierarchy: sessions restore their root from a
 * `pi-fabric-root` entry and keep the config snapshotted when that root was made.
 * Re-applying the resolved config lets `/reload` after a hierarchy edit take effect
 * without starting a new session. Agents already recorded on the root are kept.
 */
export function reconcileRootConfig(state: FabricState, config: FabricConfig): FabricState {
  return JSON.stringify(state.config) === JSON.stringify(config) ? state : { ...state, config };
}
function currentModel(ctx: ExtensionContext): string {
  const fromEnv = process.env[MODEL_ENV];
  if (fromEnv) return fromEnv;
  const model = ctx.model as unknown as { id?: string; provider?: string } | undefined;
  return model?.provider && model.id ? `${model.provider}/${model.id}` : model?.id ?? "";
}
function shell(command: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv): string {
  return execFileSync(command, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Children keep a real session so the parent can replay the whole run. Without a
 * session directory the run stays ephemeral (`--no-session`).
 */
export function buildChildArgs(entryPath: string, model: string, instruction: string, session?: { dir: string; id: string }): string[] {
  const persistence = session ? ["--session-dir", session.dir, "--session-id", session.id] : ["--no-session"];
  return ["-p", ...persistence, "--approve", "--no-extensions", "--extension", entryPath, "--model", model, "--", instruction];
}

/** Capture every working-tree change relative to the launch commit without touching the worker's real index. */
export function capturePatch(worktree: string, baseline: string): string {
  const temp = mkdtempSync(join(tmpdir(), "pi-fabric-index-"));
  const index = join(temp, "index");
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    shell("git", ["read-tree", baseline], worktree, env);
    shell("git", ["add", "-A"], worktree, env);
    return shell("git", ["diff", "--cached", "--binary", "--no-ext-diff", baseline, "--"], worktree, env);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
function isGitRepo(cwd: string): boolean {
  try { return shell("git", ["rev-parse", "--show-toplevel"], cwd).trim().length > 0; } catch { return false; }
}
function rootRepo(cwd: string): string { return shell("git", ["rev-parse", "--show-toplevel"], cwd).trim(); }

function createRoot(cwd: string, config: FabricConfig): string {
  if (!isGitRepo(cwd)) throw new Error("Pi Fabric needs a Git repository so every agent can receive an isolated worktree.");
  const rootId = randomUUID();
  const dir = fabricDir(rootId);
  mkdirSync(outputDir(rootId), { recursive: true });
  const state: FabricState = { rootId, repo: rootRepo(cwd), createdAt: new Date().toISOString(), config, agents: {} };
  saveState(rootId, state);
  return rootId;
}

function startQueued(rootId: string): void {
  const launches: FabricAgent[] = withLock(rootId, () => {
    const state = loadState(rootId);
    const active = Object.values(state.agents).filter((agent) => agent.status === "running").length;
    const capacity = Math.max(0, state.config.maxActiveAgents - active);
    const selected = Object.values(state.agents).filter((agent) => agent.status === "queued").slice(0, capacity);
    const sessionDir = sessionsDir(rootId);
    if (selected.length) mkdirSync(sessionDir, { recursive: true });
    for (const agent of selected) {
      try {
        mkdirSync(join(fabricDir(rootId), "worktrees"), { recursive: true });
        const branch = `pi-fabric/${rootId.slice(0, 8)}/${agent.id.slice(0, 8)}`;
        agent.baseCommit = shell("git", ["rev-parse", "HEAD"], state.repo).trim();
        shell("git", ["worktree", "add", "-b", branch, agent.worktree, agent.baseCommit], state.repo);
        agent.sessionDir = sessionDir;
        agent.status = "running";
        agent.startedAt = new Date().toISOString();
      } catch (error) {
        agent.status = "error";
        agent.error = error instanceof Error ? error.message : String(error);
        agent.finishedAt = new Date().toISOString();
      }
    }
    saveState(rootId, state);
    return selected.filter((agent) => agent.status === "running");
  });

  for (const agent of launches) {
    const piBin = process.env.PI_FABRIC_PI_BIN ?? "pi";
    const instruction = [
      `You are Fabric agent ${agent.id}.`,
      `Your assigned task is: ${agent.task}`,
      "Work only in your assigned worktree. You may delegate with spawn_agents to an equal or lower-ranked model when it reduces uncertainty.",
      "If you delegate, call await_agents and use the returned evidence before finishing.",
      "Finish with a concise result packet: findings, changes, tests run, risks, and recommendation.",
    ].join("\n");
    const stderr = openSync(join(outputDir(rootId), `${agent.id}.stderr.log`), "a");
    const child = spawn(piBin, buildChildArgs(ENTRY_PATH, agent.model, instruction, agent.sessionDir ? { dir: agent.sessionDir, id: agent.id } : undefined), {
      cwd: agent.worktree,
      detached: true,
      stdio: ["ignore", "ignore", stderr],
      env: { ...process.env, [ROOT_ENV]: rootId, [AGENT_ENV]: agent.id, [MODEL_ENV]: agent.model },
    });
    closeSync(stderr);
    const failed = (reason: string) => {
      try {
        withLock(rootId, () => {
          const state = loadState(rootId); const stored = state.agents[agent.id];
          if (stored && !terminal(stored.status)) {
            stored.status = "error"; stored.error = reason; stored.finishedAt = new Date().toISOString();
            saveState(rootId, state);
          }
        });
        startQueued(rootId);
      } catch { /* Root may have been explicitly cleaned up. */ }
    };
    child.on("error", (error) => failed(error.message));
    child.on("exit", (code, signal) => failed(`Worker exited before saving a result (code ${code}, signal ${signal ?? "none"}). See ${agent.id}.stderr.log.`));
    child.unref();
    withLock(rootId, () => {
      const state = loadState(rootId);
      const stored = state.agents[agent.id];
      if (stored) { stored.pid = child.pid; stored.sessionPath = stored.sessionPath ?? resolveSessionFile(sessionsDir(rootId), agent.id); saveState(rootId, state); }
    });
  }
}

function directChildren(state: FabricState, parentId?: string): FabricAgent[] {
  return Object.values(state.agents).filter((agent) => agent.parentId === parentId);
}
function treeLines(state: FabricState, parentId: string | undefined, theme?: { fg: (color: "success" | "error" | "warning" | "accent" | "muted" | "dim", text: string) => string }, indent = "", include: (agent: FabricAgent) => boolean = () => true): string[] {
  const children = directChildren(state, parentId).filter(include);
  const lines: string[] = [];
  for (const [index, agent] of children.entries()) {
    const last = index === children.length - 1;
    const icon = agent.status === "done" ? "✓" : agent.status === "error" || agent.status === "cancelled" ? "×" : agent.status === "waiting" ? "◌" : agent.status === "running" ? "●" : "○";
    const color = agent.status === "done" ? "success" : agent.status === "error" || agent.status === "cancelled" ? "error" : agent.status === "running" ? "accent" : "warning";
    const line = `${indent}${last ? "└─" : "├─"} ${icon} ${agent.label} ${short(agent.id)}  ${agent.model}  ${agent.status}`;
    lines.push(theme ? theme.fg(color, line) : line);
    lines.push(...treeLines(state, agent.id, theme, `${indent}${last ? "   " : "│  "}`, include));
  }
  return lines;
}
function summary(state: FabricState): string {
  const values = Object.values(state.agents);
  const count = (status: AgentStatus) => values.filter((agent) => agent.status === status).length;
  return `${count("running")} running · ${count("waiting")} waiting · ${count("queued")} queued · ${count("done")} done · ${count("error") + count("cancelled")} stopped`;
}
function resultText(agent: FabricAgent): string {
  if (!agent.resultPath || !existsSync(agent.resultPath)) return agent.error ?? "No result packet yet.";
  return readFileSync(agent.resultPath, "utf8");
}

/**
 * Rows a full-window custom screen may draw. Pi keeps its own footer below the
 * screen: cwd/branch, context+model, and one status row (every extension status
 * shares that row). Filling the whole terminal scrolls the first rows out of view.
 */
const PI_FOOTER_ROWS = 3;
function windowHeight(rows: number): number { return Math.max(8, rows - PI_FOOTER_ROWS); }

/** Draws a full-window overlay body inside the same frame the inspector uses. */
function framedOverlayLines(theme: { fg: (color: any, text: string) => string; bg: (color: any, text: string) => string }, width: number, body: readonly string[]): string[] {
  const inner = Math.max(1, width - 4);
  const border = theme.fg("borderAccent", "─".repeat(Math.max(0, width - 2)));
  const row = (line: string) => {
    const clipped = truncateToWidth(line, inner);
    return truncateToWidth(theme.bg("customMessageBg", theme.fg("borderAccent", "│") + " " + clipped + " ".repeat(Math.max(0, inner - visibleWidth(clipped))) + " " + theme.fg("borderAccent", "│")), width);
  };
  return [
    truncateToWidth(theme.bg("customMessageBg", theme.fg("borderAccent", "┌") + border + theme.fg("borderAccent", "┐")), width),
    row(""),
    ...body.map(row),
    row(""),
    truncateToWidth(theme.bg("customMessageBg", theme.fg("borderAccent", "└") + border + theme.fg("borderAccent", "┘")), width),
  ];
}

export default function piFabric(pi: ExtensionAPI) {
  // Resolve once per process. An explicitly selected, unreadable, or malformed config is fatal instead of silently changing policy.
  const configResolution = resolveConfig();
  if (configResolution.source === "env" && configResolution.path) process.env.PI_FABRIC_CONFIG = configResolution.path;
  let rootId = process.env[ROOT_ENV] ?? "";
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let statusVisible = true;
  // Fabric no longer renders a widget; clear one left by an older load of this extension.
  let widgetCleared = false;
  const recorded = new Set<string>();

  function views(agents: FabricAgent[], includePatch = false): FabricAgentView[] {
    return agents.map(agent => {
      const activity = readActivity(fabricDir(rootId), agent.id);
      return { ...agent, label: clean(agent.label, 150), task: clean(agent.task, 1000),
        model: agent.model.split("/").pop()!, error: agent.error ? clean(agent.error) : undefined,
        activity: activity.items.at(-1)?.text.split("\n")[0],
        events: activity.items.map(item => `${item.at.slice(11, 19)} · ${item.kind === "finding" ? "Agent reports" : item.kind}\n${item.text}`).join("\n\n"),
        tools: activity.items.filter(item => item.kind === "tool" || item.kind === "error").map(item => `${item.at.slice(11, 19)} ${item.text}`).join("\n"),
        result: readPreview(agent.resultPath) || activity.items.filter(item => item.kind === "finding").at(-1)?.text,
        patch: includePatch ? readPreview(agent.patchPath) : undefined,
      };
    });
  }
  function comparison(agents: FabricAgentView[], theme: FabricTheme, expanded = false, title = "◆ FABRIC · Parallel results") {
    return { invalidate() {}, render(width: number) {
      if (!agents.length) return [truncateToWidth("No child agents.", width)];
      const card = (agent: FabricAgentView): ComparisonResult => ({ label: `${agent.label} · ${agent.status}`,
        status: agent.status === "done" ? "success" : agent.status === "error" ? "error" : "neutral",
        summary: agent.result || agent.error || agent.activity || "Awaiting evidence…",
        details: agent.patchPath ? `Patch: ${agent.patchPath}` : agent.task,
        metrics: { model: agent.model, evidence: "agent-reported" },
      });
      const visible = expanded ? agents : agents.slice(0, 2);
      const lines: string[] = [];
      for (let i = 0; i < visible.length; i += 2) {
        lines.push(...renderComparisonResultCard({ title: i === 0 ? title : undefined,
          left: card(visible[i]!), right: visible[i + 1] ? card(visible[i + 1]!) : { label: "Evidence", summary: "Review reported findings and saved patches before integration. /team opens the live inspector." },
          maxBodyLines: expanded ? 12 : 6 }, theme, width));
      }
      if (agents.length > visible.length) lines.push(truncateToWidth(`+ ${agents.length - visible.length} more · expand tool output or open /team`, width));
      return lines;
    } };
  }

  /** Every run the transcript paths can reach, newest first (pruned runs included). */
  function orderedRuns(): FabricAgentView[] {
    if (!rootId || !existsSync(statePath(rootId))) return [];
    let agents: FabricAgent[];
    try { agents = Object.values(loadState(rootId).agents); } catch { return []; }
    const dir = sessionsDir(rootId);
    return views(agents)
      .map((agent, index) => ({
        // Fill in a missing link so the list honestly says whether a transcript can open.
        agent: agent.sessionPath || !resolveSessionFile(dir, agent.id) ? agent : { ...agent, sessionPath: resolveSessionFile(dir, agent.id) },
        key: agent.finishedAt ?? agent.startedAt ?? agents[index]!.createdAt,
      }))
      .sort((a, b) => b.key.localeCompare(a.key))
      .map((item) => item.agent);
  }

  /** Resolves a run's saved session file, falling back to a suffix lookup for older runs. */
  function transcriptOf(agentId: string): { agent: FabricAgent; path: string } | undefined {
    if (!rootId || !existsSync(statePath(rootId))) return undefined;
    let agent: FabricAgent | undefined;
    try { agent = loadState(rootId).agents[agentId]; } catch { return undefined; }
    if (!agent) return undefined;
    const path = agent.sessionPath ?? resolveSessionFile(sessionsDir(rootId), agentId);
    return path && existsSync(path) ? { agent, path } : undefined;
  }

  /**
   * Replays a run's transcript as a full-window screen inside Pi (not an overlay).
   * The screen owns the interactive area, so the run fills the window instead of
   * sharing it with the chat.
   */
  async function showTranscript(ctx: ExtensionContext, agentId: string): Promise<void> {
    const found = transcriptOf(agentId);
    if (!found) {
      ctx.ui.notify("This run has no saved transcript yet. Fabric saves one when the child starts working.", "warning");
      return;
    }
    if (ctx.mode !== "tui") {
      ctx.ui.notify(`A transcript needs the interactive UI. Saved session: ${found.path}`, "info");
      return;
    }
    const heading = (current: FabricAgent) => `${current.label} · ${short(current.id)} · ${current.model} · ${current.status}`;
    const initial = readTranscript(found.path);
    // Follow from the last complete line so a run mid-write is not skipped; a
    // truncated first load is final and stops following.
    let cursor = Buffer.byteLength(initial.text.slice(0, initial.text.lastIndexOf("\n") + 1), "utf8");
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      await ctx.ui.custom((tui, theme, _keys, done) => {
        const viewer = new TranscriptViewerOverlay({
          theme,
          title: heading(found.agent),
          maxRows: Math.max(3, windowHeight(tui.terminal.rows) - 6),
          onClose: () => done(undefined),
        });
        viewer.setSource(initial);
        let lastTitle = heading(found.agent);
        timer = setInterval(() => {
          try {
            const latest = rootId ? loadState(rootId).agents[agentId] : undefined;
            if (latest) {
              const next = heading(latest);
              if (next !== lastTitle) { lastTitle = next; viewer.setTitle(next); tui.requestRender(); }
            }
            if (initial.notice) return;
            // Read only what was appended, and parse only those lines: following a
            // live run must not re-read or re-parse the whole session every second.
            const read = readSessionChunk(found.path, cursor);
            if (!read.chunk) return;
            cursor = read.next;
            if (viewer.appendText(read.chunk)) tui.requestRender();
          } catch { /* Keep the last transcript that rendered. */ }
        }, 1000);
        return {
          invalidate: () => viewer.invalidate(),
          handleInput: (input: string) => viewer.handleInput(input),
          render: (width: number) => {
            // Fill the screen's rows exactly: a non-overlay custom screen owns the interactive area.
            const height = windowHeight(tui.terminal.rows);
            viewer.setHeight(height);
            const lines = viewer.render(width);
            return lines.length >= height ? lines.slice(0, height) : [...lines, ...Array<string>(height - lines.length).fill("")];
          },
        };
      });
    } finally { if (timer) clearInterval(timer); }
  }

  /** The picker path: no `/team` round trip, and Esc from a transcript returns to the list. */
  async function pickTranscript(ctx: ExtensionContext): Promise<void> {
    while (true) {
      const runs = orderedRuns();
      if (!runs.length) {
        ctx.ui.notify("Pi Fabric has no runs in this session yet. Spawn agents, then reopen this list.", "info");
        return;
      }
      let chosen: string | undefined;
      let timer: ReturnType<typeof setInterval> | undefined;
      try {
        chosen = await ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => {
          const picker = new TranscriptPickerOverlay({
            theme,
            runs,
            maxRows: Math.max(3, Math.floor(tui.terminal.rows * 0.6)),
            onOpen: (run) => done(run.id),
            onClose: () => done(undefined),
          });
          timer = setInterval(() => { try { picker.setRuns(orderedRuns()); tui.requestRender(); } catch { /* Keep the last list. */ } }, 1000);
          return {
            invalidate: () => picker.invalidate(),
            handleInput: (input: string) => picker.handleInput(input),
            render: (width: number) => framedOverlayLines(theme, width, picker.render(Math.max(1, width - 4))),
          };
        }, { overlay: true, overlayOptions: { width: "84%", maxHeight: "70%" } });
      } finally { if (timer) clearInterval(timer); }
      if (!chosen) return;
      await showTranscript(ctx, chosen);
    }
  }
  function ensureRoot(ctx: ExtensionContext): string {
    // Drop a restore whose state was cleaned up, then re-apply the resolved policy
    // so a reload after a config edit is honoured by the existing root.
    if (rootId && !existsSync(statePath(rootId))) rootId = "";
    if (!rootId) {
      rootId = createRoot(ctx.cwd, configResolution.config);
      pi.appendEntry("pi-fabric-root", { rootId });
    } else {
      try {
        const state = loadState(rootId);
        const reconciled = reconcileRootConfig(state, configResolution.config);
        if (reconciled !== state) saveState(rootId, reconciled);
      } catch { /* leave the root untouched; a missing or corrupt state is replaced on next createRoot */ }
    }
    startRefresh(ctx);
    return rootId;
  }
  function startRefresh(ctx: ExtensionContext) {
    if (refreshTimer || activeAgentId() || ctx.mode !== "tui") return;
    refreshTimer = setInterval(() => { try { updateUI(ctx); } catch { /* Retry next tick; never interrupt editing. */ } }, 750);
  }
  function updateUI(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui" || activeAgentId()) return;
    if (!rootId || !existsSync(statePath(rootId))) { ctx.ui.setStatus("pi-fabric", undefined); return; }
    const state = loadState(rootId);
    const agents = Object.values(state.agents);
    if (!widgetCleared) { ctx.ui.setWidget("pi-fabric", undefined); widgetCleared = true; }
    // The status line is the only persistent Fabric surface; finished runs leave it after the prune window.
    const archived = agents.length - visibleAgents(agents).length;
    const running = summary(state).split(" · ")[0];
    const label = archived ? `◆ fabric ${running} · ${archived} archived` : `◆ fabric ${running}`;
    ctx.ui.setStatus("pi-fabric", statusVisible && agents.length ? ctx.ui.theme.fg("accent", label) : undefined);
    // Result entries are recorded for every run, including ones already pruned from the views.
    for (const agent of agents) {
      if (!terminal(agent.status) || recorded.has(agent.id)) continue;
      recorded.add(agent.id);
      pi.appendEntry("pi-fabric-result", { rootId, agents: views([agent]), agentId: agent.id });
    }
  }
  pi.registerEntryRenderer<{ agents: FabricAgentView[] }>("pi-fabric-result", (entry, options, theme) => comparison(entry.data?.agents ?? [], theme, options.expanded, "◆ FABRIC · Saved result"));
  function activeAgentId(): string | undefined { return process.env[AGENT_ENV]; }
  /** Records the child's own session file (authoritative, available before it finishes). */
  function rememberSessionPath(root: string, agentId: string, sessionPath?: string): void {
    if (!sessionPath) return;
    try {
      withLock(root, () => {
        const state = loadState(root);
        const agent = state.agents[agentId];
        if (!agent || agent.sessionPath === sessionPath) return;
        agent.sessionPath = sessionPath;
        agent.sessionDir = dirname(sessionPath);
        saveState(root, state);
      });
    } catch { /* Best effort: a missing root or a busy lock only delays the transcript link; the run is unaffected. */ }
  }
  function cancelTree(root: string, agentId: string): string[] {
    const cancelled = withLock(root, () => {
      const state = loadState(root); const rootAgent = state.agents[agentId];
      if (!rootAgent) throw new Error(`Unknown agent ${agentId}.`);
      const ids = new Set<string>([rootAgent.id]); let changed = true;
      while (changed) { changed = false; for (const agent of Object.values(state.agents)) if (agent.parentId && ids.has(agent.parentId) && !ids.has(agent.id)) { ids.add(agent.id); changed = true; } }
      for (const id of ids) {
        const agent = state.agents[id];
        if (!terminal(agent.status)) {
          if (agent.pid) try { process.kill(agent.pid, "SIGTERM"); } catch { /* already exited */ }
          agent.status = "cancelled"; agent.finishedAt = new Date().toISOString();
        }
      }
      saveState(root, state); return [...ids];
    });
    startQueued(root);
    return cancelled;
  }

  pi.on("session_start", (_event, ctx) => {
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom") continue;
      const data = entry.data as { rootId?: string; agentId?: string } | undefined;
      if (entry.customType === "pi-fabric-root" && !activeAgentId() && data?.rootId && existsSync(statePath(data.rootId))) rootId = data.rootId;
      if (entry.customType === "pi-fabric-result" && data?.agentId) recorded.add(data.agentId);
    }
    // A child records its own saved session immediately, so the parent can replay a run that is still working.
    const childId = activeAgentId();
    if (rootId && childId) rememberSessionPath(rootId, childId, ctx.sessionManager.getSessionFile?.());
    if (!rootId) return;
    updateUI(ctx); startRefresh(ctx);
  });
  pi.on("session_shutdown", () => { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = undefined; });

  function activity(kind: "activity" | "finding" | "tool" | "error", text: string) {
    const id = activeAgentId();
    if (rootId && id) publishActivity(fabricDir(rootId), id, kind, text);
  }
  pi.on("agent_start", () => activity("activity", "Working on assigned task"));
  pi.on("tool_execution_start", (event) => {
    // Only display a safe label, not arbitrary tool arguments or secrets.
    activity("activity", `Running ${event.toolName}`);
  });
  pi.on("tool_execution_end", (event) => {
    const result = event.result as { details?: { exitCode?: number } } | undefined;
    const exit = result?.details?.exitCode;
    activity(event.isError ? "error" : "tool", `${event.toolName}: ${event.isError ? "failed" : "completed"}${typeof exit === "number" ? ` (exit ${exit})` : ""}`);
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const text = event.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    if (text.trim()) activity("finding", text);
  });

  pi.on("before_agent_start", (_event, ctx) => {
    if (!rootId) return;
    const state = loadState(rootId);
    const activeModel = currentModel(ctx);
    const caller = effectiveRule(state.config, activeModel);
    const configured = Object.entries(state.config.models).map(([alias, rule]) => `${alias} (rank ${rule.rank})`).join(", ");
    const policy = configured ? `Model hierarchy: ${configured}` : `No hierarchy is configured; children must use the same current model (${activeModel || "unknown"})`;
    return { systemPrompt: `${ctx.getSystemPrompt()}\n\nPI FABRIC is available. ${policy}. You are ${(caller?.[0] ?? activeModel) || "an unranked root"}. Use spawn_agents only for independent, high-uncertainty work. Children may use their own model or a lower-ranked configured model. There are no turn or time limits; capacity is controlled only by the global active-agent limit. If you spawn agents, use await_agents before presenting a conclusion. Inspect returned patches/evidence; do not blindly trust them.` };
  });

  pi.on("agent_settled", (_event, ctx) => {
    const agentId = activeAgentId();
    if (!rootId || !agentId || !existsSync(statePath(rootId))) return;
    withLock(rootId, () => {
      const state = loadState(rootId);
      const agent = state.agents[agentId];
      if (!agent || terminal(agent.status)) return;
      const messages = ctx.sessionManager.getBranch() as Array<{ type?: string; message?: { role?: string; content?: Array<{ type?: string; text?: string }> } }>;
      const lastAssistant = [...messages].reverse().find((entry) => entry.message?.role === "assistant")?.message;
      const response = lastAssistant?.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n") ?? "(Agent settled without a text response.)";
      mkdirSync(outputDir(rootId), { recursive: true });
      // Settling is the last chance for a child to link its saved transcript.
      agent.sessionPath = ctx.sessionManager.getSessionFile?.() ?? agent.sessionPath ?? resolveSessionFile(sessionsDir(rootId), agentId);
      if (agent.sessionPath) agent.sessionDir = dirname(agent.sessionPath);
      agent.resultPath = join(outputDir(rootId), `${agentId}.md`);
      agent.patchPath = join(outputDir(rootId), `${agentId}.patch`);
      writeFileSync(agent.resultPath, response);
      try { writeFileSync(agent.patchPath, capturePatch(agent.worktree, agent.baseCommit ?? "HEAD")); }
      catch (error) { agent.error = error instanceof Error ? error.message : String(error); }
      agent.status = "done";
      agent.finishedAt = new Date().toISOString();
      saveState(rootId, state);
    });
    startQueued(rootId);
  });

  pi.registerTool({
    name: "spawn_agents", label: "Spawn Agents",
    description: "Queue recursively-delegated Pi agents in isolated Git worktrees. A child model must be equal to or lower-ranked than the calling model. No timeout or turn cap is applied; a shared active-agent limit schedules queued work.",
    promptSnippet: "Delegate independent, high-uncertainty work to isolated recursive Pi agents",
    promptGuidelines: ["Use spawn_agents only when parallel investigation or implementation is meaningfully useful. After spawn_agents, use await_agents before drawing conclusions."],
    parameters: SpawnParams,
    async execute(_id, params, _signal, _update, ctx) {
      const root = ensureRoot(ctx);
      const created = withLock(root, () => {
        const state = loadState(root);
        const callerModel = currentModel(ctx);
        const caller = effectiveRule(state.config, callerModel);
        if (!caller) throw new Error("Pi Fabric cannot determine the current model; run spawn_agents from a session with an active model.");
        const parentId = activeAgentId();
        const agents: FabricAgent[] = [];
        for (const request of params.agents) {
          const child = requestedRule(state.config, callerModel, request.model);
          if (!child) throw new Error(`No Fabric model hierarchy is configured; child model must exactly match the current model '${callerModel}'.`);
          if (child[1].rank > caller[1].rank) throw new Error(`${caller[0]} cannot spawn higher-ranked ${child[0]}.`);
          const id = randomUUID();
          const label = request.label?.trim() || request.task.replace(/\s+/g, " ").slice(0, 42);
          const worktree = join(fabricDir(root), "worktrees", `${child[0]}-${id.slice(0, 8)}`);
          const agent: FabricAgent = { id, parentId, model: child[1].id, task: request.task, label, status: "queued", cwd: ctx.cwd, worktree, createdAt: new Date().toISOString() };
          state.agents[id] = agent;
          agents.push(agent);
        }
        saveState(root, state);
        return agents;
      });
      startQueued(root);
      updateUI(ctx);
      return { content: [{ type: "text", text: `Queued ${created.length} Fabric agent(s): ${created.map((agent) => `${agent.label} [${short(agent.id)}]`).join(", ")}. Use await_agents when their evidence is needed.` }], details: { rootId: root, agents: created } };
    },
    renderCall(args, theme) { return new Text(theme.fg("accent", `◆ fabric spawn  ${args.agents.length} agent${args.agents.length === 1 ? "" : "s"}`), 0, 0); },
    renderResult(result, _options, theme) { const details = result.details as { agents?: FabricAgent[] }; return new Text((details.agents ?? []).map((agent) => `${theme.fg("warning", "○")} ${theme.fg("accent", agent.label)} ${theme.fg("dim", `${short(agent.id)} · ${agent.model}`)}`).join("\n"), 0, 0); },
  });

  pi.registerTool({
    name: "await_agents", label: "Await Agents", description: "Wait for direct child agents to reach terminal states and return their result packets and patch paths. Waiting parents release a Fabric execution slot so descendants can run.",
    parameters: AwaitParams,
    async execute(_id, params, signal, onUpdate, ctx) {
      const root = ensureRoot(ctx); const parentId = activeAgentId();
      let ids = params.agentIds;
      if (!ids) { const state = loadState(root); ids = directChildren(state, parentId).map((agent) => agent.id); }
      if (ids.length === 0) return { content: [{ type: "text", text: "No matching child agents." }], details: {} };
      if (parentId) withLock(root, () => { const state = loadState(root); if (state.agents[parentId] && !terminal(state.agents[parentId].status)) { state.agents[parentId].status = "waiting"; saveState(root, state); } });
      startQueued(root);
      while (!signal?.aborted) {
        const state = loadState(root); const selected = ids.map((agentId) => state.agents[agentId]).filter((agent): agent is FabricAgent => Boolean(agent));
        onUpdate?.({ content: [{ type: "text", text: `Fabric: ${selected.filter((agent) => terminal(agent.status)).length}/${selected.length} child agents finished…` }], details: { agents: selected, ui: views(selected) } });
        if (selected.every((agent) => terminal(agent.status))) {
          if (parentId) withLock(root, () => { const next = loadState(root); if (next.agents[parentId]?.status === "waiting") { next.agents[parentId].status = "running"; saveState(root, next); } });
          const packets = selected.map((agent) => `## ${agent.label} [${short(agent.id)}] — ${agent.status}\nResult: ${agent.resultPath ?? "none"}\nPatch: ${agent.patchPath ?? "none"}\n\n${resultText(agent)}`).join("\n\n---\n\n");
          updateUI(ctx);
          return { content: [{ type: "text", text: packets }], details: { rootId: root, agents: selected, ui: views(selected) } };
        }
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      throw new Error("Waiting for Fabric agents was cancelled.");
    },
    renderResult(result, options, theme) {
      const details = result.details as { ui?: FabricAgentView[]; agents?: FabricAgent[] } | undefined;
      return comparison(details?.ui ?? details?.agents ?? [], theme, options.expanded,
        options.isPartial ? "◆ FABRIC · Live comparison" : "◆ FABRIC · Results ready");
    },
  });

  pi.registerTool({
    name: "agent_status", label: "Agent Status", description: "Inspect the Pi Fabric agent tree, statuses, result paths, and optionally result packets.", parameters: StatusParams,
    async execute(_id, params, _signal, _update, ctx) {
      const root = ensureRoot(ctx); const state = loadState(root);
      const selected = params.agentIds ? params.agentIds.map((id) => state.agents[id]).filter((agent): agent is FabricAgent => Boolean(agent)) : Object.values(state.agents);
      const body = params.includeResults ? selected.map((agent) => `## ${agent.label} — ${agent.status}\n${resultText(agent)}`).join("\n\n") : [summary(state), ...treeLines(state, undefined)].join("\n");
      // Pruning only hides finished runs from the live /team views; forensics stay complete here.
      const archived = Object.values(state.agents).filter((agent) => isPruned(agent)).length;
      const note = archived ? `\n\n${archived} finished agent(s) are hidden from the live /team views (pruned ${PRUNE_AFTER_MS / 60_000} minutes after finishing). They stay listed here and their transcripts stay on disk.` : "";
      return { content: [{ type: "text", text: (body || "Fabric has no delegated agents yet.") + note }], details: { rootId: root, agents: selected } };
    },
  });

  pi.registerTool({
    name: "cancel_agents", label: "Cancel Agents", description: "Cancel a Pi Fabric agent and its complete descendant tree. Worktrees and patches are preserved for inspection.", parameters: CancelParams,
    async execute(_id, params, _signal, _update, ctx) {
      const root = ensureRoot(ctx); const cancelled = cancelTree(root, params.agentId);
      updateUI(ctx);
      return { content: [{ type: "text", text: `Cancelled ${cancelled.length} Fabric agent(s). Their worktrees remain available for inspection.` }], details: { agentIds: cancelled } };
    },
  });

  pi.registerCommand("team", {
    description: "Show the Pi Fabric recursive agent team dashboard",
    handler: async (args, ctx) => {
      const root = ensureRoot(ctx);
      const command = args.trim();
      if (command === "hide" || command === "show") { statusVisible = command === "show"; updateUI(ctx); return; }
      if (command === "status") { updateUI(ctx); ctx.ui.notify(summary(loadState(root)), "info"); return; }
      const match = command.match(/^cancel\s+(.+)$/);
      if (match) { const cancelled = cancelTree(root, match[1]); updateUI(ctx); ctx.ui.notify(`Cancelled ${cancelled.length} Fabric agent(s).`, "info"); return; }
      if (command && command !== "all") {
        ctx.ui.notify("Usage: /team | /team all | /team status | /team hide | /team show | /team cancel <agent-id> · /transcript [id|label] opens a full run", "info");
        return;
      }
      // Pruning is display-only: `all` (or `a` in the inspector) lists finished runs from the same state file.
      let showAll = command === "all";
      updateUI(ctx);
      const listed = () => {
        const agents = Object.values(loadState(root).agents);
        return showAll ? agents : visibleAgents(agents);
      };
      if (ctx.mode !== "tui") {
        const state = loadState(root);
        ctx.ui.notify([summary(state), ...treeLines(state, undefined, undefined, "", (agent) => showAll || !isPruned(agent))].join("\n"), "info");
        return;
      }

      // Esc in the transcript returns to the inspector; Esc there closes the dashboard.
      let timer: ReturnType<typeof setInterval> | undefined;
      try {
        while (true) {
          const chosen = await ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => {
            const data = () => ({
              agents: views(listed(), true),
              maxRows: Math.max(3, Math.floor(tui.terminal.rows * 0.8) - 10),
              title: showAll ? "◆ PI FABRIC — live team · all runs" : "◆ PI FABRIC — live team",
            });
            const inspector = new LiveTeamInspectorOverlay({
              theme,
              data: data(),
              onChange: () => tui.requestRender(),
              onClose: () => done(undefined),
              onOpen: (agent) => done(agent.id),
              onToggleFilter: () => { showAll = !showAll; inspector.setData(data()); tui.requestRender(); },
            });
            timer = setInterval(() => { try { inspector.setData(data()); tui.requestRender(); } catch { /* Keep last valid snapshot. */ } }, 750);
            return {
              invalidate: () => inspector.invalidate(),
              handleInput: (input: string) => inspector.handleInput(input),
              render: (width: number) => framedOverlayLines(theme, width, inspector.render(Math.max(1, width - 4))),
            };
          }, { overlay: true, overlayOptions: { width: "95%", maxHeight: "90%" } });
          if (timer) { clearInterval(timer); timer = undefined; }
          if (!chosen) return;
          // Full-window replay (no overlay): Esc there returns to this inspector.
          await showTranscript(ctx, chosen);
        }
      } finally { if (timer) clearInterval(timer); }
    },
  });

  // Transcripts are reachable without opening the team dashboard (alt+t opens the same picker).
  pi.registerCommand("transcript", {
    description: "Open a Fabric run's full transcript; with no argument, list every run",
    handler: async (args, ctx) => {
      if (!rootId || !existsSync(statePath(rootId))) {
        ctx.ui.notify("Pi Fabric has no runs in this session yet.", "info");
        return;
      }
      const wanted = args.trim();
      if (!wanted) { await pickTranscript(ctx); return; }
      const matches = matchRuns(Object.values(loadState(rootId).agents), wanted);
      if (!matches.length) { ctx.ui.notify(`No Fabric run matches '${wanted}'.`, "warning"); return; }
      if (matches.length > 1) {
        ctx.ui.notify(`'${wanted}' matches ${matches.length} runs: ${matches.map((agent) => `${agent.label} [${short(agent.id)}]`).join(", ")}`, "info");
        return;
      }
      await showTranscript(ctx, matches[0]!.id);
    },
  });
  pi.registerShortcut("alt+t", { description: "Open a Fabric run transcript", handler: async (ctx) => { await pickTranscript(ctx); } });
}

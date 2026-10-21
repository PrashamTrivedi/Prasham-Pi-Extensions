import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, renameSync, openSync, closeSync, readSync } from "node:fs";
import { clean, publishActivity, readActivity, readPreview } from "./activity.ts";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { AgentTranscriptOverlay, AgentsScreen, renderComparisonResultCard, type FabricAgentView, type FabricTheme, type ComparisonResult, type TranscriptPaneSpec, type TranscriptSource } from "./ui.ts";
import { assignHues, buildTree, renderAgentRows, type AgentRow, type AgentSnapshot } from "./agents.ts";
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
  /** One id per spawn call, so sibling agents compare as a group. */
  batchId?: string;
  resultPath?: string;
  patchPath?: string;
  baseCommit?: string;
  error?: string;
};
export type FabricState = { rootId: string; repo: string; createdAt: string; config: FabricConfig; agents: Record<string, FabricAgent> };

const ENTRY_PATH = fileURLToPath(import.meta.url);
const LEGACY_CONFIG_PATH = join(dirname(ENTRY_PATH), "config.json");
const ROOT_ENV = "PI_FABRIC_ROOT";
/** Widget key for the agent rows below the prompt. */
const AGENTS_WIDGET = "pi-fabric-agents";
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

/** An agent that stays idle this long leaves the rows and `/agents`. */
export const IDLE_GONE_MS = 10 * 60_000;
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

/** True when a terminal agent has been idle past the window; display-only. */
export function isGone(agent: { status: AgentStatus; finishedAt?: string }, now = Date.now(), idleMs = IDLE_GONE_MS): boolean {
  if (!terminal(agent.status) || !agent.finishedAt) return false;
  const finished = Date.parse(agent.finishedAt);
  return Number.isFinite(finished) && now - finished > idleMs;
}

/** Agents the live surfaces show: everything except ones that went idle. */
export function liveAgents<T extends { status: AgentStatus; finishedAt?: string }>(agents: T[], now = Date.now(), idleMs = IDLE_GONE_MS): T[] {
  return agents.filter((agent) => !isGone(agent, now, idleMs));
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
/** Pads or trims a screen to exactly the window height, so nothing scrolls off. */
function fitScreen(lines: readonly string[], height: number, width: number): string[] {
  const sized = lines.length >= height ? lines.slice(0, height) : [...lines, ...Array<string>(height - lines.length).fill("")];
  return sized.map((line) => truncateToWidth(line, width));
}

export default function piFabric(pi: ExtensionAPI) {
  // Resolve once per process. An explicitly selected, unreadable, or malformed config is fatal instead of silently changing policy.
  const configResolution = resolveConfig();
  if (configResolution.source === "env" && configResolution.path) process.env.PI_FABRIC_CONFIG = configResolution.path;
  let rootId = process.env[ROOT_ENV] ?? "";
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  const recorded = new Set<string>();
  // The coordinator chat is an agent too: rows and `/agents` show it beside its children.
  const sessionStartedAt = new Date().toISOString();
  let mainBusy = false;
  let mainActivity = "";
  let runningActivity = "";
  /** Agent ids whose descendants are hidden in `/agents`. */
  const collapsed = new Set<string>();
  /** Group ids whose members are listed; spawn batches stay one row until expanded. */
  const expandedGroups = new Set<string>();
  /** Depth of open full-window screens; while any is open the rows release their space. */
  let screenDepth = 0;

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
          left: card(visible[i]!), right: visible[i + 1] ? card(visible[i + 1]!) : { label: "Evidence", summary: "Review reported findings and saved patches before integration. `/agents` opens any run." },
          maxBodyLines: expanded ? 12 : 6 }, theme, width));
      }
      if (agents.length > visible.length) lines.push(truncateToWidth(`+ ${agents.length - visible.length} more · expand the tool output or open /agents`, width));
      return lines;
    } };
  }

  /** Session files by agent id, read once per call instead of once per agent. */
  function sessionIndex(): Map<string, string> {
    const index = new Map<string, string>();
    if (!rootId) return index;
    try {
      for (const name of readdirSync(sessionsDir(rootId))) {
        const match = name.match(/_([0-9a-f-]{36})\.jsonl$/i);
        if (match) index.set(match[1]!, join(sessionsDir(rootId), name));
      }
    } catch { /* No sessions yet. */ }
    return index;
  }

  /** The coordinator chat as an agent row: busy, model, last tool, session age. */
  function mainSnapshot(ctx: ExtensionContext): AgentSnapshot {
    return {
      id: "main",
      kind: "main",
      label: "main",
      model: currentModel(ctx).split("/").pop() ?? "main",
      status: mainBusy ? "running" : "idle",
      activity: mainBusy ? (mainActivity || "working") : "idle",
      startedAt: sessionStartedAt,
      sessionPath: ctx.sessionManager.getSessionFile?.(),
    };
  }

  /** Live delegated agents as rows, with the last thing each one did. */
  function agentSnapshots(state: FabricState, sessions: Map<string, string>): AgentSnapshot[] {
    return liveAgents(Object.values(state.agents)).map((agent) => ({
      id: agent.id,
      kind: "agent" as const,
      label: clean(agent.label, 80),
      model: agent.model.split("/").pop() ?? agent.model,
      status: agent.status,
      activity: readActivity(fabricDir(rootId), agent.id).items.at(-1)?.text.split("\n")[0],
      startedAt: agent.startedAt,
      finishedAt: agent.finishedAt,
      parentId: agent.parentId,
      batchId: agent.batchId,
      sessionPath: agent.sessionPath ?? sessions.get(agent.id),
    }));
  }

  /** The rows below the prompt and the `/agents` list share this tree. */
  function treeRows(ctx: ExtensionContext): AgentRow[] {
    if (!rootId || !existsSync(statePath(rootId))) return [];
    let state: FabricState;
    try { state = loadState(rootId); } catch { return []; }
    return buildTree({ agents: agentSnapshots(state, sessionIndex()), main: mainSnapshot(ctx), collapsed, expandedGroups, now: Date.now() });
  }

  /** Resolves one surface agent (main, a child, or a group row) into transcript panes. */
  function paneSpec(ctx: ExtensionContext, id: string): TranscriptPaneSpec | undefined {
    if (id === "main") {
      const main = mainSnapshot(ctx);
      return { id: "main", label: "main", model: main.model, status: main.status, hue: 0, main: true, read: undefined };
    }
    if (!rootId || !existsSync(statePath(rootId))) return undefined;
    let agent: FabricAgent | undefined;
    try { agent = loadState(rootId).agents[id]; } catch { return undefined; }
    if (!agent) return undefined;
    const path = agent.sessionPath ?? resolveSessionFile(sessionsDir(rootId), id);
    const rows = treeRows(ctx);
    const hue = rows.find((row) => row.id === id)?.hue ?? 0;
    return { id, label: clean(agent.label, 80), model: agent.model.split("/").pop() ?? agent.model, status: agent.status, hue, path };
  }

  /**
   * Opens one or two agents as a full-window transcript screen. Live runs are
   * followed by reading only appended bytes; main follows the session file.
   */
  async function showTranscript(ctx: ExtensionContext, ids: readonly string[]): Promise<void> {
    const wanted = [...new Set(ids)].slice(0, 2);
    const specs: TranscriptPaneSpec[] = [];
    const sources: Array<{ id: string; path: string; cursor: number; done: boolean }> = [];
    for (const id of wanted) {
      const spec = paneSpec(ctx, id);
      const path = spec ? (spec.id === "main" ? ctx.sessionManager.getSessionFile?.() : spec.path) : undefined;
      if (!spec || !path || !existsSync(path)) continue;
      const initial = readTranscript(path);
      specs.push({ ...spec, read: () => initial });
      sources.push({ id, path, cursor: Buffer.byteLength(initial.text.slice(0, initial.text.lastIndexOf("\n") + 1), "utf8"), done: Boolean(initial.notice) });
    }
    if (!specs.length) {
      const mainOnly = wanted.length === 1 && wanted[0] === "main";
      ctx.ui.notify(mainOnly ? "The main chat has no saved session in this run." : "That run has no saved transcript yet. Fabric saves one when the child starts working.", "warning");
      return;
    }
    if (ctx.mode !== "tui") {
      ctx.ui.notify(`Transcripts need the interactive UI. Saved session: ${sources[0]!.path}`, "info");
      return;
    }
    const hidden = wanted.length - specs.length;
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      await withScreen(ctx, () => ctx.ui.custom((tui, theme, _keys, done) => {
        const overlay = new AgentTranscriptOverlay({ theme, specs, onClose: () => done(undefined) });
        timer = setInterval(() => {
          try {
            for (const source of sources) {
              if (source.done) continue;
              const read = readSessionChunk(source.path, source.cursor);
              if (!read.chunk) continue;
              source.cursor = read.next;
              if (overlay.appendText(source.id, read.chunk)) tui.requestRender();
            }
          } catch { /* Keep the last transcript that rendered. */ }
        }, 1000);
        return {
          invalidate: () => overlay.invalidate(),
          handleInput: (input: string) => overlay.handleInput(input),
          render: (width: number) => {
            const height = windowHeight(tui.terminal.rows);
            overlay.setHeight(height);
            return fitScreen(overlay.render(width), height, width);
          },
        };
      }));
    } finally { if (timer) clearInterval(timer); }
    if (hidden > 0) ctx.ui.notify(`${hidden} more agent(s) in this group; open them from /agents.`, "info");
  }

  /** `/agents`: the only keyboard path to a transcript. Esc from a run returns here. */
  async function showAgents(ctx: ExtensionContext): Promise<void> {
    if (ctx.mode !== "tui") {
      const rows = treeRows(ctx);
      ctx.ui.notify(rows.length ? rows.map((row) => `${"  ".repeat(row.depth)}${row.kind === "main" ? "◆" : "›"} ${row.label} · ${row.status}`).join("\n") : "No live agents.", "info");
      return;
    }
    while (true) {
      let chosen: AgentRow | undefined;
      let timer: ReturnType<typeof setInterval> | undefined;
      try {
        chosen = await withScreen(ctx, () => ctx.ui.custom<AgentRow | undefined>((tui, theme, _keys, done) => {
          const screen: AgentsScreen = new AgentsScreen({
            theme,
            rows: treeRows(ctx),
            onOpen: (row) => done(row),
            onToggle: (row) => {
              const set = row.kind === "group" ? expandedGroups : collapsed;
              if (set.has(row.id)) set.delete(row.id); else set.add(row.id);
              screen.setRows(treeRows(ctx));
              tui.requestRender();
            },
            onCancel: (row) => {
              // A group row cancels every member of its spawn batch.
              const ids = row.kind === "group" ? (row.members ?? []) : [row.id];
              for (const id of ids) { try { cancelTree(rootId, id); } catch { /* Already gone. */ } }
              updateAgents(ctx);
              screen.setRows(treeRows(ctx));
              tui.requestRender();
            },
            onClose: () => done(undefined),
          });
          timer = setInterval(() => { try { screen.setRows(treeRows(ctx)); tui.requestRender(); } catch { /* Keep the last list. */ } }, 750);
          return {
            invalidate: () => screen.invalidate(),
            handleInput: (input: string) => screen.handleInput(input),
            render: (width: number) => {
              const height = windowHeight(tui.terminal.rows);
              screen.setHeight(height);
              return fitScreen(screen.render(width), height, width);
            },
          };
        }));
      } finally { if (timer) clearInterval(timer); }
      if (!chosen) return;
      await showTranscript(ctx, chosen.kind === "group" ? (chosen.members ?? []) : [chosen.id]);
    }
  }

  /**
   * Runs a full-window screen with the rows widget hidden. Pi lays widgets out
   * beside the interactive area, so leaving them up would clip the screen's top.
   */
  async function withScreen<T>(ctx: ExtensionContext, run: () => Promise<T>): Promise<T> {
    screenDepth += 1;
    ctx.ui.setWidget(AGENTS_WIDGET, undefined);
    try { return await run(); } finally {
      screenDepth -= 1;
      if (screenDepth === 0) updateAgents(ctx);
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
    refreshTimer = setInterval(() => { try { updateAgents(ctx); } catch { /* Retry next tick; never interrupt editing. */ } }, 750);
  }
  function updateAgents(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui" || activeAgentId() || screenDepth > 0) return;
    if (!rootId || !existsSync(statePath(rootId))) { ctx.ui.setWidget(AGENTS_WIDGET, undefined); return; }
    const state = loadState(rootId);
    const agents = Object.values(state.agents);
    const live = liveAgents(agents);
    // The rows are the only always-on surface: they appear with the first child and
    // disappear again when the main chat is alone.
    if (!live.length) {
      ctx.ui.setWidget(AGENTS_WIDGET, undefined);
    } else {
      // The compact rows keep every batch on one line; expanding is a `/agents` affordance.
      const rows = buildTree({ agents: agentSnapshots(state, sessionIndex()), main: mainSnapshot(ctx), now: Date.now() });
      ctx.ui.setWidget(AGENTS_WIDGET, (_tui, theme) => ({ invalidate() { /* rows are rebuilt per tick */ }, render: (width) => renderAgentRows(rows, theme, width) }), { placement: "belowEditor" });
    }
    // Result entries are recorded for every run, including ones already gone from the rows.
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
    updateAgents(ctx); startRefresh(ctx);
  });
  pi.on("session_shutdown", () => { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = undefined; });

  function activity(kind: "activity" | "finding" | "tool" | "error", text: string) {
    const id = activeAgentId();
    if (rootId && id) publishActivity(fabricDir(rootId), id, kind, text);
  }
  pi.on("agent_start", () => {
    if (!activeAgentId()) { mainBusy = true; mainActivity = "thinking"; }
    activity("activity", "Working on assigned task");
  });
  pi.on("tool_execution_start", (event) => {
    // Only display a safe label, not arbitrary tool arguments or secrets.
    if (!activeAgentId()) { mainBusy = true; runningActivity = `running ${event.toolName}`; mainActivity = runningActivity; }
    activity("activity", `Running ${event.toolName}`);
  });
  pi.on("tool_execution_end", (event) => {
    const result = event.result as { details?: { exitCode?: number } } | undefined;
    const exit = result?.details?.exitCode;
    activity(event.isError ? "error" : "tool", `${event.toolName}: ${event.isError ? "failed" : "completed"}${typeof exit === "number" ? ` (exit ${exit})` : ""}`);
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    if (!activeAgentId()) mainActivity = "replying";
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
        // One batch id per call, so the UI can offer these siblings side by side.
        const batchId = randomUUID();
        const agents: FabricAgent[] = [];
        for (const request of params.agents) {
          const child = requestedRule(state.config, callerModel, request.model);
          if (!child) throw new Error(`No Fabric model hierarchy is configured; child model must exactly match the current model '${callerModel}'.`);
          if (child[1].rank > caller[1].rank) throw new Error(`${caller[0]} cannot spawn higher-ranked ${child[0]}.`);
          const id = randomUUID();
          const label = request.label?.trim() || request.task.replace(/\s+/g, " ").slice(0, 42);
          const worktree = join(fabricDir(root), "worktrees", `${child[0]}-${id.slice(0, 8)}`);
          const agent: FabricAgent = { id, parentId, batchId, model: child[1].id, task: request.task, label, status: "queued", cwd: ctx.cwd, worktree, createdAt: new Date().toISOString() };
          state.agents[id] = agent;
          agents.push(agent);
        }
        saveState(root, state);
        return agents;
      });
      startQueued(root);
      updateAgents(ctx);
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
          updateAgents(ctx);
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
      // The idle sweep only hides agents from the UI; forensics stay complete here.
      const gone = Object.values(state.agents).filter((agent) => isGone(agent)).length;
      const note = gone ? `\n\n${gone} agent(s) are gone from the rows and /agents (idle more than ${IDLE_GONE_MS / 60_000} minutes). They stay listed here and their transcripts stay on disk.` : "";
      return { content: [{ type: "text", text: (body || "Fabric has no delegated agents yet.") + note }], details: { rootId: root, agents: selected } };
    },
  });

  pi.registerTool({
    name: "cancel_agents", label: "Cancel Agents", description: "Cancel a Pi Fabric agent and its complete descendant tree. Worktrees and patches are preserved for inspection.", parameters: CancelParams,
    async execute(_id, params, _signal, _update, ctx) {
      const root = ensureRoot(ctx); const cancelled = cancelTree(root, params.agentId);
      updateAgents(ctx);
      return { content: [{ type: "text", text: `Cancelled ${cancelled.length} Fabric agent(s). Their worktrees remain available for inspection.` }], details: { agentIds: cancelled } };
    },
  });

  pi.registerCommand("agents", {
    description: "List the main agent and every delegated run; open one as a full-window transcript",
    handler: async (_args, ctx) => {
      if (!rootId || !existsSync(statePath(rootId))) {
        ctx.ui.notify("Pi Fabric has no agents in this session yet.", "info");
        return;
      }
      await showAgents(ctx);
    },
  });
}

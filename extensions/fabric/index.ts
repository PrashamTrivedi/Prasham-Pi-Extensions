import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync, openSync, closeSync } from "node:fs";
import { clean, publishActivity, readActivity, readPreview } from "./activity.ts";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { LiveTeamInspectorOverlay, renderCompactFabricWidget, renderComparisonResultCard, type FabricAgentView, type FabricTheme, type ComparisonResult } from "./ui.ts";
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
  resultPath?: string;
  patchPath?: string;
  baseCommit?: string;
  error?: string;
};
type FabricState = { rootId: string; repo: string; createdAt: string; config: FabricConfig; agents: Record<string, FabricAgent> };

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
export function effectiveRule(config: FabricConfig, model: string): [string, ModelRule] | undefined {
  if (Object.keys(config.models).length === 0 && model) return [model, { id: model, rank: 0, description: "current model" }];
  return modelRule(config, model);
}
export function requestedRule(config: FabricConfig, callerModel: string, requestedModel: string): [string, ModelRule] | undefined {
  if (Object.keys(config.models).length === 0) return requestedModel === callerModel ? [callerModel, { id: callerModel, rank: 0 }] : undefined;
  return modelRule(config, requestedModel);
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

export function buildChildArgs(entryPath: string, model: string, instruction: string): string[] {
  return ["-p", "--no-session", "--approve", "--no-extensions", "--extension", entryPath, "--model", model, "--", instruction];
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
    for (const agent of selected) {
      try {
        mkdirSync(join(fabricDir(rootId), "worktrees"), { recursive: true });
        const branch = `pi-fabric/${rootId.slice(0, 8)}/${agent.id.slice(0, 8)}`;
        agent.baseCommit = shell("git", ["rev-parse", "HEAD"], state.repo).trim();
        shell("git", ["worktree", "add", "-b", branch, agent.worktree, agent.baseCommit], state.repo);
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
    const child = spawn(piBin, buildChildArgs(ENTRY_PATH, agent.model, instruction), {
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
      if (stored) { stored.pid = child.pid; saveState(rootId, state); }
    });
  }
}

function directChildren(state: FabricState, parentId?: string): FabricAgent[] {
  return Object.values(state.agents).filter((agent) => agent.parentId === parentId);
}
function treeLines(state: FabricState, parentId: string | undefined, theme?: { fg: (color: "success" | "error" | "warning" | "accent" | "muted" | "dim", text: string) => string }, indent = ""): string[] {
  const children = directChildren(state, parentId);
  const lines: string[] = [];
  for (const [index, agent] of children.entries()) {
    const last = index === children.length - 1;
    const icon = agent.status === "done" ? "✓" : agent.status === "error" || agent.status === "cancelled" ? "×" : agent.status === "waiting" ? "◌" : agent.status === "running" ? "●" : "○";
    const color = agent.status === "done" ? "success" : agent.status === "error" || agent.status === "cancelled" ? "error" : agent.status === "running" ? "accent" : "warning";
    const line = `${indent}${last ? "└─" : "├─"} ${icon} ${agent.label} ${short(agent.id)}  ${agent.model}  ${agent.status}`;
    lines.push(theme ? theme.fg(color, line) : line);
    lines.push(...treeLines(state, agent.id, theme, `${indent}${last ? "   " : "│  "}`));
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

export default function piFabric(pi: ExtensionAPI) {
  // Resolve once per process. An explicitly selected, unreadable, or malformed config is fatal instead of silently changing policy.
  const configResolution = resolveConfig();
  if (configResolution.source === "env" && configResolution.path) process.env.PI_FABRIC_CONFIG = configResolution.path;
  let rootId = process.env[ROOT_ENV] ?? "";
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let widgetVisible = true;
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
  function ensureRoot(ctx: ExtensionContext): string {
    if (!rootId) {
      rootId = createRoot(ctx.cwd, configResolution.config);
      pi.appendEntry("pi-fabric-root", { rootId });
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
    if (!rootId || !existsSync(statePath(rootId))) { ctx.ui.setWidget("pi-fabric", undefined); ctx.ui.setStatus("pi-fabric", undefined); return; }
    const state = loadState(rootId);
    const agents = Object.values(state.agents);
    ctx.ui.setStatus("pi-fabric", ctx.ui.theme.fg("accent", `◆ fabric ${summary(state).split(" · ")[0]}`));
    const data = views(agents).sort((a, b) => Number(terminal(a.status)) - Number(terminal(b.status)));
    if (widgetVisible && agents.length) ctx.ui.setWidget("pi-fabric", (_tui, theme) => ({ invalidate() {}, render: (width) => renderCompactFabricWidget({ agents: data, maxAgents: 4 }, theme, width) }), { placement: "aboveEditor" });
    else ctx.ui.setWidget("pi-fabric", undefined);
    for (const agent of agents) {
      if (!terminal(agent.status) || recorded.has(agent.id)) continue;
      recorded.add(agent.id);
      pi.appendEntry("pi-fabric-result", { rootId, agents: views([agent]), agentId: agent.id });
    }
  }
  pi.registerEntryRenderer<{ agents: FabricAgentView[] }>("pi-fabric-result", (entry, options, theme) => comparison(entry.data?.agents ?? [], theme, options.expanded, "◆ FABRIC · Saved result"));
  function activeAgentId(): string | undefined { return process.env[AGENT_ENV]; }
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
        if (!caller) throw new Error(`Current model '${callerModel || "unknown"}' is not in Pi Fabric config${configResolution.path ? ` (${configResolution.path})` : ""}.`);
        const parentId = activeAgentId();
        const agents: FabricAgent[] = [];
        for (const request of params.agents) {
          const child = requestedRule(state.config, callerModel, request.model);
          if (!child) throw new Error(Object.keys(state.config.models).length === 0
            ? `No Fabric model hierarchy is configured; child model must exactly match the current model '${callerModel}'.`
            : `Unknown Fabric model '${request.model}'.`);
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
      return { content: [{ type: "text", text: body || "Fabric has no delegated agents yet." }], details: { rootId: root, agents: selected } };
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
      if (args.trim() === "hide" || args.trim() === "show") {
        widgetVisible = args.trim() === "show"; updateUI(ctx); return;
      }
      if (args.trim() === "status") { updateUI(ctx); ctx.ui.notify(summary(loadState(root)), "info"); return; }
      if (!args.trim()) {
        const state = loadState(root); updateUI(ctx);
        if (ctx.mode !== "tui") { ctx.ui.notify([summary(state), ...treeLines(state, undefined)].join("\n"), "info"); return; }
        let timer: ReturnType<typeof setInterval> | undefined;
        try {
          await ctx.ui.custom((tui, theme, _keys, done) => {
            const data = () => ({ agents: views(Object.values(loadState(root).agents), true), maxRows: Math.max(3, Math.floor(tui.terminal.rows * 0.8) - 10) });
            const inspector = new LiveTeamInspectorOverlay({ theme, data: data(), onChange: () => tui.requestRender(), onClose: () => done(undefined) });
            timer = setInterval(() => { try { inspector.setData(data()); } catch { /* Keep last valid snapshot. */ } }, 750);
            return {
              invalidate: () => inspector.invalidate(),
              handleInput: (input: string) => inspector.handleInput(input),
              render: (width: number) => {
                const inner = Math.max(1, width - 4);
                const border = theme.fg("borderAccent", "─".repeat(Math.max(0, width - 2)));
                const frame = (line: string) => {
                  const clipped = truncateToWidth(line, inner);
                  return truncateToWidth(theme.bg("customMessageBg", theme.fg("borderAccent", "│") + " " + clipped + " ".repeat(Math.max(0, inner - visibleWidth(clipped))) + " " + theme.fg("borderAccent", "│")), width);
                };
                return [
                  truncateToWidth(theme.bg("customMessageBg", theme.fg("borderAccent", "┌") + border + theme.fg("borderAccent", "┐")), width),
                  frame(""),
                  ...inspector.render(inner).map(frame),
                  frame(""),
                  truncateToWidth(theme.bg("customMessageBg", theme.fg("borderAccent", "└") + border + theme.fg("borderAccent", "┘")), width),
                ];
              },
            };
          }, { overlay: true, overlayOptions: { width: "95%", maxHeight: "90%" } });
        } finally { if (timer) clearInterval(timer); }
        return;
      }
      const match = args.trim().match(/^cancel\s+(.+)$/);
      if (match) { const cancelled = cancelTree(root, match[1]); updateUI(ctx); ctx.ui.notify(`Cancelled ${cancelled.length} Fabric agent(s).`, "info"); return; }
      ctx.ui.notify("Usage: /team | /team status | /team hide | /team show | /team cancel <agent-id>", "info");
    },
  });
}

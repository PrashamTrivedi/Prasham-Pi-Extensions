/**
 * pi extension: project-context
 *
 * Injects the current working directory, a `tree` listing, and the Git state
 * (branch, remote, uncommitted files) into the system prompt at the start of
 * every session, so the model always knows where it is and what the project
 * looks like.
 *
 * Place: ~/.pi/agent/extensions/project-context.ts  (global)
 * Reload: /reload   (or restart pi)
 *
 * Config (env vars):
 *   PI_TREE_DEPTH     - tree depth, default 2
 *   PI_TREE_MAX       - max output chars before truncation, default 8000
 *   PI_GIT_STATUS_MAX - max uncommitted lines before truncation, default 20
 */

import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_DEPTH = 2;
const DEFAULT_MAX = 8000;
const DEFAULT_GIT_STATUS_MAX = 20;

function readEnvInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function run(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 2 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

export interface GitState {
  branch: string | null;
  remote: string | null;
  status: string | null;
}

/**
 * Render the Git part of the project context. Returns "" outside a repository
 * (no branch, no remote, no status) so non-Git projects are unchanged.
 */
export function gitSection(state: GitState, maxLines = DEFAULT_GIT_STATUS_MAX): string {
  const branch = state.branch?.trim() ?? "";
  const remote = (state.remote?.trim().split("\n")[0] ?? "").replace(/\t/g, " ").trim();
  const status = state.status?.trim() ?? "";
  if (!branch && !remote && !status) return "";

  const lines = ["## Git"];
  if (branch) lines.push(`- branch: ${branch}`);
  if (remote) lines.push(`- remote: ${remote}`);
  if (!status) {
    lines.push("- uncommitted: clean");
    return `\n\n${lines.join("\n")}`;
  }

  const files = status.split("\n").filter((line) => line.trim().length > 0);
  lines.push(`- uncommitted: ${files.length} file${files.length === 1 ? "" : "s"}`);
  lines.push("", "```", ...files.slice(0, maxLines));
  if (files.length > maxLines) lines.push(`... (${files.length - maxLines} more)`);
  lines.push("```");
  return `\n\n${lines.join("\n")}`;
}

function buildContext(cwd: string): string {
  const depth = readEnvInt("PI_TREE_DEPTH", DEFAULT_DEPTH);
  const max = readEnvInt("PI_TREE_MAX", DEFAULT_MAX);

  const pwd = run("pwd", cwd) ?? cwd;

  // Prefer `tree`; fall back to `find` if tree isn't installed.
  let tree: string | null = null;
  if (run("command -v tree", cwd)) {
    tree = run(
      `tree -L ${depth} -a -I 'node_modules|.git' --noreport`,
      cwd,
    );
  }
  if (!tree) {
    tree = run(
      `find . -maxdepth ${depth} -not -path '*/node_modules/*' -not -path '*/.git/*' | sort`,
      cwd,
    );
  }

  let body = `# Project context\n\n- pwd: ${pwd}`;
  if (tree) {
    if (tree.length > max) {
      tree = tree.slice(0, max) + `\n... (truncated, ${tree.length - max} chars omitted)`;
    }
    body += `\n\n## Directory tree (depth ${depth})\n\n\`\`\`\n${tree}\n\`\`\``;
  }

  return body;
}

export default function (pi: ExtensionAPI) {
  // Cache context per cwd so we don't re-run tree on every turn.
  let cached: { cwd: string; context: string } | null = null;

  const get = (cwd: string): string => {
    if (!cached || cached.cwd !== cwd) {
      cached = { cwd, context: buildContext(cwd) };
    }
    return cached.context;
  };

  // Refresh cache on session start / reload / switch.
  pi.on("session_start", async (_event, ctx) => {
    cached = null;
    get(ctx.cwd);
  });

  // Injected for each agent run, so the tree survives compaction and retries.
  // Git state is read fresh each run (three cheap local calls) while the tree
  // stays cached, so uncommitted changes are never stale.
  pi.on("before_agent_start", async (event, ctx) => {
    const context = get(ctx.cwd);
    const git = gitSection({
      branch: run("git branch --show-current", ctx.cwd),
      remote: run("git remote -v", ctx.cwd),
      status: run("git status --short", ctx.cwd),
    }, readEnvInt("PI_GIT_STATUS_MAX", DEFAULT_GIT_STATUS_MAX));
    return {
      systemPrompt: `${event.systemPrompt}\n\n---\n${context}${git}`,
    };
  });
}

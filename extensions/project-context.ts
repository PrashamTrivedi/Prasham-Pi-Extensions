/**
 * pi extension: project-context
 *
 * Injects the current working directory and a `tree` listing into the
 * system prompt at the start of every session, so the model always knows
 * where it is and what the project looks like.
 *
 * Place: ~/.pi/agent/extensions/project-context.ts  (global)
 * Reload: /reload   (or restart pi)
 *
 * Config (env vars):
 *   PI_TREE_DEPTH   - tree depth, default 2
 *   PI_TREE_MAX     - max output chars before truncation, default 8000
 */

import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_DEPTH = 2;
const DEFAULT_MAX = 8000;

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

  // Inject into the system prompt for each agent turn.
  pi.on("before_agent_start", async (event, ctx) => {
    const context = get(ctx.cwd);
    return {
      systemPrompt: `${event.systemPrompt}\n\n---\n${context}`,
    };
  });
}

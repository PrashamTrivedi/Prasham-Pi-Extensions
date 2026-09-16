/**
 * pi extension: recursive-context
 *
 * Walks DOWN from the cwd into every subdirectory and
 * loads every CLAUDE.md / AGENTS.md it finds (respecting .gitignore), then
 * injects the contents into the system prompt.
 *
 * Pi already loads, on its own:
 *   - ~/.pi/agent/AGENTS.md (global)
 *   - AGENTS.md / CLAUDE.md in parent directories (walking UP from cwd)
 *   - AGENTS.md / CLAUDE.md in the cwd itself
 *
 * This extension fills in everything BELOW the cwd (depth >= 1), so there
 * is no duplication with what pi already loads.
 *
 * Within each directory, CLAUDE.md is ordered before AGENTS.md (so a
 * project that keeps both gets the Claude variant first). Across
 * directories, files are ordered root-to-leaves for natural reading order.
 *
 * Place: ~/.pi/agent/extensions/recursive-context.ts  (global)
 * Reload: /reload   (or restart pi)
 *
 * Config (env vars):
 *   PI_RECURSIVE_CONTEXT_MAX     max total chars injected before truncation
 *                                (default 200000)
 *   PI_RECURSIVE_CONTEXT_NAMES   comma-separated filenames, in priority order
 *                                (default "CLAUDE.md,AGENTS.md")
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_MAX = 200_000;
const DEFAULT_NAMES = "CLAUDE.md,AGENTS.md";

// Directories always skipped during the non-git fallback walk.
const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg",
  "dist", "build", "out", "target", "bin", "obj",
  ".next", ".nuxt", ".svelte-kit", ".astro",
  ".turbo", ".vercel", ".cache",
  "coverage", ".nyc_output",
  ".gradle", ".idea", ".vscode",
  "__pycache__", ".venv", "venv", "env",
  ".mypy_cache", ".pytest_cache", ".ruff_cache",
  ".wrangler", ".docusaurus", ".sass-cache",
]);

function readEnvInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function namesFromEnv(): string[] {
  const raw = process.env.PI_RECURSIVE_CONTEXT_NAMES ?? DEFAULT_NAMES;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith("/") ? s.slice(1) : s));
}

/** Priority order for sorting (lower = first). */
function namePriority(name: string, names: string[]): number {
  const i = names.indexOf(name);
  return i === -1 ? names.length : i;
}

/**
 * Discover context files under cwd using git, which respects .gitignore
 * automatically. Returns relative paths, or null if not a git repo.
 */
function discoverViaGit(cwd: string, names: string[]): string[] | null {
  try {
    const inside = execSync("git rev-parse --is-inside-work-tree", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (inside !== "true") return null;
  } catch {
    return null;
  }

  // pathspecs: `:(glob)**/NAME` matches at any depth, plus the bare name for
  // the repo root (git's `**/` does not match the root level).
  const pathspecs: string[] = [];
  for (const n of names) {
    pathspecs.push(`:(glob)**/${n}`);
    pathspecs.push(n);
  }
  const quoted = pathspecs.map((p) => `'${p.replace(/'/g, `'\\''`)}'`).join(" ");

  let out: string;
  try {
    out = execSync(
      `git ls-files -z --cached --others --exclude-standard -- ${quoted}`,
      { cwd, encoding: "buffer", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 128 * 1024 * 1024 },
    ).toString("utf8");
  } catch {
    return null;
  }

  return out
    .split("\0")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Fallback recursive walk for non-git directories. Skips hidden and common
 * generated/dependency directories. Also applies a minimal .gitignore
 * parser for simple patterns (names, `*.ext`, dir/), so `.gitignore` files
 * are still respected outside git repos.
 */
function discoverViaWalk(cwd: string, names: string[]): string[] {
  const nameSet = new Set(names);
  const results: string[] = [];

  // Minimal gitignore support: collect ignore patterns per directory as we
  // descend. We only track positive patterns and directory-scoped negations
  // are best-effort (good enough for typical .gitignore usage).
  function shouldIgnore(name: string, isDir: boolean, patterns: string[]): boolean {
    for (const pat of patterns) {
      const p = pat.trim();
      if (!p || p.startsWith("#")) continue;
      // strip leading ./ and trailing spaces
      const clean = p.replace(/^\.\//, "");
      // directory pattern ending with /
      if (clean.endsWith("/")) {
        if (isDir && name === clean.slice(0, -1)) return true;
        continue;
      }
      // glob with * or ?
      if (clean.includes("*") || clean.includes("?")) {
        const re = new RegExp(
          "^" +
            clean
              .replace(/[.+^${}()|[\]\\]/g, "\\$&")
              .replace(/\*/g, ".*")
              .replace(/\?/g, ".") +
            "$",
        );
        if (re.test(name)) return true;
        continue;
      }
      // plain name
      if (name === clean) return true;
    }
    return false;
  }

  function readGitignore(dir: string): string[] {
    const gi = path.join(dir, ".gitignore");
    try {
      const data = fs.readFileSync(gi, "utf8");
      return data.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
    } catch {
      return [];
    }
  }

  function walk(dir: string, relBase: string, ignorePatterns: string[]) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const localPatterns = [...ignorePatterns, ...readGitignore(dir)];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        if (IGNORE_DIRS.has(entry.name)) continue;
        if (shouldIgnore(entry.name, true, localPatterns)) continue;
        const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
        walk(path.join(dir, entry.name), rel, localPatterns);
      } else if (entry.isFile() && nameSet.has(entry.name)) {
        if (shouldIgnore(entry.name, false, localPatterns)) continue;
        const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
        results.push(rel);
      }
    }
  }

  walk(cwd, "", []);
  return results;
}

/** Sort: by directory (root-to-leaves), then by filename priority. */
function sortFiles(files: string[], names: string[]): string[] {
  return [...files].sort((a, b) => {
    const dirA = path.posix.dirname(a);
    const dirB = path.posix.dirname(b);
    if (dirA !== dirB) return dirA.localeCompare(dirB);
    return namePriority(path.basename(a), names) - namePriority(path.basename(b), names);
  });
}

function buildContext(cwd: string, names: string[], max: number): string {
  // Only files BELOW the cwd (depth >= 1); pi already loads the cwd-level
  // file and parent directories.
  const isBelow = (rel: string) => rel.includes("/") || rel.includes(path.sep);

  let found = discoverViaGit(cwd, names);
  if (found === null) found = discoverViaWalk(cwd, names);

  found = found.filter(isBelow);
  found = sortFiles(found, names);

  if (found.length === 0) return "";

  const sections: string[] = [];
  let total = 0;
  let truncated = false;

  for (const rel of found) {
    const full = path.join(cwd, rel);
    let content: string;
    try {
      const real = fs.realpathSync(full);
      const root = fs.realpathSync(cwd);
      if (!real.startsWith(root + path.sep)) continue;
      content = fs.readFileSync(real, "utf8");
    } catch {
      continue;
    }
    const header = `## ${rel}`;
    const block = `${header}\n\n${content.trim()}`;
    if (total + block.length > max) {
      truncated = true;
      break;
    }
    sections.push(block);
    total += block.length + 2;
  }

  if (sections.length === 0) return "";

  let body = sections.join("\n\n");
  if (truncated) {
    body += `\n\n_... additional context files omitted (limit ${max} chars)._`;
  }
  return `## Context files found below the working directory\n\n` + body;
}

export default function recursiveContext(pi: ExtensionAPI) {
  const names = namesFromEnv();
  const max = readEnvInt("PI_RECURSIVE_CONTEXT_MAX", DEFAULT_MAX);

  let cached: { cwd: string; context: string } | null = null;

  const get = (cwd: string): string => {
    if (!cached || cached.cwd !== cwd) {
      cached = { cwd, context: buildContext(cwd, names, max) };
    }
    return cached.context;
  };

  // Refresh cache on session start / reload / switch.
  pi.on("session_start", async (_event, ctx) => {
    cached = null;
    if (ctx.isProjectTrusted()) get(ctx.cwd);
  });

  // Inject below-cwd context files into the system prompt for each turn.
  pi.on("before_agent_start", async (event, ctx) => {
    if (!ctx.isProjectTrusted()) return;
    const context = get(ctx.cwd);
    if (!context) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n---\n${context}`,
    };
  });
}

/**
 * pi extension: memory
 *
 * Gives every project a local, file-based memory in the same shape Claude Code
 * uses (`~/.claude/projects/<escaped-cwd>/memory`), kept under the Pi agent dir:
 *
 *   ~/.pi/agent/projects/<escaped-cwd>/memory/MEMORY.md          index, one line per memory
 *   ~/.pi/agent/projects/<escaped-cwd>/memory/<type>_<slug>.md    one memory per file
 *
 * The extension injects only the location plus a short read/write protocol into
 * the system prompt. Memory bodies are never injected: the model reads them with
 * its normal `read` tool, and writes them with `write`/`edit`.
 *
 * Config (env vars):
 *   PI_MEMORY_ROOT - override the per-project memory base (default: <agent dir>/projects)
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { searchLocal } from "./search.ts";
import { findServerMemories, memoryServerAuth } from "./server.ts";

export const INDEX_FILE = "MEMORY.md";
export const INDEX_HEADER = "# Memory Index\n";

/** Pi's agent directory (`~/.pi/agent` unless overridden). */
export function agentDir(): string {
  const fromEnv = process.env.PI_CODING_AGENT_DIR;
  return fromEnv && fromEnv.length > 0 ? fromEnv : join(homedir(), ".pi", "agent");
}

/** Mirror Claude's escaping so one project keeps one stable directory name. */
export function escapedProject(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Base directory for per-project memory. Claude keeps its memories under
 * `~/.claude/projects/<escaped-cwd>/memory`; Pi mirrors that shape under its own
 * agent directory so existing tooling (for example jev-harness `memory-hygiene`,
 * which matches `/memory/<file>.md`) recognises the files as memories.
 */
export function memoryRoot(options: { agentDir?: string; root?: string } = {}): string {
  const override = options.root ?? process.env.PI_MEMORY_ROOT;
  if (override && override.trim().length > 0) return override;
  return join(options.agentDir ?? agentDir(), "projects");
}

export function memoryDirFor(
  cwd: string,
  options: { agentDir?: string; root?: string } = {},
): string {
  return join(memoryRoot(options), escapedProject(cwd), "memory");
}

/**
 * Create the memory directory and an empty index when missing. Existing indexes
 * and memory files are never touched, so this is safe to call every session.
 */
export function ensureMemory(
  dir: string,
  options: { fs?: { existsSync: typeof existsSync; mkdirSync: typeof mkdirSync; writeFileSync: typeof writeFileSync } } = {},
): { indexCreated: boolean } {
  const fs = options.fs ?? { existsSync, mkdirSync, writeFileSync };
  fs.mkdirSync(dir, { recursive: true });
  const index = join(dir, INDEX_FILE);
  if (fs.existsSync(index)) return { indexCreated: false };
  fs.writeFileSync(index, INDEX_HEADER);
  return { indexCreated: true };
}

/**
 * The injected protocol. Deliberately short: it names the location, the file
 * shape, and when to read or write — the model does the rest with normal tools.
 */
export function protocolBlock(dir: string): string {
  return [
    "## Project memory",
    "",
    `Memory for this project is plain Markdown at \`${dir}\`; read and write it with the normal file tools.`,
    "",
    `- \`${INDEX_FILE}\` lists one line per memory: \`- [file](file) — description\`.`,
    "- One memory per file, named `[type]_[slug].md` with `name`, `description`, and `type` frontmatter.",
    "  - `next_*` — what is in flight, what to do next, blockers. Update this file in place; never add one per session.",
    "  - `project_*` — durable facts: architecture, commands, gotchas, decisions and why.",
    "  - `feedback_*` — corrections and preferences, ending with how to apply them.",
    "  - `reference_*` — pointers to external docs, dashboards, tickets.",
    "- End each file with **Why:** and **How to apply:**.",
    `- Read \`${INDEX_FILE}\` before planning, and any file whose description matches the task, before acting on it.`,
    "- Save when the human corrects you, when a decision outlives this session, or when you stop mid-task; update an existing memory instead of duplicating it, and keep its index line current.",
    "- Never write secrets, tokens, or credentials here.",
  ].join("\n");
}

export default function memory(pi: ExtensionAPI) {
  let cached: { cwd: string; dir: string } | null = null;

  const get = (cwd: string): string => {
    if (!cached || cached.cwd !== cwd) {
      const dir = memoryDirFor(cwd);
      ensureMemory(dir);
      cached = { cwd, dir };
    }
    return cached.dir;
  };

  // Create the directory and index once per session (also on reload/switch).
  pi.on("session_start", async (_event, ctx) => {
    cached = null;
    get(ctx.cwd);
  });

  /**
   * `/memory` lists the directory; `/memory find <q>` searches the Markdown memory
   * and the `memory-server` MCP store, because the two know different things and
   * a miss in one should not hide a hit in the other.
   */
  pi.registerCommand("memory", {
    description: "Show project memory, or find a memory across local files and the memory-server",
    handler: async (args, ctx) => {
      const dir = get(ctx.cwd);
      const [verb = "", ...words] = args.trim().split(/\s+/).filter(Boolean);
      if (verb !== "find") {
        let count = 0;
        try {
          count = readdirSync(dir).filter((name) => name.endsWith(".md") && name !== INDEX_FILE).length;
        } catch { /* ensureMemory created the directory, so this is only a permission problem. */ }
        ctx.ui.notify(`${dir}\n${count} memories · /memory find <query>`, "info");
        return;
      }
      const query = words.join(" ");
      if (!query) {
        ctx.ui.notify("Usage: /memory find <query>", "warning");
        return;
      }
      const local = searchLocal(dir, query);
      // The server half is best-effort: a local hit must still be shown offline.
      const auth = memoryServerAuth(agentDir());
      let server: Awaited<ReturnType<typeof findServerMemories>> = [];
      let note = "";
      if (!auth) {
        note = "memory-server not connected (no usable token — open /mcp)";
      } else {
        try {
          server = await findServerMemories(query, { auth });
        } catch (error) {
          note = `memory-server: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      const lines = [`**memory find** · ${query} — ${local.length} local, ${server.length} memory-server${note ? ` · ${note}` : ""}`];
      if (local.length) {
        lines.push("", "**Local**");
        for (const hit of local) {
          lines.push(`- \`${hit.file}\` — ${hit.title}${hit.description ? `: ${hit.description}` : ""}`);
          if (hit.line) lines.push(`  - ${hit.line}`);
        }
      }
      if (server.length) {
        lines.push("", "**memory-server**");
        for (const memory of server) {
          lines.push(`- **${memory.name}**${memory.tags.length ? ` · ${memory.tags.join(", ")}` : ""}`);
          const snippet = memory.content.replace(/\s+/g, " ").trim();
          if (snippet) lines.push(`  - ${snippet.slice(0, 240)}${snippet.length > 240 ? "…" : ""}`);
        }
      }
      if (!local.length && !server.length) lines.push("", "No matches.");
      pi.sendMessage({ customType: "pi-memory-find", display: true, content: lines.join("\n") }, { triggerTurn: false });
    },
  });

  // Re-injected every run, so the protocol survives compaction and retries.
  pi.on("before_agent_start", async (event, ctx) => {
    return { systemPrompt: `${event.systemPrompt}\n\n---\n${protocolBlock(get(ctx.cwd))}` };
  });
}

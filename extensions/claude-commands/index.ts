/**
 * pi extension: claude-commands
 *
 * Exposes Claude Code markdown slash commands (`~/.claude/commands/**.md`) as Pi
 * commands. `/name args` expands the body ($ARGUMENTS, $1..$9) and sends it as a
 * user message. Subfolders become namespaces (`git/blame.md` -> `/git:blame`).
 *
 * Config (env vars):
 *   PI_CLAUDE_COMMANDS_DIR - commands directory (default: ~/.claude/commands)
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Pi built-ins; a Claude command with one of these names is skipped. */
export const BUILTIN_COMMANDS: readonly string[] = [
  "settings", "model", "tree", "thinking", "scoped-models", "export", "import", "share", "bug",
  "copy", "name", "session", "changelog", "hotkeys", "fork", "clone", "trust", "login", "logout",
  "new", "compact", "resume", "reload", "quit",
];

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

export interface ClaudeCommand {
  name: string;
  file: string;
  description: string;
  argumentHint?: string;
  body: string;
}

export interface Discovery {
  commands: ClaudeCommand[];
  invalid: string[];
}

export function commandsDir(): string {
  const fromEnv = process.env.PI_CLAUDE_COMMANDS_DIR;
  return fromEnv && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), ".claude", "commands");
}

/** Minimal frontmatter parser: flat `key: value` lines only (all Claude commands use). */
export function parseCommandFile(raw: string): { meta: Record<string, string>; body: string } {
  const text = raw.replace(/^﻿/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    meta[kv[1]] = value;
  }
  return { meta, body: text.slice(match[0].length) };
}

/** First non-empty, non-heading body line, used when no description is given. */
function fallbackDescription(body: string): string {
  const line = body.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, "").trim()).find((l) => l.length > 0);
  return line ? line.slice(0, 120) : "Claude command";
}

/** Shell-like split honouring single and double quotes. */
export function splitArgs(args: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m = re.exec(args); m; m = re.exec(args)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const BASH_INJECTION = /!`[^`\n]+`/;

/**
 * Expand a command body. `$ARGUMENTS` is the raw argument string, `$1..$9` the
 * quote-aware positional args (empty when missing). Like Claude, args are
 * appended as `ARGUMENTS: ...` when the body references none. Bash-injection
 * (!`cmd`) is never executed; the text stays and a note is appended.
 */
export function expandBody(body: string, args: string): string {
  const trimmed = args.trim();
  const positional = splitArgs(trimmed);
  const usesArgs = /\$ARGUMENTS|\$[1-9]/.test(body);
  let out = body
    .replace(/\$ARGUMENTS/g, trimmed)
    .replace(/\$([1-9])/g, (_m, d: string) => positional[Number(d) - 1] ?? "");
  if (!usesArgs && trimmed) out = `${out.replace(/\s+$/, "")}\n\nARGUMENTS: ${trimmed}`;
  if (BASH_INJECTION.test(body)) {
    out = `${out.replace(/\s+$/, "")}\n\n(Note: lines using !\`command\` are Claude Code shell injection and were not executed; run any needed commands yourself.)`;
  }
  return out;
}

/** Recursively collect commands. Symlinked loops are skipped via realpath tracking. */
export function discoverCommands(root: string): Discovery {
  const commands: ClaudeCommand[] = [];
  const invalid: string[] = [];
  if (!existsSync(root)) return { commands, invalid };
  const seen = new Set<string>();

  const walk = (dir: string, namespace: string[]) => {
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      return;
    }
    if (seen.has(real)) return; // symlink loop or a `commands` alias of an ancestor
    seen.add(real);
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const full = join(dir, entry);
      let isDir = false;
      let isFile = false;
      try {
        const st = statSync(full);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        continue;
      }
      if (isDir) {
        walk(full, [...namespace, entry]);
      } else if (isFile && entry.endsWith(".md")) {
        const name = [...namespace, basename(entry, ".md")].join(":");
        if (!NAME_RE.test(name)) {
          invalid.push(name);
          continue;
        }
        const { meta, body } = parseCommandFile(readFileSync(full, "utf8"));
        commands.push({
          name,
          file: full,
          description: meta.description || fallbackDescription(body),
          argumentHint: meta["argument-hint"] || undefined,
          body,
        });
      }
    }
  };
  walk(root, []);
  return { commands, invalid };
}

/** Prompt-template names that already own a `/name`: this package, the agent dir, the project. */
function reservedPromptNames(cwd: string): string[] {
  const agent = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const pkg = join(import.meta.dirname ?? ".", "..", "..", "prompts");
  const names: string[] = [];
  for (const dir of [pkg, join(agent, "prompts"), join(cwd, ".pi", "prompts")]) {
    try {
      for (const f of readdirSync(dir)) if (f.endsWith(".md")) names.push(basename(f, ".md"));
    } catch {
      /* directory absent */
    }
  }
  return names;
}

export default function claudeCommands(pi: ExtensionAPI): void {
  const registered = new Set<string>();
  const reportedSkips = new Set<string>();

  function sync(cwd: string, existing: Iterable<string>): string[] {
    const taken = new Set<string>([...BUILTIN_COMMANDS, ...reservedPromptNames(cwd), ...existing]);
    const { commands, invalid } = discoverCommands(commandsDir());
    const skipped: string[] = invalid.map((n) => `${n} (invalid name)`);
    for (const cmd of commands) {
      if (registered.has(cmd.name)) continue;
      if (taken.has(cmd.name)) {
        skipped.push(`${cmd.name} (name in use)`);
        continue;
      }
      registered.add(cmd.name);
      pi.registerCommand(cmd.name, {
        description: cmd.argumentHint ? `${cmd.description} ${cmd.argumentHint}` : cmd.description,
        handler: async (args, ctx) => {
          // Re-read on every call so edits apply without re-registering.
          let body = cmd.body;
          try {
            body = parseCommandFile(readFileSync(cmd.file, "utf8")).body;
          } catch {
            ctx.ui.notify(`claude-commands: cannot read ${cmd.file}; using cached body`, "warning");
          }
          pi.sendUserMessage(expandBody(body, args));
        },
      });
    }
    return skipped;
  }

  // Register at load so commands exist immediately (getCommands is unavailable here).
  try {
    sync(process.cwd(), []);
  } catch {
    /* reported at session_start */
  }

  pi.on("session_start", async (_event, ctx) => {
    let existing: string[] = [];
    try {
      existing = pi.getCommands().map((c) => c.name);
    } catch {
      /* runtime not bound */
    }
    // Our own registrations show up in getCommands; never treat them as foreign.
    existing = existing.filter((n) => !registered.has(n));
    // Re-scan: picks up newly added files. Skips are computed against the full set.
    const fresh = sync(ctx.cwd, existing);
    const { commands } = discoverCommands(commandsDir());
    const foreign = commands
      .filter((c) => !registered.has(c.name))
      .map((c) => `${c.name} (name in use)`);
    const skipped = [...new Set([...fresh, ...foreign])].filter((s) => !reportedSkips.has(s));
    skipped.forEach((s) => reportedSkips.add(s));
    if (skipped.length > 0) {
      ctx.ui.notify(`claude-commands skipped: ${skipped.join(", ")}`, "info");
    }
  });
}

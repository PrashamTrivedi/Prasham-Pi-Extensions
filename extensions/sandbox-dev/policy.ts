import { isAbsolute, relative, resolve, sep } from "node:path";

export type Verdict = "allow" | "confirm" | "deny";

/**
 * Built-in pass-1 policy. It is the whole permission model. There is no file config: a project
 * file that could zero out `deny` would make the policy unenforceable. `extensions/jev` (Phase 5)
 * adds the shell-safety pass-2 on top and may only escalate these verdicts, never lower them.
 */
export interface PolicyConfig {
  /** Maximum supervised continuation turns for an anchored outcome. */
  budget: number;
  bash: { deny: string[]; confirm: string[] };
  paths: { deny: string[]; confirmOutsideCwd: boolean };
  tools: { deny: string[]; confirm: string[] };
}

export interface PolicyCall {
  toolName: string;
  input: Record<string, unknown>;
}

export interface Decision {
  verdict: Verdict;
  reason: string;
  /** Deterministic evidence for the Jev shell-safety pass-2 to weigh once `extensions/jev` lands. */
  flags: string[];
}

export const DEFAULT_CONFIG: PolicyConfig = {
  budget: 8,
  bash: {
    deny: ["rm -rf /", "sudo rm", "git push --force", "git push -f", "mkfs", ":(){:|:&};:"],
    confirm: [
      "git push",
      "git reset --hard",
      "rm -rf",
      "rm -r ",
      "sudo",
      "chmod",
      "chown",
      "curl",
      "wget",
      "npm publish",
      "npm install",
      "npm i ",
      "bun add",
      "pnpm add",
      "yarn add",
      "brew",
      "apt-get",
      "docker",
    ],
  },
  paths: {
    deny: [".env", ".ssh", "id_rsa", "id_ed25519", ".aws", ".npmrc", ".netrc", ".git-credentials"],
    confirmOutsideCwd: true,
  },
  tools: { deny: [], confirm: [] },
};

const PATH_TOOLS = new Set(["read", "write", "edit"]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);
const MUTATING_TOOLS = new Set(["write", "edit"]);

/** Narrow, implementation-only commands that mark the start of real work. Deliberately small. */
const IMPLEMENTATION_BASH = [
  "git commit",
  "git push",
  "npm install",
  "npm i ",
  "bun install",
  "bun add",
  "pnpm install",
  "pnpm add",
  "yarn install",
  "yarn add",
];

export const VERDICT_RANK: Record<Verdict, number> = { allow: 0, confirm: 1, deny: 2 };

/** Substring match (case-insensitive), or a `/regex/` when the pattern is slash-delimited. */
export function matchPattern(value: string, pattern: string): boolean {
  if (pattern.length > 1 && pattern.startsWith("/") && pattern.endsWith("/")) {
    try {
      return new RegExp(pattern.slice(1, -1), "i").test(value);
    } catch {
      return false;
    }
  }
  return value.toLowerCase().includes(pattern.toLowerCase());
}

/** True when `rawPath` resolves outside `cwd` (tilde paths count as outside). */
export function isOutsideCwd(rawPath: string, cwd: string): boolean {
  if (!rawPath || rawPath.startsWith("~")) return true;
  const absolute = resolve(cwd, rawPath);
  const rel = relative(resolve(cwd), absolute);
  return rel !== "" && (rel.startsWith("..") || isAbsolute(rel));
}

/** True for paths under `taskNotes/`. Planning artifacts are written before approval. */
export function isPlanningPath(rawPath: string, cwd: string): boolean {
  if (!rawPath) return false;
  const rel = relative(resolve(cwd), resolve(cwd, rawPath));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return false;
  return rel.split(sep)[0] === "taskNotes";
}

/** Merge the pass-1 floor with a pass-2 verdict. Higher wins, so an LLM can only escalate. */
export function strongest(a: Verdict, b: Verdict): Verdict {
  return VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b;
}

export function classifyToolCall(call: PolicyCall, cwd: string, config: PolicyConfig = DEFAULT_CONFIG): Decision {
  const rules = config;

  if (rules.tools.deny.includes(call.toolName)) {
    return { verdict: "deny", reason: `${call.toolName} is denied by policy`, flags: [`tool:${call.toolName}`] };
  }
  if (rules.tools.confirm.includes(call.toolName)) {
    return { verdict: "confirm", reason: `${call.toolName} requires confirmation`, flags: [`tool:${call.toolName}`] };
  }

  if (SHELL_TOOLS.has(call.toolName)) {
    const command = String(call.input.command ?? "");
    const denied = rules.bash.deny.find((pattern) => matchPattern(command, pattern));
    if (denied) {
      return { verdict: "deny", reason: `command matches denied pattern "${denied}"`, flags: [`bash-deny:${denied}`] };
    }
    const confirm = rules.bash.confirm.find((pattern) => matchPattern(command, pattern));
    if (confirm) {
      return {
        verdict: "confirm",
        reason: `command matches confirmation pattern "${confirm}"`,
        flags: [`bash-confirm:${confirm}`],
      };
    }
    return { verdict: "allow", reason: "command not matched by policy", flags: [] };
  }

  if (PATH_TOOLS.has(call.toolName)) {
    const raw = typeof call.input.path === "string" ? call.input.path : "";
    for (const pattern of rules.paths.deny) {
      if (matchPattern(raw, pattern)) {
        return { verdict: "deny", reason: `path matches protected pattern "${pattern}"`, flags: [`path-deny:${pattern}`] };
      }
    }
    if (rules.paths.confirmOutsideCwd && raw && isOutsideCwd(raw, cwd)) {
      return { verdict: "confirm", reason: "path is outside the working directory", flags: ["path-outside-cwd"] };
    }
    return { verdict: "allow", reason: "path inside the working directory", flags: [] };
  }

  return { verdict: "allow", reason: "tool not covered by policy", flags: [] };
}

/**
 * True when a tool call actually starts implementation: a source write/edit, or an implementation
 * command. Planning writes under `taskNotes/` do not count. Used to arm outcome supervision once
 * work begins, since approval itself lives in the transcript.
 */
export function isImplementation(call: PolicyCall, cwd: string): boolean {
  if (MUTATING_TOOLS.has(call.toolName)) {
    const raw = typeof call.input.path === "string" ? call.input.path : "";
    return raw !== "" && !isPlanningPath(raw, cwd);
  }
  if (SHELL_TOOLS.has(call.toolName)) {
    const command = String(call.input.command ?? "");
    return IMPLEMENTATION_BASH.some((pattern) => matchPattern(command, pattern));
  }
  return false;
}

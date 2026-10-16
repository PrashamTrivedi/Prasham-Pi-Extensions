import { isAbsolute, relative, resolve } from "node:path";

export type Verdict = "allow" | "confirm" | "deny";

export interface SandboxDevConfig {
  /** Maximum supervised continuation turns for an anchored outcome. */
  budget: number;
  permissions: {
    bash: { deny: string[]; confirm: string[] };
    paths: { deny: string[]; confirmOutsideCwd: boolean };
    tools: { deny: string[]; confirm: string[] };
  };
}

export interface PolicyCall {
  toolName: string;
  input: Record<string, unknown>;
}

export interface Decision {
  verdict: Verdict;
  reason: string;
}

/**
 * A minimal, legible unattended policy. Pi has no built-in approval system, so this
 * short list plus a fail-closed fallback is the whole "permission model".
 */
export const DEFAULT_CONFIG: SandboxDevConfig = {
  budget: 8,
  permissions: {
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
  },
};

export interface SandboxDevConfigOverride {
  budget?: number;
  permissions?: {
    bash?: { deny?: string[]; confirm?: string[] };
    paths?: { deny?: string[]; confirmOutsideCwd?: boolean };
    tools?: { deny?: string[]; confirm?: string[] };
  };
}

const PATH_TOOLS = new Set(["read", "write", "edit"]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);

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

export function classifyToolCall(call: PolicyCall, config: SandboxDevConfig, cwd: string): Decision {
  const rules = config.permissions;

  if (rules.tools.deny.includes(call.toolName)) {
    return { verdict: "deny", reason: `${call.toolName} is denied by policy` };
  }
  if (rules.tools.confirm.includes(call.toolName)) {
    return { verdict: "confirm", reason: `${call.toolName} requires confirmation` };
  }

  if (SHELL_TOOLS.has(call.toolName)) {
    const command = String(call.input.command ?? "");
    const denied = rules.bash.deny.find((pattern) => matchPattern(command, pattern));
    if (denied) return { verdict: "deny", reason: `command matches denied pattern "${denied}"` };
    const confirm = rules.bash.confirm.find((pattern) => matchPattern(command, pattern));
    if (confirm) return { verdict: "confirm", reason: `command matches confirmation pattern "${confirm}"` };
    return { verdict: "allow", reason: "command not matched by policy" };
  }

  if (PATH_TOOLS.has(call.toolName)) {
    const raw = typeof call.input.path === "string" ? call.input.path : "";
    for (const pattern of rules.paths.deny) {
      if (matchPattern(raw, pattern)) {
        return { verdict: "deny", reason: `path matches protected pattern "${pattern}"` };
      }
    }
    if (rules.paths.confirmOutsideCwd && raw && isOutsideCwd(raw, cwd)) {
      return { verdict: "confirm", reason: "path is outside the working directory" };
    }
    return { verdict: "allow", reason: "path inside the working directory" };
  }

  return { verdict: "allow", reason: "tool not covered by policy" };
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Merge a user config over a base. Arrays replace; unknown and malformed fields are ignored. */
export function mergeConfig(base: SandboxDevConfig, override: SandboxDevConfigOverride | undefined): SandboxDevConfig {
  const overrideValue = override ?? {};
  const permissions = overrideValue.permissions ?? {};
  const budget = overrideValue.budget;
  return {
    budget: typeof budget === "number" && Number.isFinite(budget) && budget > 0 ? Math.floor(budget) : base.budget,
    permissions: {
      bash: {
        deny: stringList(permissions.bash?.deny, base.permissions.bash.deny),
        confirm: stringList(permissions.bash?.confirm, base.permissions.bash.confirm),
      },
      paths: {
        deny: stringList(permissions.paths?.deny, base.permissions.paths.deny),
        confirmOutsideCwd:
          typeof permissions.paths?.confirmOutsideCwd === "boolean"
            ? permissions.paths.confirmOutsideCwd
            : base.permissions.paths.confirmOutsideCwd,
      },
      tools: {
        deny: stringList(permissions.tools?.deny, base.permissions.tools.deny),
        confirm: stringList(permissions.tools?.confirm, base.permissions.tools.confirm),
      },
    },
  };
}

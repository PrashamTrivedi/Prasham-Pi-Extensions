import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_CONFIG,
  classifyToolCall,
  isImplementation,
  isOutsideCwd,
  isPlanningPath,
  isShellConfirm,
  isUnderAnyRoot,
  matchCommand,
  matchPattern,
  strongest,
  writeAllowRoots,
  type PolicyConfig,
} from "../../extensions/sandbox-dev/policy.ts";

const cwd = "/repo/project";

describe("matchPattern", () => {
  test("substring is case-insensitive", () => {
    expect(matchPattern("git push origin main", "GIT PUSH")).toBe(true);
    expect(matchPattern("npm test", "git push")).toBe(false);
  });
  test("slash-delimited patterns are regexes", () => {
    expect(matchPattern("rm -rf build", "/rm\\s+-rf/")).toBe(true);
    expect(matchPattern("rm build", "/rm\\s+-rf/")).toBe(false);
    expect(matchPattern("anything", "/[/")).toBe(false);
  });
});

describe("matchCommand", () => {
  test("matches whole tokens, not substrings inside a token", () => {
    expect(matchCommand("git push origin main", "git push")).toBe(true);
    expect(matchCommand("git pushy", "git push")).toBe(false);
    expect(matchCommand("curly braces", "curl")).toBe(false);
    expect(matchCommand("npm publishing", "npm publish")).toBe(false);
    expect(matchCommand("GIT PUSH origin", "git push")).toBe(true);
  });

  test("a whitespace run in the pattern matches any whitespace", () => {
    expect(matchCommand("git   push origin", "git push")).toBe(true);
    expect(matchCommand("git\tpush origin", "git push")).toBe(true);
    expect(matchCommand("npm  publish --access public", "npm publish")).toBe(true);
  });

  test("`rm -r` does not swallow `rm -rf`", () => {
    expect(matchCommand("rm -r build", "rm -r")).toBe(true);
    expect(matchCommand("rm -rf build", "rm -r")).toBe(false);
    expect(matchCommand("rm -rf build", "rm -rf")).toBe(true);
  });

  test("slash-delimited patterns stay regexes and invalid ones never match", () => {
    expect(matchCommand("rm -rf build", "/rm\\s+-rf/")).toBe(true);
    expect(matchCommand("anything", "/[/")).toBe(false);
  });

  test("empty patterns never match", () => {
    expect(matchCommand("ls", "   ")).toBe(false);
  });
});

describe("isUnderAnyRoot", () => {
  const roots = ["/tmp", join(homedir(), ".pi", "agent")];

  test("absolute and tilde paths resolve into a root", () => {
    expect(isUnderAnyRoot("/tmp/x/y.txt", roots, cwd)).toBe(true);
    expect(isUnderAnyRoot("~/.pi/agent/skills/a/SKILL.md", roots, cwd)).toBe(true);
    expect(isUnderAnyRoot("tmpfile", roots, "/tmp")).toBe(true);
  });

  test("paths outside every root are not", () => {
    expect(isUnderAnyRoot("/etc/hosts", roots, cwd)).toBe(false);
    expect(isUnderAnyRoot("/tmpfoo/x", roots, cwd)).toBe(false);
    expect(isUnderAnyRoot("~/.ssh/id_rsa", roots, cwd)).toBe(false);
    expect(isUnderAnyRoot("", roots, cwd)).toBe(false);
  });
});

describe("writeAllowRoots", () => {
  test("defaults to the Pi agent dir and /tmp", () => {
    expect(writeAllowRoots({})).toEqual([join(homedir(), ".pi", "agent"), "/tmp"]);
  });

  test("PI_SANDBOX_ALLOW_ROOTS extends the list and drops relative entries", () => {
    const roots = writeAllowRoots({ PI_SANDBOX_ALLOW_ROOTS: "/data/scratch:relative/dir:~/notes" });
    expect(roots).toContain("/data/scratch");
    expect(roots).toContain("~/notes");
    expect(roots).not.toContain("relative/dir");
  });
});

describe("isOutsideCwd", () => {
  test("inside paths are inside", () => {
    expect(isOutsideCwd("src/a.ts", cwd)).toBe(false);
    expect(isOutsideCwd("./src/a.ts", cwd)).toBe(false);
    expect(isOutsideCwd(cwd, cwd)).toBe(false);
  });
  test("parent, absolute, and tilde paths are outside", () => {
    expect(isOutsideCwd("../other/a.ts", cwd)).toBe(true);
    expect(isOutsideCwd("/etc/passwd", cwd)).toBe(true);
    expect(isOutsideCwd("~/.ssh/id_rsa", cwd)).toBe(true);
  });
});

describe("isPlanningPath", () => {
  test("taskNotes/ is planning, everything else is implementation", () => {
    expect(isPlanningPath("taskNotes/add-widget/taskFindings.md", cwd)).toBe(true);
    expect(isPlanningPath("taskNotes", cwd)).toBe(true);
    expect(isPlanningPath("src/a.ts", cwd)).toBe(false);
    expect(isPlanningPath("../taskNotes/x", cwd)).toBe(false);
  });
});

describe("classifyToolCall", () => {
  test("deny beats confirm for bash", () => {
    const decision = classifyToolCall({ toolName: "bash", input: { command: "sudo rm -rf /" } }, cwd);
    expect(decision.verdict).toBe("deny");
    expect(decision.flags.some((flag) => flag.startsWith("bash-deny:"))).toBe(true);
  });
  test("push requires confirmation", () => {
    const decision = classifyToolCall({ toolName: "bash", input: { command: "git push origin main" } }, cwd);
    expect(decision.verdict).toBe("confirm");
  });
  test("ordinary commands are allowed", () => {
    expect(classifyToolCall({ toolName: "bash", input: { command: "npm test" } }, cwd).verdict).toBe("allow");
  });
  test("secret paths are denied", () => {
    expect(classifyToolCall({ toolName: "read", input: { path: ".env" } }, cwd).verdict).toBe("deny");
    expect(classifyToolCall({ toolName: "read", input: { path: "~/.ssh/id_rsa" } }, cwd).verdict).toBe("deny");
  });
  test("writes outside the working directory require confirmation", () => {
    expect(classifyToolCall({ toolName: "write", input: { path: "/etc/hosts" } }, cwd).verdict).toBe("confirm");
    expect(classifyToolCall({ toolName: "write", input: { path: "src/a.ts" } }, cwd).verdict).toBe("allow");
  });

  test("reads outside the working directory are allowed", () => {
    for (const path of [
      "~/.pi/agent/skills/brainstorm/SKILL.md",
      "~/.claude/skills/jev-harness/SKILL.md",
      "~/.pi/agent/projects/-repo-project/memory/MEMORY.md",
      "/tmp/scratch.txt",
      "/etc/hosts",
    ]) {
      expect(classifyToolCall({ toolName: "read", input: { path } }, cwd).verdict).toBe("allow");
    }
  });

  test("writes under an allowed root are allowed, and deny still wins there", () => {
    expect(classifyToolCall({ toolName: "write", input: { path: "/tmp/scratch.txt" } }, cwd).verdict).toBe("allow");
    expect(
      classifyToolCall({ toolName: "edit", input: { path: "~/.pi/agent/projects/x/memory/MEMORY.md" } }, cwd).verdict,
    ).toBe("allow");
    expect(classifyToolCall({ toolName: "write", input: { path: "/tmp/.env" } }, cwd).verdict).toBe("deny");
    expect(classifyToolCall({ toolName: "read", input: { path: "/tmp/.env" } }, cwd).verdict).toBe("deny");
  });

  test("installs and network calls no longer confirm; destructive commands still do", () => {
    const allowed = [
      "curl https://localhost:8787",
      "wget x",
      "npm install",
      "bun add left-pad",
      "docker ps",
      "brew list",
      "apt-get update",
    ];
    for (const command of allowed) {
      expect(classifyToolCall({ toolName: "bash", input: { command } }, cwd).verdict).toBe("allow");
    }
    const confirmed = [
      "sudo ls",
      "rm -rf build",
      "rm -r build",
      "git reset --hard",
      "chmod -R 777 .",
      "chown me file",
      "npm publish",
      "git push origin main",
    ];
    for (const command of confirmed) {
      expect(classifyToolCall({ toolName: "bash", input: { command } }, cwd).verdict).toBe("confirm");
    }
  });

  test("a pattern that merely appears in the command does not confirm", () => {
    expect(classifyToolCall({ toolName: "bash", input: { command: "grep -r curl src/" } }, cwd).verdict).toBe("allow");
    expect(classifyToolCall({ toolName: "bash", input: { command: "echo 'npm install runs'" } }, cwd).verdict).toBe("allow");
  });

  test("force push stays a deny", () => {
    expect(classifyToolCall({ toolName: "bash", input: { command: "git push --force origin main" } }, cwd).verdict).toBe(
      "deny",
    );
  });
  test("tool-name rules are configurable and unprefixed tools pass", () => {
    const config: PolicyConfig = { ...DEFAULT_CONFIG, tools: { deny: ["mcp__danger"], confirm: [] } };
    expect(classifyToolCall({ toolName: "mcp__danger", input: {} }, cwd, config).verdict).toBe("deny");
    expect(classifyToolCall({ toolName: "dev_outcome_met", input: {} }, cwd, config).verdict).toBe("allow");
  });
});

describe("isShellConfirm", () => {
  test("is true for bash and powershell, false for other tools", () => {
    expect(isShellConfirm({ toolName: "bash", input: { command: "npm install" } })).toBe(true);
    expect(isShellConfirm({ toolName: "powershell", input: { command: "Get-ChildItem" } })).toBe(true);
    expect(isShellConfirm({ toolName: "write", input: { path: "/etc/hosts" } })).toBe(false);
    expect(isShellConfirm({ toolName: "read", input: { path: "src/a.ts" } })).toBe(false);
  });
});

describe("strongest", () => {
  test("pass-2 can escalate but never de-escalate", () => {
    expect(strongest("deny", "allow")).toBe("deny");
    expect(strongest("allow", "deny")).toBe("deny");
    expect(strongest("confirm", "allow")).toBe("confirm");
    expect(strongest("allow", "confirm")).toBe("confirm");
    expect(strongest("deny", "confirm")).toBe("deny");
  });
});

describe("isImplementation", () => {
  test("source writes are implementation, planning writes are not", () => {
    expect(isImplementation({ toolName: "write", input: { path: "src/a.ts" } }, cwd)).toBe(true);
    expect(isImplementation({ toolName: "edit", input: { path: "src/a.ts" } }, cwd)).toBe(true);
    expect(isImplementation({ toolName: "write", input: { path: "taskNotes/add-widget/taskFindings.md" } }, cwd)).toBe(false);
  });
  test("reads and ordinary commands are not implementation", () => {
    expect(isImplementation({ toolName: "read", input: { path: "src/a.ts" } }, cwd)).toBe(false);
    expect(isImplementation({ toolName: "bash", input: { command: "npm test" } }, cwd)).toBe(false);
  });
  test("implementation commands count", () => {
    expect(isImplementation({ toolName: "bash", input: { command: "git commit -m x" } }, cwd)).toBe(true);
    expect(isImplementation({ toolName: "bash", input: { command: "bun add left-pad" } }, cwd)).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIG,
  classifyToolCall,
  isImplementation,
  isOutsideCwd,
  isPlanningPath,
  isShellConfirm,
  matchPattern,
  strongest,
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

import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, classifyToolCall, isOutsideCwd, matchPattern, mergeConfig, type SandboxDevConfigOverride } from "../../extensions/sandbox-dev/rules.ts";

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

describe("classifyToolCall", () => {
  test("deny beats confirm for bash", () => {
    const decision = classifyToolCall({ toolName: "bash", input: { command: "sudo rm -rf /" } }, DEFAULT_CONFIG, cwd);
    expect(decision.verdict).toBe("deny");
  });
  test("push requires confirmation", () => {
    const decision = classifyToolCall({ toolName: "bash", input: { command: "git push origin main" } }, DEFAULT_CONFIG, cwd);
    expect(decision.verdict).toBe("confirm");
  });
  test("ordinary commands are allowed", () => {
    const decision = classifyToolCall({ toolName: "bash", input: { command: "npm test" } }, DEFAULT_CONFIG, cwd);
    expect(decision.verdict).toBe("allow");
  });
  test("secret paths are denied", () => {
    expect(classifyToolCall({ toolName: "read", input: { path: ".env" } }, DEFAULT_CONFIG, cwd).verdict).toBe("deny");
    expect(classifyToolCall({ toolName: "read", input: { path: "~/.ssh/id_rsa" } }, DEFAULT_CONFIG, cwd).verdict).toBe("deny");
  });
  test("writes outside the working directory require confirmation", () => {
    expect(classifyToolCall({ toolName: "write", input: { path: "/etc/hosts" } }, DEFAULT_CONFIG, cwd).verdict).toBe("confirm");
    expect(classifyToolCall({ toolName: "write", input: { path: "src/a.ts" } }, DEFAULT_CONFIG, cwd).verdict).toBe("allow");
  });
  test("tool-name rules and unprefixed tools", () => {
    const config = mergeConfig(DEFAULT_CONFIG, { permissions: { tools: { deny: ["mcp__danger"] } } });
    expect(classifyToolCall({ toolName: "mcp__danger", input: {} }, config, cwd).verdict).toBe("deny");
    expect(classifyToolCall({ toolName: "dev_outcome_met", input: {} }, config, cwd).verdict).toBe("allow");
  });
});

describe("mergeConfig", () => {
  test("arrays replace and budget is validated", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { budget: 3.9, permissions: { bash: { deny: ["x"], confirm: [] } } });
    expect(merged.budget).toBe(3);
    expect(merged.permissions.bash.deny).toEqual(["x"]);
    expect(merged.permissions.bash.confirm).toEqual([]);
    expect(merged.permissions.paths.deny).toEqual(DEFAULT_CONFIG.permissions.paths.deny);
  });
  test("malformed values fall back to defaults", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { budget: -1, permissions: { bash: { deny: "nope" } } } as unknown as SandboxDevConfigOverride);
    expect(merged.budget).toBe(DEFAULT_CONFIG.budget);
    expect(merged.permissions.bash.deny).toEqual(DEFAULT_CONFIG.permissions.bash.deny);
  });
});

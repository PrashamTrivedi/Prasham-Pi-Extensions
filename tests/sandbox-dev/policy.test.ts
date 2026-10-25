import { describe, expect, test } from "bun:test";
import { BUDGET, isImplementation, isPlanningPath } from "../../extensions/sandbox-dev/policy.ts";

const cwd = "/repo/project";

describe("BUDGET", () => {
  test("supervises eight continuation turns", () => {
    expect(BUDGET).toBe(8);
  });
});

describe("isPlanningPath", () => {
  test("taskNotes/ is planning, everything else is implementation", () => {
    expect(isPlanningPath("taskNotes/add-widget/taskFindings.md", cwd)).toBe(true);
    expect(isPlanningPath("taskNotes", cwd)).toBe(true);
    expect(isPlanningPath("src/a.ts", cwd)).toBe(false);
    expect(isPlanningPath("", cwd)).toBe(false);
    expect(isPlanningPath("../taskNotes/x", cwd)).toBe(false);
    expect(isPlanningPath("/elsewhere/taskNotes/x", cwd)).toBe(false);
  });
});

describe("isImplementation", () => {
  test("source writes are implementation, planning writes are not", () => {
    expect(isImplementation({ toolName: "write", input: { path: "src/a.ts" } }, cwd)).toBe(true);
    expect(isImplementation({ toolName: "edit", input: { path: "src/a.ts" } }, cwd)).toBe(true);
    expect(isImplementation({ toolName: "write", input: { path: "taskNotes/add-widget/taskFindings.md" } }, cwd)).toBe(false);
    expect(isImplementation({ toolName: "write", input: {} }, cwd)).toBe(false);
  });

  test("reads and ordinary commands are not implementation", () => {
    expect(isImplementation({ toolName: "read", input: { path: "src/a.ts" } }, cwd)).toBe(false);
    expect(isImplementation({ toolName: "bash", input: { command: "npm test" } }, cwd)).toBe(false);
    expect(isImplementation({ toolName: "bash", input: { command: "ls" } }, cwd)).toBe(false);
  });

  test("implementation commands count, on both shells", () => {
    expect(isImplementation({ toolName: "bash", input: { command: "git commit -m x" } }, cwd)).toBe(true);
    expect(isImplementation({ toolName: "bash", input: { command: "bun add left-pad" } }, cwd)).toBe(true);
    expect(isImplementation({ toolName: "powershell", input: { command: "yarn install" } }, cwd)).toBe(true);
  });
});

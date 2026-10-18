import { describe, expect, test } from "bun:test";
import { flattenContent, mapToolCall } from "../../extensions/jev-gate/index.ts";

describe("mapToolCall", () => {
  test("maps bash to a shell call with command and description", () => {
    expect(mapToolCall("bash", { command: "rm -rf /tmp/x", description: "cleanup" })).toMatchObject({
      name: "bash",
      kind: "shell",
      command: "rm -rf /tmp/x",
      description: "cleanup",
    });
  });

  test("maps read to a read call with a 1-based range", () => {
    expect(mapToolCall("read", { path: "a.ts", offset: 10, limit: 20 })).toMatchObject({
      name: "read",
      kind: "read",
      path: "a.ts",
      range: { start: 10, end: 29 },
    });
  });

  test("maps edit to an edit call with joined newText", () => {
    expect(mapToolCall("edit", { path: "a.ts", edits: [{ oldText: "x", newText: "y" }, { oldText: "z", newText: "w" }] })).toMatchObject({
      name: "edit",
      kind: "edit",
      path: "a.ts",
      content: "y\nw",
    });
  });

  test("maps spawn_agents to a subagent call", () => {
    expect(mapToolCall("spawn_agents", { agents: [{ model: "flash", task: "do the thing" }] })).toMatchObject({
      name: "spawn_agents",
      kind: "subagent",
      subagentPrompt: "do the thing",
      subagentModel: "flash",
    });
  });

  test("maps mcp__ tools to an mcp call", () => {
    expect(mapToolCall("mcp__memory__find", { q: "x" })).toMatchObject({
      name: "mcp__memory__find",
      kind: "mcp",
      mcpServer: "memory",
      mcpTool: "find",
    });
  });

  test("falls back to other for unknown tools", () => {
    expect(mapToolCall("AskUserQuestion", { questions: [] })).toMatchObject({ name: "AskUserQuestion", kind: "other" });
  });
});

describe("flattenContent", () => {
  test("joins text parts and skips images", () => {
    expect(flattenContent([{ type: "text", text: "a" }, { type: "image", text: "ignored" }, { type: "text", text: "b" }])).toBe("a\nb");
  });

  test("returns empty string for no text", () => {
    expect(flattenContent([{ type: "image", text: "x" }])).toBe("");
  });
});

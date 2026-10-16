import { describe, expect, test } from "bun:test";
import { isMcpTool, mcpResultLines } from "../../extensions/workbench/mcp-renderer.ts";

describe("mcp renderer", () => {
  test("recognises mcp tool names", () => {
    expect(isMcpTool("mcp__kshetra__search")).toBe(true);
    expect(isMcpTool("bash")).toBe(false);
    expect(isMcpTool("spawn_agents")).toBe(false);
  });

  test("collapses long results and expands on request", () => {
    const result = { content: [{ type: "text", text: Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n") }] };
    expect(mcpResultLines(result, false)).toHaveLength(8);
    expect(mcpResultLines(result, true)).toHaveLength(20);
  });

  test("tolerates a non-text result", () => {
    expect(mcpResultLines({ foo: "bar" }, false).join("\n")).toContain("bar");
  });
});

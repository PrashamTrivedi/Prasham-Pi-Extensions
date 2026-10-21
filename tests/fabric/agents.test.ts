import { test, expect } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { assignHues, buildTree, formatElapsed, hueOf, paintAgent, renderAgentRows, type AgentSnapshot } from "../../extensions/fabric/agents.ts";
import type { FabricTheme } from "../../extensions/fabric/ui.ts";

const theme: FabricTheme = { fg: (_: string, text: string) => text, bold: (text: string) => text };
const styled: FabricTheme = { ...theme, appearance: "dark", style: (text: string) => `<${text}>` };

const main: AgentSnapshot = { id: "main", kind: "main", label: "main", model: "flash", status: "idle" };
const agent = (id: string, overrides: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  id, kind: "agent", label: id, model: "qwen", status: "running", parentId: undefined, batchId: `batch-${id}`, ...overrides,
});

test("elapsed time stays short and gives up on unknown input", () => {
  expect(formatElapsed(undefined)).toBe("");
  expect(formatElapsed(Number.NaN)).toBe("");
  expect(formatElapsed(45_000)).toBe("45s");
  expect(formatElapsed(12 * 60_000)).toBe("12m");
  expect(formatElapsed(3 * 60 * 60_000)).toBe("3h");
  expect(formatElapsed(50 * 60 * 60_000)).toBe("2d");
});

test("hues are stable per id and visible agents stay distinguishable", () => {
  expect(hueOf("agent-a")).toBe(hueOf("agent-a"));
  expect(hueOf("agent-a")).not.toBe(hueOf("agent-b"));
  const hues = assignHues(["agent-a", "agent-b", "agent-c", "agent-a"]);
  expect([...hues.keys()]).toEqual(["agent-a", "agent-b", "agent-c"]);
  const values = [...hues.values()];
  for (const [index, value] of values.entries()) {
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
    for (const other of values.slice(index + 1)) expect(Math.abs(value - other)).toBeGreaterThan(0);
  }
  // Generating a colour needs the real theme; without it, a stable token is used instead.
  expect(paintAgent(theme, 0.1, "name")).toBe("name");
  expect(styled.style).toBeDefined();
  expect(paintAgent(styled, 0.1, "name")).toBe("<name>");
});

test("the tree lists main first, then spawn order, indentig grandchildren", () => {
  const rows = buildTree({
    main,
    agents: [agent("api", { parentId: undefined }), agent("tests", { parentId: undefined }), agent("helper", { parentId: "api" })],
    now: Date.parse("2026-01-01T00:10:00.000Z"),
  });
  expect(rows.map((row) => [row.id, row.depth])).toEqual([["main", 0], ["api", 1], ["helper", 2], ["tests", 1]]);
  expect(rows[0]!.kind).toBe("main");
  expect(rows[0]!.label).toBe("main");
});

test("one spawn call with several agents becomes a single group row that opens side by side", () => {
  const agents = [
    agent("api", { batchId: "call-1" }),
    agent("tests", { batchId: "call-1" }),
    agent("solo", { batchId: "call-2" }),
  ];
  // A batch is one row by default: the rows below the prompt never repeat the names.
  const rows = buildTree({ main, agents });
  expect(rows.map((row) => [row.kind, row.id, row.depth])).toEqual([
    ["main", "main", 0],
    ["group", "group:call-1", 1],
    ["agent", "solo", 1],
  ]);
  const group = rows[1]!;
  expect(group.members).toEqual(["api", "tests"]);
  expect(group.label).toBe("2 agents");
  expect(group.status).toBe("running");
  expect(group.collapsed).toBe(true);
  // `/agents` expands it on demand.
  const expanded = buildTree({ main, agents, expandedGroups: new Set(["group:call-1"]) });
  expect(expanded.map((row) => [row.kind, row.id, row.depth])).toEqual([
    ["main", "main", 0],
    ["group", "group:call-1", 1],
    ["agent", "api", 2],
    ["agent", "tests", 2],
    ["agent", "solo", 1],
  ]);
});

test("collapsing a parent or a group hides its descendants and says how many", () => {
  const agents = [agent("api", { batchId: "call-1" }), agent("tests", { batchId: "call-1" }), agent("helper", { parentId: "api", batchId: "call-2" })];
  const groupCollapsed = buildTree({ main, agents });
  expect(groupCollapsed.map((row) => row.id)).toEqual(["main", "group:call-1"]);
  expect(groupCollapsed[1]!.collapsed).toBe(true);
  expect(groupCollapsed[1]!.hiddenChildren).toBe(2);

  const parentCollapsed = buildTree({ main, agents: [agent("api"), agent("helper", { parentId: "api" })], collapsed: new Set(["api"]) });
  expect(parentCollapsed.map((row) => row.id)).toEqual(["main", "api"]);
  expect(parentCollapsed[1]!.hiddenChildren).toBe(1);
});

test("a quiet main agent and a finished child report elapsed time honestly", () => {
  const now = Date.parse("2026-01-01T00:20:00.000Z");
  const rows = buildTree({
    main: { ...main, status: "running", activity: "thinking", startedAt: "2026-01-01T00:08:00.000Z" },
    agents: [agent("done", { status: "done", startedAt: "2026-01-01T00:15:00.000Z", finishedAt: "2026-01-01T00:17:00.000Z" })],
    now,
  });
  expect(rows[0]).toMatchObject({ status: "running", activity: "thinking", elapsedMs: 12 * 60_000 });
  expect(rows[1]).toMatchObject({ status: "done", elapsedMs: 2 * 60_000 });
});

test("rows are one line each, never wrap, and cap with a count", () => {
  const many = Array.from({ length: 9 }, (_, index) => agent(`worker-${index} 界`, { activity: "running a very long command that should be truncated" }));
  const rows = buildTree({ main, agents: many });
  for (const width of [1, 2, 3, 20, 80, 160]) {
    const lines = renderAgentRows(rows, theme, width);
    expect(lines.length).toBeLessThanOrEqual(7);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
  const lines = renderAgentRows(rows, theme, 120);
  expect(lines).toHaveLength(7);
  expect(lines[0]).toContain("main");
  expect(lines[6]).toContain("+ 4 more agents");
  expect(renderAgentRows([], theme, 80)).toEqual([]);
  expect(renderAgentRows(rows, theme, 0)).toEqual([]);
});

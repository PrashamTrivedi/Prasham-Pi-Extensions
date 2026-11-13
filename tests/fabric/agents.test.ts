import { test, expect } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { assignHues, buildTree, formatElapsed, groupCounts, hueOf, paintAgent, renderAgentRows, renderAgentStrip, COMPACT_AGENT_ROWS, type AgentSnapshot } from "../../extensions/fabric/agents.ts";
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
  // Numbers follow the visible order so `/agents 3` (or Alt+3) means something concrete.
  expect(rows.map((row) => row.number)).toEqual([1, 2, 3, 4]);
  expect(renderAgentRows(rows, theme, 120)[3]).toContain("4.");
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
  // A collapsed row names what it hides.
  expect(renderAgentRows(rows, theme, 120)[1]).toContain("2 hidden");
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

test("a group row counts every status, so a failure among running siblings stays visible", () => {
 const agents = [
  agent("api", { batchId: "call-1" }),
  agent("tests", { batchId: "call-1" }),
  agent("flaky", { batchId: "call-1", status: "error", activity: "Tests failed" }),
 ];
 const rows = buildTree({ main, agents });
 const group = rows[1]!;
 // One icon would say only "running"; counts keep the failure on the same line.
 expect(group.status).toBe("running");
 expect(group.counts).toBe("2● 1×");
 const line = renderAgentRows(rows, theme, 120)[1]!;
 expect(line).toContain("2● 1×");
 expect(groupCounts([agent("a", { batchId: "b", status: "done" }), agent("b", { status: "done", batchId: "b" })])).toBe("2✓");
 expect(groupCounts([agent("a", { status: "cancelled" }), agent("b", { status: "error" })])).toBe("2×");
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

test("more than three live agents collapse to one strip, and a failure keeps its own line", () => {
  expect(COMPACT_AGENT_ROWS).toBe(3);
  const agents = [
    agent("run", { status: "running" }),
    agent("wait", { status: "waiting" }),
    agent("done", { status: "done" }),
    agent("bad", { status: "error", activity: "exit 2: tests failed" }),
  ];
  const lines = renderAgentStrip(agents, theme, 120);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toBe("◆ fabric 1● 1◌ 1✓ 1× · /agents");
  // The summary keeps the count, and the failed run is still named with its reason.
  expect(lines[1]).toContain("bad");
  expect(lines[1]).toContain("exit 2: tests failed");
  expect(renderAgentStrip(agents.filter((item) => item.status !== "error"), theme, 120)).toHaveLength(1);
  for (const line of renderAgentStrip(agents, theme, 40)) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
});

test("a wide row carries the folded usage, a narrow one drops it first", () => {
  const rows = buildTree({ main, agents: [agent("api", { usage: "$0.04 · 12k · read", activity: "Running tests" })] });
  const wide = renderAgentRows(rows, theme, 120)[1]!;
  expect(wide).toContain("$0.04 · 12k · read");
  expect(wide).toContain("Running tests");
  const narrow = renderAgentRows(rows, theme, 80)[1]!;
  expect(narrow).not.toContain("$0.04");
  expect(narrow).toContain("Running tests");
  for (const line of renderAgentRows(rows, theme, 40)) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
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

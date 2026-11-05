import { afterAll, test, expect } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { visibleWidth } from "@earendil-works/pi-tui";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { initTheme } from "@earendil-works/pi-coding-agent";
import fabric from "../../extensions/fabric/index.ts";
import { peekHeight } from "../../extensions/fabric/peek.ts";

const theme = { fg: (_: string, text: string) => text, bg: (_: string, text: string) => text, bold: (text: string) => text };
// Pi's own message/tool components read the global theme.
initTheme("dark", false);
type Driver = (view: any, done: (value?: any) => void) => void;

/**
 * Drives the extension with a fake Pi host. `ui.custom` calls take the next
 * driver from the queue, so the `/agents` → transcript → `/agents` chain is testable.
 */
function harness(rootId: string, agents: Record<string, unknown>, entries: any[] = [{ type: "custom", customType: "pi-fabric-root", data: { rootId } }]) {
  // Inside a Fabric child these are set; inheriting them would point a test at the live root.
  delete process.env.PI_FABRIC_AGENT;
  delete process.env.PI_FABRIC_ROOT;
  const dir = join(tmpdir(), "pi-fabric", rootId);
  mkdirSync(join(dir, "outputs"), { recursive: true });
  mkdirSync(join(dir, "sessions"), { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ rootId, repo: "/tmp", config: { maxActiveAgents: 6, models: {} }, agents }));

  const events = new Map<string, Function>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const renderers = new Map<string, Function>();
  const shortcuts = new Map<string, any>();
  const widgets = new Map<string, any>();
  const statuses: Array<[string, string | undefined]> = [];
  const overlays: any[] = [];
  const drivers: Driver[] = [];
  const notified: string[] = [];

  const pi: any = {
    on: (name: string, fn: Function) => events.set(name, fn),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: (name: string, cmd: any) => commands.set(name, cmd),
    registerShortcut: (shortcut: string, options: any) => shortcuts.set(shortcut, options),
    registerEntryRenderer: (name: string, fn: Function) => renderers.set(name, fn),
    appendEntry: (customType: string, data: any) => entries.push({ type: "custom", customType, data }),
  };
  const ctx: any = {
    cwd: "/tmp", mode: "tui", sessionManager: { getBranch: () => entries, getSessionFile: () => undefined },
    ui: {
      theme,
      setWidget: (name: string, widget: any) => widgets.set(name, widget),
      setStatus: (name: string, value?: string) => statuses.push([name, value]),
      notify: (message: string) => notified.push(message),
      custom: async (factory: Function, options?: any) => await new Promise<any>((resolve) => {
        overlays.push(options);
        const driver = drivers.shift();
        if (!driver) { resolve(undefined); return; }
        const view = factory({ requestRender() {}, terminal: { rows: 40 } }, theme, {}, (value?: any) => resolve(value));
        driver(view, (value?: any) => resolve(value));
      }),
    },
  };
  return { dir, ctx, pi, entries, events, tools, commands, renderers, widgets, statuses, overlays, drivers, notified, shortcuts,
    cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const sessionLine = (entry: unknown) => JSON.stringify(entry);
const childSession = (id: string, text: string) => [
  sessionLine({ type: "session", version: 3, id, cwd: "/tmp" }),
  sessionLine({ type: "message", message: { role: "user", content: "Do the thing." } }),
  sessionLine({ type: "message", message: { role: "assistant", content: [{ type: "text", text }] } }),
].join("\n") + "\n";

const env = { agent: process.env.PI_FABRIC_AGENT, root: process.env.PI_FABRIC_ROOT };
afterAll(() => {
  if (env.agent === undefined) delete process.env.PI_FABRIC_AGENT; else process.env.PI_FABRIC_AGENT = env.agent;
  if (env.root === undefined) delete process.env.PI_FABRIC_ROOT; else process.env.PI_FABRIC_ROOT = env.root;
});
delete process.env.PI_FABRIC_AGENT;
delete process.env.PI_FABRIC_ROOT;

test("the rows appear below the prompt with a child, clear when main is alone, and no status line is set", () => {
  const rootId = randomUUID();
  const host = harness(rootId, {
    child: { id: "child", label: "api-refactor", model: "qwen", task: "t", status: "running", startedAt: new Date().toISOString() },
  });
  try {
    fabric(host.pi);
    host.events.get("session_start")!({}, host.ctx);
    const widget = host.widgets.get("pi-fabric-agents");
    expect(widget).toBeDefined();
    const lines = widget({}, theme).render(100);
    expect(lines.join("\n")).toContain("main");
    expect(lines.join("\n")).toContain("api-refactor");
    // No status line and no legacy widget: the rows are the only always-on surface.
    expect(host.statuses).toEqual([]);
    expect(host.widgets.get("pi-fabric")).toBeUndefined();
  } finally { host.events.get("session_shutdown")?.({}, host.ctx); host.cleanup(); }
});

test("with no children the rows are removed entirely", () => {
  const rootId = randomUUID();
  const host = harness(rootId, {});
  try {
    fabric(host.pi);
    host.events.get("session_start")!({}, host.ctx);
    expect(host.widgets.get("pi-fabric-agents")).toBeUndefined();
    expect(host.statuses).toEqual([]);
  } finally { host.events.get("session_shutdown")?.({}, host.ctx); host.cleanup(); }
});

test("the durable result card survives and await_agents still reports its evidence", async () => {
  const rootId = randomUUID();
  const done = { id: "done", label: "Option A", model: "terra", task: "test", status: "done", finishedAt: new Date().toISOString(), resultPath: join(tmpdir(), "pi-fabric", rootId, "outputs", "done.md") };
  const host = harness(rootId, { done });
  writeFileSync(join(host.dir, "outputs", "done.md"), "Measured result, inspect evidence.");
  try {
    fabric(host.pi);
    host.events.get("session_start")!({}, host.ctx);
    expect(host.entries.filter((entry) => entry.customType === "pi-fabric-result").length).toBe(1);
    let progress: any;
    const result = await host.tools.get("await_agents").execute("call", { agentIds: ["done"] }, undefined, (value: any) => progress = value, host.ctx);
    expect(progress.details.ui[0].result).toContain("Measured result");
    // Collapsed (the default) is one line per agent; ctrl+o expands to the cards.
    const collapsed = host.tools.get("await_agents").renderResult(result, { expanded: false }, theme).render(120).join("\n");
    expect(collapsed).toContain("Measured result");
    expect(collapsed).not.toContain("┌");
    expect(host.tools.get("await_agents").renderResult(result, { expanded: true }, theme).render(120).join("\n")).toContain("Measured result");
  } finally { host.events.get("session_shutdown")?.({}, host.ctx); host.cleanup(); }
});

test("/agents lists main and the child, opens the run full-window, and Esc steps back", async () => {
  const rootId = randomUUID();
  const host = harness(rootId, {
    child: { id: "child", label: "api-refactor", model: "qwen", task: "t", status: "running", startedAt: new Date().toISOString(), sessionPath: join(tmpdir(), "pi-fabric", rootId, "sessions", "2026-01-01T00-00-00-000Z_child.jsonl") },
  });
  writeFileSync(join(host.dir, "sessions", "2026-01-01T00-00-00-000Z_child.jsonl"), childSession("child", "Renamed the module and ran the tests."));
  try {
    fabric(host.pi);
    host.events.get("session_start")!({}, host.ctx);
    let listText = "";
    let transcriptText = "";
    let returnedToList = false;
    host.drivers.push((view) => {
      // A full-window screen hides the rows widget so it cannot clip the screen's top.
      expect(host.widgets.get("pi-fabric-agents")).toBeUndefined();
      // Viewport keys and the wheel belong to the screen, never to the chat behind it.
      expect((view as any).capturesViewportInput).toBe(true);
      expect(typeof (view as any).handleMouse).toBe("function");
      listText = view.render(100).join("\n");
      view.handleInput("j");     // main is first; select the child
      view.handleInput("\r");    // open it
    });
    host.drivers.push((view) => {
      const frame = view.render(100);
      transcriptText = frame.join("\n");
      // A full-window screen: it fills the window minus Pi's 3-row footer.
      expect(frame).toHaveLength(37);
      view.handleInput("\u001b"); // back to /agents
    });
    host.drivers.push((view, done) => {
      returnedToList = view.render(100).join("\n").includes("api-refactor");
      done(undefined);            // Esc closes the list
    });
    await host.commands.get("agents").handler("", host.ctx);

    expect(listText).toContain("main");
    expect(listText).toContain("api-refactor");
    expect(transcriptText).toContain("Renamed the module");
    expect(transcriptText).toContain("api-refactor");
    expect(returnedToList).toBe(true);
    // The rows come back once the last screen closes.
    expect(host.widgets.get("pi-fabric-agents")).toBeDefined();
    // The list is an inline full-window screen; the transcript is an opaque overlay
    // covering the chat (only Pi's footer stays visible below it).
    expect(host.overlays[0]).toBeUndefined();
    expect(host.overlays[1]).toEqual({ overlay: true, overlayOptions: { width: "100%", margin: 0, anchor: "top-center" } });
    expect(host.overlays[2]).toBeUndefined();
  } finally { host.events.get("session_shutdown")?.({}, host.ctx); host.cleanup(); }
});

test("o writes a Markdown transcript next to the outputs and reports a missing editor", async () => {
  const rootId = randomUUID();
  const sessionPath = join(tmpdir(), "pi-fabric", rootId, "sessions", "2026-01-01T00-00-00-000Z_child.jsonl");
  const host = harness(rootId, {
    child: { id: "child", label: "api-refactor", model: "qwen", task: "t", status: "running", startedAt: new Date().toISOString(), sessionPath },
  });
  writeFileSync(sessionPath, childSession("child", "Renamed the module and ran the tests."));
  const savedEditor = process.env.PI_FABRIC_EDITOR;
  process.env.PI_FABRIC_EDITOR = "/nonexistent/editor";
  try {
    fabric(host.pi);
    host.events.get("session_start")!({}, host.ctx);
    host.drivers.push((view) => { view.handleInput("j"); view.handleInput("\r"); });
    host.drivers.push((view) => { view.handleInput("o"); view.handleInput("\u001b"); });
    host.drivers.push((_view, done) => done(undefined));
    await host.commands.get("agents").handler("", host.ctx);
    const markdown = readFileSync(join(host.dir, "outputs", "child.transcript.md"), "utf8");
    expect(markdown).toContain("# api-refactor");
    expect(markdown).toContain("## Assistant");
    expect(markdown).toContain("Renamed the module and ran the tests.");
    const last = host.notified.at(-1)!;
    expect(last).toContain("child.transcript.md");
    expect(last).toContain("not on PATH");
  } finally {
    if (savedEditor === undefined) delete process.env.PI_FABRIC_EDITOR; else process.env.PI_FABRIC_EDITOR = savedEditor;
    host.events.get("session_shutdown")?.({}, host.ctx); host.cleanup();
  }
});

test("/agents 2 and a name fragment open a run directly, and bad targets explain", async () => {
  const rootId = randomUUID();
  const sessionPath = join(tmpdir(), "pi-fabric", rootId, "sessions", "2026-01-01T00-00-00-000Z_child.jsonl");
  const host = harness(rootId, {
    child: { id: "child", label: "api-refactor", model: "qwen", task: "t", status: "running", startedAt: new Date().toISOString(), sessionPath },
  });
  writeFileSync(sessionPath, childSession("child", "Opened by number."));
  const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
  // No keybindings file in this agent dir, so Alt+1..9 is free and registers.
  process.env.PI_CODING_AGENT_DIR = join(host.dir, "agent");
  mkdirSync(join(host.dir, "agent"), { recursive: true });
  try {
    fabric(host.pi);
    expect(host.shortcuts.has("alt+2")).toBe(true);
    host.events.get("session_start")!({}, host.ctx);
    // The first row is main, so 2 is the child; no list screen appears.
    let text = "";
    host.drivers.push((view) => { text = view.render(100).join("\n"); view.handleInput("\u001b"); });
    await host.commands.get("agents").handler("2", host.ctx);
    expect(text).toContain("Opened by number.");
    text = "";
    host.drivers.push((view) => { text = view.render(100).join("\n"); view.handleInput("\u001b"); });
    await host.commands.get("agents").handler("api", host.ctx);
    expect(text).toContain("Opened by number.");
    await host.commands.get("agents").handler("9", host.ctx);
    expect(host.notified.at(-1)).toContain("No agent 9");
    await host.commands.get("agents").handler("zzz", host.ctx);
    expect(host.notified.at(-1)).toContain("No live agent matches");
    // Alt+2 is wired to the same row-number path.
    text = "";
    host.drivers.push((view) => { text = view.render(100).join("\n"); view.handleInput("\u001b"); });
    await host.shortcuts.get("alt+2").handler(host.ctx);
    expect(text).toContain("Opened by number.");
  } finally {
    if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
    host.events.get("session_shutdown")?.({}, host.ctx); host.cleanup();
  }
});

test("a spawn batch opens one agent at a time, full width, and tab shows the next", async () => {
  const rootId = randomUUID();
  const host = harness(rootId, {
    "alpha-1111": { id: "alpha-1111", label: "Alpha", model: "qwen", task: "t", status: "done", batchId: "call-1", finishedAt: new Date().toISOString(), sessionPath: join(tmpdir(), "pi-fabric", rootId, "sessions", "2026-01-01T00-00-00-000Z_alpha-1111.jsonl") },
    "beta-2222": { id: "beta-2222", label: "Beta", model: "qwen", task: "t", status: "done", batchId: "call-1", finishedAt: new Date().toISOString(), sessionPath: join(tmpdir(), "pi-fabric", rootId, "sessions", "2026-01-01T00-00-00-000Z_beta-2222.jsonl") },
  });
  writeFileSync(join(host.dir, "sessions", "2026-01-01T00-00-00-000Z_alpha-1111.jsonl"), childSession("alpha-1111", "Alpha finished first."));
  writeFileSync(join(host.dir, "sessions", "2026-01-01T00-00-00-000Z_beta-2222.jsonl"), childSession("beta-2222", "Beta finished second."));
  try {
    fabric(host.pi);
    host.events.get("session_start")!({}, host.ctx);
    let listText = "";
    let firstText = "";
    let secondText = "";
    host.drivers.push((view) => {
      // A full-window screen hides the rows widget so it cannot clip the screen's top.
      expect(host.widgets.get("pi-fabric-agents")).toBeUndefined();
      // Viewport keys and the wheel belong to the screen, never to the chat behind it.
      expect((view as any).capturesViewportInput).toBe(true);
      expect(typeof (view as any).handleMouse).toBe("function");
      listText = view.render(100).join("\n");
      view.handleInput("j");   // the group row sits under main
      view.handleInput("\r");
    });
    host.drivers.push((view) => {
      firstText = view.render(100).join("\n");
      view.handleInput("\t");  // next member of the batch
      secondText = view.render(100).join("\n");
      view.handleInput("\u001b");
    });
    host.drivers.push((_view, done) => done(undefined));
    await host.commands.get("agents").handler("", host.ctx);

    expect(listText).toContain("2 agents");
    // One full-width column: only the focused member is on screen.
    expect(firstText).toContain("Alpha finished first.");
    expect(firstText).not.toContain("Beta finished second.");
    expect(firstText).toContain("Alpha 1/2");
    expect(firstText).not.toContain("│");
    expect(secondText).toContain("Beta finished second.");
    expect(secondText).toContain("Beta 2/2");
  } finally { host.events.get("session_shutdown")?.({}, host.ctx); host.cleanup(); }
});

test("the peek panel is off by default, and docks non-capturing when the config opts in", async () => {
  // Off by default: no shortcut is registered and no keybinding is taken.
  const offHost = harness(randomUUID(), { child: { id: "child", label: "api", model: "qwen", task: "t", status: "running" } });
  try {
    fabric(offHost.pi);
    expect(offHost.shortcuts.has("ctrl+alt+f")).toBe(false);
  } finally { offHost.cleanup(); }

  const rootId = randomUUID();
  const sessionPath = join(tmpdir(), "pi-fabric", rootId, "sessions", "2026-01-01T00-00-00-000Z_child.jsonl");
  const host = harness(rootId, {
    child: { id: "child", label: "api", model: "qwen", task: "t", status: "running", startedAt: new Date().toISOString(), sessionPath },
  });
  writeFileSync(sessionPath, childSession("child", "Peek tail."));
  const configPath = join(tmpdir(), `fabric-peek-${rootId}.json`);
  writeFileSync(configPath, JSON.stringify({ maxActiveAgents: 6, models: {}, peekPanel: true }));
  const saved = process.env.PI_FABRIC_CONFIG;
  process.env.PI_FABRIC_CONFIG = configPath;
  try {
    fabric(host.pi);
    expect(host.shortcuts.get("ctrl+alt+f")?.description).toContain("Peek");
    host.events.get("session_start")!({}, host.ctx);
    let frame: string[] = [];
    host.drivers.push((view) => { frame = view.render(60); });
    const pending = host.shortcuts.get("ctrl+alt+f").handler(host.ctx);
    expect(frame).toHaveLength(peekHeight(40));
    expect(frame.join("\n")).toContain("◆ peek · api");
    expect(frame.join("\n")).toContain("Peek tail.");
    for (const line of frame) expect(visibleWidth(line)).toBeLessThanOrEqual(60);
    expect(host.overlays.at(-1)).toMatchObject({ overlay: true, overlayOptions: { nonCapturing: true } });
    // The same shortcut closes the panel instead of stacking a second one.
    await host.shortcuts.get("ctrl+alt+f").handler(host.ctx);
    await pending;
    expect(host.overlays).toHaveLength(1);
  } finally {
    if (saved === undefined) delete process.env.PI_FABRIC_CONFIG; else process.env.PI_FABRIC_CONFIG = saved;
    rmSync(configPath, { force: true });
    host.events.get("session_shutdown")?.({}, host.ctx); host.cleanup();
  }
});


test("more than three live agents collapse the rows to one strip, with failures on their own line", async () => {
  const rootId = randomUUID();
  const now = new Date().toISOString();
  const host = harness(rootId, {
    "run-1": { id: "run-1", label: "Runner one", model: "qwen", task: "t", status: "running", startedAt: now },
    "run-2": { id: "run-2", label: "Runner two", model: "qwen", task: "t", status: "running", startedAt: now },
    "run-3": { id: "run-3", label: "Runner three", model: "qwen", task: "t", status: "waiting", startedAt: now },
    "bad-4": { id: "bad-4", label: "Broken four", model: "qwen", task: "t", status: "error", finishedAt: now, error: "exit 3: build failed\nstack" },
  });
  try {
    fabric(host.pi);
    host.events.get("session_start")!({}, host.ctx);
    const lines = host.widgets.get("pi-fabric-agents")({}, theme).render(100);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("◆ fabric 2● 1◌ 1× · /agents");
    expect(lines[1]).toContain("Broken four");
    expect(lines[1]).toContain("exit 3: build failed");
    // The tree itself stays available in /agents.
    let listText = "";
    host.drivers.push((view, done) => { listText = view.render(100).join("\n"); done(undefined); });
    await host.commands.get("agents").handler("", host.ctx);
    expect(listText).toContain("Runner one");
    expect(listText).toContain("Broken four");
  } finally { host.events.get("session_shutdown")?.({}, host.ctx); host.cleanup(); }
});

test("per-agent cost, tokens and last tool are folded from the child session", async () => {
  const rootId = randomUUID();
  const sessionPath = join(tmpdir(), "pi-fabric", rootId, "sessions", "2026-01-01T00-00-00-000Z_child.jsonl");
  const usageLine = (tokens: number, cost: number, tool: string) => JSON.stringify({
    type: "message",
    message: { role: "assistant", content: [{ type: "text", text: "work" }, { type: "toolCall", name: tool }], usage: { input: tokens, output: 10, totalTokens: tokens, cost: { total: cost } } },
  });
  const host = harness(rootId, {
    child: { id: "child", label: "api-refactor", model: "qwen", task: "t", status: "done", finishedAt: new Date().toISOString(), sessionPath, resultPath: join(tmpdir(), "pi-fabric", rootId, "outputs", "child.md") },
  });
  writeFileSync(sessionPath, `${usageLine(12_000, 0.04, "read")}\n${usageLine(3_000, 0.01, "bash")}\n`);
  writeFileSync(join(host.dir, "outputs", "child.md"), "Done.");
  try {
    fabric(host.pi);
    host.events.get("session_start")!({}, host.ctx);
    // Wide rows show the fold of both turns; a narrow row drops it first.
    const wide = host.widgets.get("pi-fabric-agents")({}, theme).render(120).join("\n");
    expect(wide).toContain("$0.05 · 15k · bash");
    expect(host.widgets.get("pi-fabric-agents")({}, theme).render(80).join("\n")).not.toContain("$0.05");
    // The recorded result card carries the real numbers instead of "agent-reported".
    const entry = host.entries.find((item) => item.customType === "pi-fabric-result")!;
    expect(entry.data.agents[0]).toMatchObject({ cost: 0.05, tokens: 15_000, lastTool: "bash" });
    const card = host.renderers.get("pi-fabric-result")!(entry, { expanded: true }, theme).render(120).join("\n");
    expect(card).toContain("cost: $0.05");
    expect(card).toContain("tokens: 15k");
    expect(card).toContain("tool: bash");
    expect(card).not.toContain("agent-reported");
  } finally { host.events.get("session_shutdown")?.({}, host.ctx); host.cleanup(); }
});

test("an agent idle for ten minutes is gone from the UI but still reported by agent_status", async () => {
  const rootId = randomUUID();
  const host = harness(rootId, {
    stale: { id: "stale", label: "Stale run", model: "qwen", task: "t", status: "done", finishedAt: new Date(Date.now() - 15 * 60_000).toISOString() },
    busy: { id: "busy", label: "Busy run", model: "qwen", task: "t", status: "running", startedAt: new Date().toISOString() },
  });
  try {
    fabric(host.pi);
    host.events.get("session_start")!({}, host.ctx);
    const rows = host.widgets.get("pi-fabric-agents")({}, theme).render(100).join("\n");
    expect(rows).toContain("Busy run");
    expect(rows).not.toContain("Stale run");

    let listText = "";
    host.drivers.push((view, done) => { listText = view.render(100).join("\n"); done(undefined); });
    await host.commands.get("agents").handler("", host.ctx);
    expect(listText).toContain("Busy run");
    expect(listText).not.toContain("Stale run");

    const status = await host.tools.get("agent_status").execute("call", {}, undefined, undefined, host.ctx);
    expect(status.content[0].text).toContain("Stale run");
    expect(status.content[0].text).toContain("gone from the rows and /agents");
  } finally { host.events.get("session_shutdown")?.({}, host.ctx); host.cleanup(); }
});

test("a failure is explained on its row, counted in its group, toasts once, and stays until opened", async () => {
  const rootId = randomUUID();
  const old = new Date(Date.now() - 30 * 60_000).toISOString();
  const sessionPath = join(tmpdir(), "pi-fabric", rootId, "sessions", "2026-01-01T00-00-00-000Z_broken.jsonl");
  const host = harness(rootId, {
    broken: { id: "broken", label: "Broken", model: "qwen", task: "t", status: "error", finishedAt: old, sessionPath, error: "exit 2: tests failed\n      stack frame" },
    "run-3333": { id: "run-3333", label: "Run", model: "qwen", task: "t", status: "running", batchId: "call-1", startedAt: new Date().toISOString() },
    "bad-2222": { id: "bad-2222", label: "Bad", model: "qwen", task: "t", status: "error", batchId: "call-1", finishedAt: old, error: "second failure" },
  });
  writeFileSync(sessionPath, childSession("broken", "Failure transcript."));
  try {
    fabric(host.pi);
    host.events.get("session_start")!({}, host.ctx);
    const rows = () => host.widgets.get("pi-fabric-agents")({}, theme).render(100).join("\n");
    // A failed run older than the sweep still shows, with its first error line, not its last activity.
    expect(rows()).toContain("Broken");
    expect(rows()).toContain("exit 2: tests failed");
    expect(rows()).not.toContain("stack frame");
    // The group row keeps the failure visible next to its running sibling.
    expect(rows()).toContain("1● 1×");
    // One toast per failure; a second refresh pass does not repeat them.
    const failures = () => host.notified.filter((message) => message.includes("failed"));
    expect(failures()).toHaveLength(2);
    host.events.get("session_start")!({}, host.ctx);
    expect(failures()).toHaveLength(2);

    // Opening the run acknowledges the failure and it leaves the rows.
    host.drivers.push((view) => { view.handleInput("j"); view.handleInput("\r"); });
    host.drivers.push((view) => { expect(view.render(100).join("\n")).toContain("Failure transcript."); view.handleInput("\u001b"); });
    host.drivers.push((_view, done) => done(undefined));
    await host.commands.get("agents").handler("", host.ctx);
    const state = JSON.parse(readFileSync(join(host.dir, "state.json"), "utf8"));
    expect(state.agents.broken.dismissed).toBe(true);
    expect(state.agents["bad-2222"].dismissed).toBeUndefined();
    expect(rows()).not.toContain("Broken");
    expect(rows()).toContain("1● 1×");
  } finally { host.events.get("session_shutdown")?.({}, host.ctx); host.cleanup(); }
});

test("x then y in /agents cancels a run and its descendants", async () => {
  const rootId = randomUUID();
  const host = harness(rootId, {
    parent: { id: "parent", label: "Parent", model: "qwen", task: "t", status: "running", startedAt: new Date().toISOString() },
    kid: { id: "kid", label: "Kid", model: "qwen", task: "t", status: "running", parentId: "parent", startedAt: new Date().toISOString() },
  });
  try {
    fabric(host.pi);
    host.events.get("session_start")!({}, host.ctx);
    host.drivers.push((view, done) => {
      view.handleInput("j");   // the child under main
      view.handleInput("x");
      view.handleInput("y");
      done(undefined);
    });
    await host.commands.get("agents").handler("", host.ctx);
    const state = JSON.parse(readFileSync(join(host.dir, "state.json"), "utf8"));
    expect(state.agents.parent.status).toBe("cancelled");
    expect(state.agents.kid.status).toBe("cancelled");
  } finally { host.events.get("session_shutdown")?.({}, host.ctx); host.cleanup(); }
});

test("a stray Fabric environment never binds a test to the live root", async () => {
  process.env.PI_FABRIC_ROOT = "a-root-that-is-not-the-test-root";
  process.env.PI_FABRIC_AGENT = "some-child";
  const rootId = randomUUID();
  const host = harness(rootId, { only: { id: "only", label: "Test run", model: "terra", task: "t", status: "running" } });
  try {
    fabric(host.pi);
    expect(process.env.PI_FABRIC_ROOT).toBeUndefined();
    expect(process.env.PI_FABRIC_AGENT).toBeUndefined();
    host.events.get("session_start")!({}, host.ctx);
    const rows = host.widgets.get("pi-fabric-agents")({}, theme).render(100).join("\n");
    expect(rows).toContain("Test run");
  } finally { host.events.get("session_shutdown")?.({}, host.ctx); host.cleanup(); }
});


test("cancelling a group row cancels every member of that spawn batch", async () => {
  const rootId = randomUUID();
  const host = harness(rootId, {
    "alpha-1111": { id: "alpha-1111", label: "Alpha", model: "qwen", task: "t", status: "running", batchId: "call-1", startedAt: new Date().toISOString() },
    "beta-2222": { id: "beta-2222", label: "Beta", model: "qwen", task: "t", status: "running", batchId: "call-1", startedAt: new Date().toISOString() },
  });
  try {
    fabric(host.pi);
    host.events.get("session_start")!({}, host.ctx);
    host.drivers.push((view, done) => {
      view.handleInput("j");   // the group row
      view.handleInput("x");
      view.handleInput("y");
      done(undefined);
    });
    await host.commands.get("agents").handler("", host.ctx);
    const state = JSON.parse(readFileSync(join(host.dir, "state.json"), "utf8"));
    expect(state.agents["alpha-1111"].status).toBe("cancelled");
    expect(state.agents["beta-2222"].status).toBe("cancelled");
  } finally { host.events.get("session_shutdown")?.({}, host.ctx); host.cleanup(); }
});

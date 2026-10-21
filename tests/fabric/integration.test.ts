import { afterAll, test, expect } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import fabric from "../../extensions/fabric/index.ts";

const theme = { fg: (_: string, text: string) => text, bg: (_: string, text: string) => text, bold: (text: string) => text };
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
  const widgets = new Map<string, any>();
  const statuses: Array<[string, string | undefined]> = [];
  const overlays: any[] = [];
  const drivers: Driver[] = [];
  const notified: string[] = [];

  const pi: any = {
    on: (name: string, fn: Function) => events.set(name, fn),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: (name: string, cmd: any) => commands.set(name, cmd),
    registerShortcut: () => {},
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
  return { dir, ctx, pi, entries, events, tools, commands, renderers, widgets, statuses, overlays, drivers, notified,
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
    // Both screens are full-window custom screens, not overlays.
    expect(host.overlays).toEqual([undefined, undefined, undefined]);
  } finally { host.events.get("session_shutdown")?.({}, host.ctx); host.cleanup(); }
});

test("a spawn batch opens as two columns and a group member can be read alone with s", async () => {
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
    let splitText = "";
    let singleText = "";
    host.drivers.push((view) => {
      // A full-window screen hides the rows widget so it cannot clip the screen's top.
      expect(host.widgets.get("pi-fabric-agents")).toBeUndefined();
      listText = view.render(100).join("\n");
      view.handleInput("j");   // the group row sits under main
      view.handleInput("\r");
    });
    host.drivers.push((view) => {
      splitText = view.render(100).join("\n");
      view.handleInput("s");   // one column
      singleText = view.render(100).join("\n");
      view.handleInput("\u001b");
    });
    host.drivers.push((_view, done) => done(undefined));
    await host.commands.get("agents").handler("", host.ctx);

    expect(listText).toContain("2 agents");
    expect(splitText).toContain("Alpha finished first.");
    expect(splitText).toContain("Beta finished second.");
    expect(splitText).toContain("│");
    expect(singleText).not.toContain("│");
    expect(singleText).toContain("tab focus");
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

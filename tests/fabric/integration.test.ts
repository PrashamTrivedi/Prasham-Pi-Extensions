import { test, expect } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import fabric from "../../extensions/fabric/index.ts";
import { publishActivity } from "../../extensions/fabric/activity.ts";

const theme = { fg: (_: string, text: string) => text, bg: (_: string, text: string) => text, bold: (text: string) => text };
type Driver = (view: any, done: (value?: any) => void) => void;

/**
 * Drives the extension with a fake Pi host. Every `ui.custom` call takes the next
 * driver from the queue, so a multi-overlay flow (`/team` → transcript) is testable.
 */
function harness(rootId: string, agents: Record<string, unknown>, entries: any[] = [{ type: "custom", customType: "pi-fabric-root", data: { rootId } }]) {
  const dir = join(tmpdir(), "pi-fabric", rootId);
  mkdirSync(join(dir, "outputs"), { recursive: true });
  mkdirSync(join(dir, "sessions"), { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ rootId, repo: "/tmp", config: { maxActiveAgents: 6, models: {} }, agents }));

  const events = new Map<string, Function>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const shortcuts = new Map<string, any>();
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
    registerShortcut: (key: string, options: any) => shortcuts.set(key, options),
    registerEntryRenderer: (name: string, fn: Function) => renderers.set(name, fn),
    appendEntry: (customType: string, data: any) => entries.push({ type: "custom", customType, data }),
  };
  const ctx: any = {
    cwd: "/tmp", mode: "tui", sessionManager: { getBranch: () => entries },
    ui: {
      theme,
      setWidget: (name: string, widget: any) => widgets.set(name, widget),
      setStatus: (name: string, value?: string) => statuses.push([name, value]),
      notify: (message: string) => notified.push(message),
      custom: async (factory: Function, options?: any) => await new Promise<any>((resolve) => {
        overlays.push(options?.overlayOptions);
        const driver = drivers.shift();
        if (!driver) { resolve(undefined); return; }
        const view = factory({ requestRender() {}, terminal: { rows: 40 } }, theme, {}, (value?: any) => resolve(value));
        driver(view, (value?: any) => resolve(value));
      }),
    },
  };
  return { dir, ctx, pi, entries, events, tools, commands, shortcuts, renderers, widgets, statuses, overlays, drivers, notified,
    cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const env = { agent: process.env.PI_FABRIC_AGENT, root: process.env.PI_FABRIC_ROOT };
function restoreEnv() {
  if (env.agent === undefined) delete process.env.PI_FABRIC_AGENT; else process.env.PI_FABRIC_AGENT = env.agent;
  if (env.root === undefined) delete process.env.PI_FABRIC_ROOT; else process.env.PI_FABRIC_ROOT = env.root;
}
delete process.env.PI_FABRIC_AGENT;
delete process.env.PI_FABRIC_ROOT;

test("restores the root, keeps the status line, records a durable result, and opens the inspector", async () => {
  const rootId = randomUUID();
  const host = harness(rootId, {
    done: { id: "done", label: "Option A", model: "terra", task: "test", status: "done", resultPath: join(tmpdir(), "pi-fabric", rootId, "outputs", "done.md") },
    running: { id: "running", label: "Option B", model: "terra", task: "test", status: "running" },
  });
  writeFileSync(join(host.dir, "outputs", "done.md"), "Measured result, inspect evidence.");
  publishActivity(host.dir, "running", "activity", "Running read");
  let inspectorLines: string[] = [];
  try {
    fabric(host.pi);
    host.events.get("session_start")!({}, host.ctx);

    // Spec C: the compact pane is gone (even a stale one is cleared); the status line is the only persistent surface.
    expect(host.widgets.get("pi-fabric")).toBeUndefined();
    expect(host.widgets.size).toBe(1);
    const status = host.statuses.at(-1)!;
    expect(status[0]).toBe("pi-fabric");
    expect(status[1]).toContain("fabric");

    expect(host.entries.filter(entry => entry.customType === "pi-fabric-result").length).toBe(1);

    let progress: any;
    const result = await host.tools.get("await_agents").execute("call", { agentIds: ["done"] }, undefined, (value: any) => progress = value, host.ctx);
    expect(progress.details.ui[0].result).toContain("Measured result");
    expect(host.tools.get("await_agents").renderResult(result, { expanded: true }, theme).render(120).join("\n")).toContain("Measured result");

    host.drivers.push((view, done) => {
      inspectorLines = view.render(120);
      view.handleInput("\t");
      expect(view.render(120).join("\n")).toContain("activity");
      view.handleInput("\u001b");
      done(undefined);
    });
    await host.commands.get("team").handler("", host.ctx);
    expect(inspectorLines.join("\n")).toContain("Option B");

    // hide/show now toggle the status line rather than a widget.
    await host.commands.get("team").handler("hide", host.ctx);
    expect(host.statuses.at(-1)![1]).toBeUndefined();
    await host.commands.get("team").handler("show", host.ctx);
    expect(host.statuses.at(-1)![1]).toContain("fabric");
    expect(host.entries.filter(entry => entry.customType === "pi-fabric-result").length).toBe(1);
  } finally {
    host.events.get("session_shutdown")?.({}, host.ctx);
    host.cleanup(); restoreEnv();
  }
});

test("finished runs leave the live team view, /team all reveals them, and enter replays the saved transcript", async () => {
  const rootId = randomUUID();
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  // `stale` has no recorded sessionPath: the viewer must find the file by suffix.
  const host = harness(rootId, {
    fresh: { id: "fresh", label: "Fresh run", model: "terra", task: "test", status: "done", finishedAt: new Date().toISOString() },
    stale: { id: "stale", label: "Stale run", model: "terra", task: "test", status: "done", finishedAt: stale },
    busy: { id: "busy", label: "Busy run", model: "terra", task: "test", status: "running" },
  });
  const transcript = [
    { type: "session", version: 3, id: "stale", timestamp: stale, cwd: "/tmp" },
    { type: "message", id: "1", parentId: null, timestamp: stale, message: { role: "user", content: "Summarize the failure." } },
    { type: "message", id: "2", parentId: "1", timestamp: stale, message: { role: "assistant", content: [{ type: "text", text: "The stale run failed on the lock." }, { type: "toolCall", id: "c", name: "bash", arguments: { command: "false" } }] } },
    { type: "message", id: "3", parentId: "2", timestamp: stale, message: { role: "toolResult", toolCallId: "c", toolName: "bash", content: [{ type: "text", text: "exit 1" }], isError: true } },
  ];
  writeFileSync(join(host.dir, "sessions", "2026-01-01T00-00-00-000Z_stale.jsonl"), transcript.map(entry => JSON.stringify(entry)).join("\n"));
  try {
    fabric(host.pi);
    host.events.get("session_start")!({}, host.ctx);
    expect(host.statuses.at(-1)![1]).toContain("1 archived");

    let prunedView = "";
    let allView = "";
    let transcriptView = "";
    let returnedToInspector = false;
    host.drivers.push((view) => {
      prunedView = view.render(120).join("\n");
      view.handleInput("a"); // toggle to all runs
      allView = view.render(120).join("\n");
      view.handleInput("j"); // select `stale`
      view.handleInput("\r"); // open its transcript
    });
    host.drivers.push((view) => {
      const frame = view.render(120);
      // A custom screen owns the interactive area: it fills the window minus Pi's 3-row footer.
      expect(frame).toHaveLength(37);
      transcriptView = frame.join("\n");
      view.handleInput("\u001b"); // back to the inspector
    });
    host.drivers.push((view, done) => {
      returnedToInspector = true;
      view.handleInput("\u001b");
      done(undefined);
    });
    await host.commands.get("team").handler("", host.ctx);

    expect(prunedView).toContain("Fresh run");
    expect(prunedView).toContain("Busy run");
    expect(prunedView).not.toContain("Stale run");
    expect(allView).toContain("Stale run");
    expect(transcriptView).toContain("Stale run");
    expect(transcriptView).toContain("Summarize the failure.");
    expect(transcriptView).toContain("The stale run failed on the lock.");
    expect(transcriptView).toContain("exit 1");
    expect(returnedToInspector).toBe(true);
    // The transcript takes the whole Pi window: `ui.custom` without `overlay`, so the chat is replaced.
    expect(host.overlays).toHaveLength(3);
    expect(host.overlays[0]).toMatchObject({ width: "95%", maxHeight: "90%" }); // inspector
    expect(host.overlays[1]).toBeUndefined(); // transcript, full screen
    expect(host.overlays[2]).toMatchObject({ width: "95%", maxHeight: "90%" }); // inspector again

    // Forensics: agent_status still lists the pruned run and says why it is hidden.
    const status = await host.tools.get("agent_status").execute("call", {}, undefined, undefined, host.ctx);
    expect(status.content[0].text).toContain("Stale run");
    expect(status.content[0].text).toContain("hidden from the live /team views");
    expect(host.notified).toEqual([]);
  } finally {
    host.events.get("session_shutdown")?.({}, host.ctx);
    host.cleanup(); restoreEnv();
  }
});

test("a run without a saved session says so instead of opening an empty viewer", async () => {
  const rootId = randomUUID();
  const host = harness(rootId, { queued: { id: "queued", label: "Queued run", model: "terra", task: "test", status: "queued" } });
  try {
    fabric(host.pi);
    host.events.get("session_start")!({}, host.ctx);
    host.drivers.push((view) => { view.handleInput("\r"); });
    host.drivers.push((_view, done) => done(undefined)); // inspector reopened after the notice
    await host.commands.get("team").handler("", host.ctx);
    expect(host.notified.join("\n")).toContain("no saved transcript");
    expect(host.overlays).toHaveLength(2); // inspector, inspector again — no transcript overlay
  } finally {
    host.events.get("session_shutdown")?.({}, host.ctx);
    host.cleanup(); restoreEnv();
  }
});

test("/transcript opens a run without /team: picker, direct id/label, and the alt+t shortcut", async () => {
  const rootId = randomUUID();
  const host = harness(rootId, {
    // Distinct timestamps make the newest-first order deterministic: beta, then alpha.
    "alpha-1111": { id: "alpha-1111", label: "Version check", model: "terra", task: "t", status: "done", finishedAt: new Date(Date.now() - 10 * 60_000).toISOString() },
    "beta-2222": { id: "beta-2222", label: "Line counts", model: "terra", task: "t", status: "running", startedAt: new Date(Date.now() - 60_000).toISOString() },
  });
  const line = (entry: unknown) => JSON.stringify(entry);
  writeFileSync(join(host.dir, "sessions", "2026-01-01T00-00-00-000Z_alpha-1111.jsonl"), [
    line({ type: "session", version: 3, id: "alpha-1111", cwd: "/tmp" }),
    line({ type: "message", message: { role: "user", content: "Report the version." } }),
    line({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Version 0.1.0." }] } }),
  ].join("\n"));
  writeFileSync(join(host.dir, "sessions", "2026-01-01T00-00-00-000Z_beta-2222.jsonl"), [
    line({ type: "session", version: 3, id: "beta-2222", cwd: "/tmp" }),
    line({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Counting lines." }] } }),
  ].join("\n"));
  try {
    fabric(host.pi);
    host.events.get("session_start")!({}, host.ctx);

    // The shortcut is registered and reaches the same picker.
    expect([...host.shortcuts.keys()]).toEqual(["alt+t"]);

    // No argument: a picker lists every run, newest first.
    let pickerText = "";
    let transcriptText = "";
    host.drivers.push((view) => {
      pickerText = view.render(100).join("\n");
      expect(pickerText).toContain("Line counts");
      view.handleInput("j"); // newest first: beta, then alpha
      view.handleInput("\r"); // open it
    });
    host.drivers.push((view) => {
      transcriptText = view.render(100).join("\n");
      expect(view.render(100)).toHaveLength(37);
      view.handleInput("\u001b"); // back to the picker
    });
    host.drivers.push((_view, done) => done(undefined)); // esc closes the picker
    await host.commands.get("transcript").handler("", host.ctx);

    expect(pickerText).toContain("Run transcripts");
    expect(pickerText).toContain("Version check");
    expect(pickerText).toContain("Line counts");
    expect(pickerText).not.toContain("no transcript yet");
    expect(transcriptText).toContain("Report the version.");
    expect(transcriptText).toContain("Version 0.1.0.");
    expect(host.overlays.filter(option => option === undefined)).toHaveLength(1); // only the transcript is full screen

    // An id prefix opens directly, with no picker at all.
    let direct = "";
    host.drivers.push((view, done) => { direct = view.render(100).join("\n"); done(undefined); });
    await host.commands.get("transcript").handler("beta-2", host.ctx);
    expect(direct).toContain("Counting lines.");
    expect(direct).not.toContain("Report the version.");

    // A label fragment works too; an unknown query only notifies.
    host.drivers.push((view, done) => { done(undefined); expect(view.render(100).join("\n")).toContain("Report the version."); });
    await host.commands.get("transcript").handler("version check", host.ctx);
    host.drivers.length = 0;
    await host.commands.get("transcript").handler("nope", host.ctx);
    expect(host.notified.join("\n")).toContain("No Fabric run matches 'nope'");
  } finally {
    host.events.get("session_shutdown")?.({}, host.ctx);
    host.cleanup(); restoreEnv();
  }
});

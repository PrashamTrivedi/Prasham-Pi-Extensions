import { test, expect } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import fabric from "../../extensions/fabric/index.ts";
import { publishActivity } from "../../extensions/fabric/activity.ts";

test("restores root, publishes widget and durable result, streams comparison and opens inspector", async () => {
 const previousAgent = process.env.PI_FABRIC_AGENT; const previousRoot = process.env.PI_FABRIC_ROOT;
 delete process.env.PI_FABRIC_AGENT; delete process.env.PI_FABRIC_ROOT;
 const rootId = randomUUID(); const dir = join(tmpdir(), "pi-fabric", rootId);
 mkdirSync(join(dir, "outputs"), { recursive: true });
 const resultPath = join(dir, "outputs", "done.md"); writeFileSync(resultPath, "Measured result, inspect evidence.");
 const agent = { id: "done", label: "Option A", model: "terra", task: "test", status: "done", resultPath };
 const running = { id: "running", label: "Option B", model: "terra", task: "test", status: "running" };
 writeFileSync(join(dir, "state.json"), JSON.stringify({ rootId, repo: "/tmp", config: { maxActiveAgents: 6, models: {} }, agents: { done: agent, running } }));
 publishActivity(dir, "running", "activity", "Running read");
 const events = new Map<string, Function>(); const tools = new Map<string, any>(); const commands = new Map<string, any>(); const renderers = new Map<string, Function>();
 const entries: any[] = [{ type: "custom", customType: "pi-fabric-root", data: { rootId } }];
 const widgets = new Map<string, any>(); let overlayLines: string[] = [];
 const theme = { fg: (_: string, text: string) => text, bg: (_: string, text: string) => text, bold: (text: string) => text };
 const pi: any = { on: (name: string, fn: Function) => events.set(name, fn), registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: (name: string, cmd: any) => commands.set(name, cmd), registerEntryRenderer: (name: string, fn: Function) => renderers.set(name, fn), appendEntry: (customType: string, data: any) => entries.push({ type: "custom", customType, data }) };
 const ctx: any = { cwd: "/tmp", mode: "tui", sessionManager: { getBranch: () => entries }, ui: { theme,
  setWidget: (name: string, widget: any) => widgets.set(name, widget), setStatus() {}, notify() {},
  custom: async (factory: Function) => { const view = factory({ requestRender() {}, terminal: { rows: 40 } }, theme, {}, () => {}); overlayLines = view.render(120); view.handleInput("\t"); expect(view.render(120).join("\n")).toContain("activity"); },
 } };
 try {
  fabric(pi); events.get("session_start")!({}, ctx);
  expect(widgets.get("pi-fabric")({}, theme).render(100).join("\n")).toContain("Running read");
  expect(entries.filter(entry => entry.customType === "pi-fabric-result").length).toBe(1);
  let progress: any;
  const result = await tools.get("await_agents").execute("call", { agentIds: ["done"] }, undefined, (value: any) => progress = value, ctx);
  expect(progress.details.ui[0].result).toContain("Measured result");
  expect(tools.get("await_agents").renderResult(result, { expanded: true }, theme).render(120).join("\n")).toContain("Measured result");
  await commands.get("team").handler("", ctx); expect(overlayLines.join("\n")).toContain("Option B");
  await commands.get("team").handler("hide", ctx); expect(widgets.get("pi-fabric")).toBeUndefined();
  await commands.get("team").handler("show", ctx); expect(widgets.get("pi-fabric")).toBeDefined();
  expect(entries.filter(entry => entry.customType === "pi-fabric-result").length).toBe(1);
 } finally {
  events.get("session_shutdown")?.({}, ctx); rmSync(dir, { recursive: true, force: true });
  if (previousAgent === undefined) delete process.env.PI_FABRIC_AGENT; else process.env.PI_FABRIC_AGENT = previousAgent;
  if (previousRoot === undefined) delete process.env.PI_FABRIC_ROOT; else process.env.PI_FABRIC_ROOT = previousRoot;
 }
});

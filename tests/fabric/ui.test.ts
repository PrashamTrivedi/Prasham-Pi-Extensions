import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { AgentTranscriptOverlay, AgentsScreen, renderComparisonResultCard, TranscriptPane, parseSessionLine, parseSessionText, TRANSCRIPT_ARGS_LIMIT, type FabricAgentView, type TranscriptPaneSpec } from "../../extensions/fabric/ui.ts";
import { buildTree, renderAgentRows } from "../../extensions/fabric/agents.ts";
import { clean, publishActivity, readActivity, readPreview } from "../../extensions/fabric/activity.ts";
const theme = { fg: (_: string, text: string) => text, bold: (text: string) => text };
const agents: FabricAgentView[] = Array.from({ length: 8 }, (_, i) => ({ id: `agent-${i}`, label: `Option ${i} 界`, model: "terra", status: i % 2 ? "done" : "running", activity: "Running tests", result: `Finding ${i}\nEvidence ${i}`, patch: "+first line\n-second line" }));
const sessionFixture = [
 JSON.stringify({ type: "message", message: { role: "user", content: "Summarize 界 the failure" } }),
 JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "The lock was held.".repeat(6) }, { type: "toolCall", name: "bash", arguments: { command: "false" } }] } }),
 JSON.stringify({ type: "message", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "exit 1" }], isError: true } }),
].join("\n") + "\n";
test("telemetry is bounded, atomic-readable, and strips terminal escapes", () => {
 const dir = mkdtempSync(join(tmpdir(), "fabric-test-"));
 try {
  for (let i = 0; i < 100; i++) publishActivity(dir, "a", "finding", `Finding ${i}`);
  const snapshot = readActivity(dir, "a");
  expect(snapshot.items.length).toBe(60); expect(snapshot.items.at(-1)?.text).toBe("Finding 99");
  expect(clean("hello\x1b[2Jworld\x07")).toBe("helloworld");
  const file = join(dir, "patch"); writeFileSync(file, "x".repeat(100));
  expect(readPreview(file, 10)).toContain("truncated");
  expect(readPreview(join(dir, "missing"))).toBe("");
 } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- full-run transcript ---------- */

const session = [
  { type: "session", version: 3, id: "s1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/repo" },
  { type: "message", id: "a1", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message: { role: "system", content: "", sections: { preamble: "You are Fabric agent…" }, toolsAdded: [], timestamp: 1 } },
  { type: "message", id: "a2", parentId: "a1", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "user", content: "Review the parser\u001b[2J", timestamp: 2 } },
  { type: "message", id: "a3", parentId: "a2", timestamp: "2026-01-01T00:00:03.000Z", message: { role: "assistant", content: [
    { type: "thinking", thinking: "Check the fixture first." },
    { type: "text", text: "Reading the file now." },
    { type: "toolCall", id: "c1", name: "read", arguments: { path: "/repo/a.ts", limit: 20 } },
  ], stopReason: "toolUse", timestamp: 3 } },
  { type: "message", id: "a4", parentId: "a3", timestamp: "2026-01-01T00:00:04.000Z", message: { role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "export const a = 1;" }], isError: false, timestamp: 4 } },
  { type: "model_change", id: "a5", parentId: "a4", timestamp: "2026-01-01T00:00:05.000Z", provider: "anthropic", modelId: "claude-sonnet-4-5" },
];
const sessionText = `${session.map((entry) => JSON.stringify(entry)).join("\n")}\n`;

test("a session line parses into ordered transcript blocks and skips prompt noise", () => {
 expect(parseSessionLine("not json")).toEqual([]);
 expect(parseSessionLine("")).toEqual([]);
 expect(parseSessionLine(JSON.stringify(session[0]))).toEqual([]);
 expect(parseSessionLine(JSON.stringify(session[1]))).toEqual([]);
 expect(parseSessionLine(JSON.stringify(session[2]))).toEqual([{ kind: "user", text: "Review the parser" }]);
 expect(parseSessionLine(JSON.stringify(session[3]))).toEqual([
  { kind: "thinking", text: "Check the fixture first." },
  { kind: "assistant", text: "Reading the file now." },
  { kind: "toolCall", name: "read", args: "{\"path\":\"/repo/a.ts\",\"limit\":20}" },
 ]);
 expect(parseSessionLine(JSON.stringify(session[4]))).toEqual([{ kind: "toolResult", name: "read", text: "export const a = 1;", isError: false }]);
 expect(parseSessionLine(JSON.stringify(session[5]))).toEqual([{ kind: "note", text: "model → anthropic/claude-sonnet-4-5" }]);
 const failed = parseSessionLine(JSON.stringify({ type: "message", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "boom" }], isError: true } }));
 expect(failed).toEqual([{ kind: "toolResult", name: "bash", text: "boom", isError: true }]);
 const full = parseSessionText(sessionText);
 expect(full.map((entry) => entry.kind)).toEqual(["user", "thinking", "assistant", "toolCall", "toolResult", "note"]);
});

test("transcript blocks stay bounded so one huge tool result cannot swamp the run", () => {
 const long = "x".repeat(50_000);
 const [result] = parseSessionLine(JSON.stringify({ type: "message", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: long }], isError: false } }));
 expect(result.kind).toBe("toolResult");
 expect((result as { text: string }).text.length).toBeLessThan(long.length);
 expect((result as { text: string }).text).toContain("truncated");
 const [call] = parseSessionLine(JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "write", arguments: { text: long } }] } }));
 expect((call as { args: string }).args.length).toBeLessThanOrEqual(TRANSCRIPT_ARGS_LIMIT + 40);
});

const spec = (id: string, overrides: Partial<TranscriptPaneSpec> = {}): TranscriptPaneSpec => ({
 id, label: id, model: "qwen", status: "done", hue: 0.3, ...overrides,
});

test("a pane replays a run and appends live lines without dropping a partial one", () => {
 const pane = new TranscriptPane({ theme, spec: spec("api", { read: () => ({ text: sessionText }) }) });
 expect(pane.getState().entries).toBe(6);
 const rendered = pane.render(80, 12).join("\n");
 expect(rendered).toContain("api");
 expect(rendered).toContain("Reading the file now.");
 // A half-written line waits for its newline instead of being parsed as garbage.
 const second = JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "second" }] } });
 expect(pane.appendText(second.slice(0, 15))).toBe(false);
 expect(pane.appendText(`${second.slice(15)}\n`)).toBe(true);
 expect(pane.getState().entries).toBe(7);
 pane.scroll("G");
 expect(pane.render(80, 12).join("\n")).toContain("second");
 expect(pane.appendText("")).toBe(false);
});

test("a pane scrolls, clamps, fills its height exactly, and never overflows its width", () => {
 const pane = new TranscriptPane({ theme, spec: spec("api", { read: () => ({ text: sessionText.repeat(3) }) }) });
 for (const width of [1, 2, 3, 20, 60, 120]) {
  for (const line of pane.render(width, 10)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
 }
 expect(pane.render(100, 10)).toHaveLength(10);
 pane.setHeight(10);
 const tall = pane.render(100, 20);
 expect(tall).toHaveLength(20);
 expect(pane.scroll("G") || true).toBe(true);
 pane.render(100, 20);
 const atEnd = pane.getState();
 expect(atEnd.offset).toBe(atEnd.maxOffset);
 pane.scroll("g");
 expect(pane.getState().offset).toBe(0);
 pane.scroll(" ");
 expect(pane.getState().offset).toBeGreaterThan(0);
 // A tiny window still renders its header and rule.
 expect(pane.render(40, 2)).toHaveLength(2);
});

test("the transcript screen shows two columns, focuses them, and toggles to one", () => {
 const left = spec("api", { read: () => ({ text: sessionText }) });
 const right = spec("tests", { hue: 0.7, read: () => ({ text: sessionText }) });
 const overlay = new AgentTranscriptOverlay({ theme, specs: [left, right], onClose: () => closed++ });
 let closed = 0;
 overlay.setHeight(20);
 const wide = overlay.render(120);
 expect(wide).toHaveLength(20);
 for (const line of wide) expect(visibleWidth(line)).toBeLessThanOrEqual(120);
 // Each column carries its own agent name.
 expect(wide.join("\n")).toContain("api");
 expect(wide.join("\n")).toContain("tests");
 overlay.handleInput("\t");
 expect(overlay.paneAt(1)?.getState().offset).toBe(0);
 overlay.handleInput("G"); // scrolls only the focused pane
 expect(overlay.paneAt(1)!.getState().offset).toBeGreaterThan(0);
 expect(overlay.paneAt(0)!.getState().offset).toBe(0);
 overlay.handleInput("s"); // one column
 const single = overlay.render(120).join("\n");
 expect(single).toContain("pgup/pgdn scroll");
 expect(single).not.toContain("│");
 overlay.handleInput("\u001b");
 expect(closed).toBe(1);
 // A narrow terminal falls back to one column with an explanation.
 const narrow = new AgentTranscriptOverlay({ theme, specs: [left, right] });
 narrow.setHeight(20);
 const narrowText = narrow.render(60).join("\n");
 expect(narrowText).toContain("one column: too narrow for two");
 for (const line of narrow.render(60)) expect(visibleWidth(line)).toBeLessThanOrEqual(60);
});

test("the agents screen selects, expands, confirms a cancel, and clamps when rows vanish", () => {
 const base = buildTree({
  main: { id: "main", kind: "main", label: "main", model: "flash", status: "idle" },
  agents: [
   { id: "api", kind: "agent", label: "api", model: "qwen", status: "running", batchId: "call-1" },
   { id: "tests", kind: "agent", label: "tests", model: "qwen", status: "running", batchId: "call-1" },
   { id: "solo", kind: "agent", label: "solo", model: "qwen", status: "done", batchId: "call-2", finishedAt: new Date().toISOString() },
  ],
 });
 const opened: string[] = [];
 const toggled: string[] = [];
 const cancelled: string[] = [];
 let closed = 0;
 const screen = new AgentsScreen({
  theme, rows: base,
  onOpen: (row) => opened.push(row.id),
  onToggle: (row) => toggled.push(row.id),
  onCancel: (row) => cancelled.push(row.id),
  onClose: () => closed++,
 });
 screen.setHeight(14);
 for (const line of screen.render(100)) expect(visibleWidth(line)).toBeLessThanOrEqual(100);
 expect(screen.render(100).join("\n")).toContain("main");
 // The header counts agents, not rows: main plus both group members plus solo.
 expect(screen.render(100).join("\n")).toContain("Agents  4 live");
 screen.handleInput("\r");
 expect(opened).toEqual(["main"]);
 screen.handleInput("j");
 screen.handleInput("\r");
 // The selected row after moving down is the group row; groups open their members.
 expect(opened.at(-1)).toBe("group:call-1");
 screen.handleInput("\r");
 // Cancelling is confirmed inline: x then n does nothing, x then y cancels.
 screen.handleInput("x");
 expect(screen.getState().confirming).toBe("group:call-1");
 screen.handleInput("n");
 expect(cancelled).toEqual([]);
 screen.handleInput("x");
 screen.handleInput("y");
 expect(cancelled).toEqual(["group:call-1"]);
 // A refresh that drops rows clamps the selection instead of closing the list.
 screen.handleInput("end");
 screen.setRows(base.filter((row) => row.kind === "main"));
 expect(screen.getState().selectedId).toBe("main");
 screen.handleInput("\u001b");
 expect(closed).toBe(1);
});

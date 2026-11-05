import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { AgentTranscriptOverlay, AgentsScreen, renderComparisonResultCard, TranscriptPane, parseSessionLine, parseSessionText, TRANSCRIPT_ARGS_LIMIT, type FabricAgentView, type TranscriptPaneSpec } from "../../extensions/fabric/ui.ts";
import { buildTree, renderAgentRows } from "../../extensions/fabric/agents.ts";
import { clean, publishActivity, readActivity, readPreview } from "../../extensions/fabric/activity.ts";
const theme = { fg: (_: string, text: string) => text, bold: (text: string) => text };
// Pi's own components read the global theme; initialize it once for the whole file.
initTheme("dark", false);
/** A TUI stand-in: tool components only use it to request a repaint. */
const ui = { requestRender: () => {}, terminal: { rows: 40 } } as unknown as TUI;
/** Rendered lines without ANSI, so assertions read the text a human sees. */
const plain = (lines: readonly string[]): string => lines
 .join("\n")
 .replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "")
 .replace(/\x1b\]133;[ABC]\x07/g, "")
 .replace(/\x1b\[[0-9;]*m/g, "");
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

test("a single result is one full-width card, never an Evidence placeholder", () => {
 const single = renderComparisonResultCard({ title: "Result", left: { label: "api", status: "success", summary: "Done." } }, theme, 60);
 expect(single.join("\n")).toContain("api");
 expect(single.join("\n")).not.toContain("Evidence");
 // The card spans the whole width instead of half of it.
 expect(visibleWidth(single[1]!)).toBe(60);
 const pair = renderComparisonResultCard({ left: { label: "a", summary: "one" }, right: { label: "b", summary: "two" } }, theme, 60);
 expect(pair.join("\n")).toContain("b");
});

test("a pane opens at the end, follows live lines, and pauses with a +N new tag", () => {
 const pane = new TranscriptPane({ theme, ui, outputPad: 1, spec: spec("api", { read: () => ({ text: sessionText }) }) });
 const first = plain(pane.render(80, 12));
 // Opening at the end means the newest blocks are on screen without scrolling.
 expect(pane.getState().following).toBe(true);
 expect(pane.getState().offset).toBe(pane.getState().maxOffset);
 expect(first).toContain("/repo/a.ts");
 const second = JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "second **answer**" }] } });
 expect(pane.appendText(`${second}\n`)).toBe(true);
 pane.render(80, 12);
 expect(pane.getState().following).toBe(true);
 expect(pane.getState().offset).toBe(pane.getState().maxOffset);
 // Scrolling up pauses following and counts entries that arrive meanwhile.
 pane.scroll("k");
 expect(pane.getState().following).toBe(false);
 const third = JSON.stringify({ type: "message", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "third" }] } });
 pane.appendText(`${third}\n`);
 const paused = plain(pane.render(80, 12));
 expect(paused).toContain("+1 new");
 expect(pane.getState().pending).toBe(1);
 // `f` resumes at the end and clears the tag.
 pane.scroll("f");
 expect(pane.getState().following).toBe(true);
 expect(pane.getState().pending).toBe(0);
 const resumed = plain(pane.render(80, 12));
 expect(resumed).toContain("second");
 expect(resumed).toContain("answer");
 expect(resumed).not.toContain("**");
 expect(resumed).not.toContain("+1 new");
 // A replay error is explained on the header and never tails.
 const failed = new TranscriptPane({ theme, ui, outputPad: 1, spec: spec("broken", { read: () => ({ text: "", notice: "Unable to read /tmp/x", live: false }) }) });
 expect(plain(failed.render(80, 12))).toContain("Unable to read");
});

test("appending adds components instead of rebuilding the transcript", () => {
 const pane = new TranscriptPane({ theme, ui, outputPad: 1, spec: spec("api", { read: () => ({ text: sessionText.repeat(2) }) }) });
 pane.render(80, 12);
 const before = pane.getState().blocks;
 expect(before).toBeGreaterThan(0);
 for (let index = 0; index < 3; index++) {
  const line = JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: `chunk ${index} `.repeat(20) }] } });
  pane.appendText(`${line}\n`);
  pane.render(80, 12);
 }
 // One assistant message is one component: the three appends added three, and the
 // earlier blocks were never rebuilt (the renderer is incremental by construction).
 expect(pane.getState().blocks).toBe(before + 3);
});

test("a transcript header names the run's model, status and usage", () => {
 const pane = new TranscriptPane({ theme, ui, outputPad: 1, spec: spec("api", { usage: "$0.04 · 12k · read", read: () => ({ text: sessionText }) }) });
 const header = plain([pane.render(100, 12)[0]!]);
 expect(header).toContain("◆ api");
 expect(header).toContain("qwen · done · $0.04 · 12k · read");
});

test("a pane replays a run with Pi's own components and appends live lines", () => {
 const pane = new TranscriptPane({ theme, ui, outputPad: 1, spec: spec("api", { read: () => ({ text: sessionText }) }) });
 expect(pane.getState().entries).toBe(6);
 pane.setHeight(40);
 pane.scroll("g");
 const rendered = plain(pane.render(80, 40));
 // Markdown is rendered (not literal), the read call shows its path, not raw JSON.
 expect(rendered).toContain("Reading the file now.");
 expect(rendered).toContain("/repo/a.ts");
 expect(rendered).not.toContain('{"path"');
 // Pi collapses a read result until expanded; `r` is the same ctrl+o.
 expect(rendered).not.toContain("export const a = 1;");
 pane.toggleResults();
 expect(plain(pane.render(80, 40))).toContain("export const a = 1;");
 pane.toggleResults();
 // A half-written line waits for its newline instead of being parsed as garbage.
 const second = JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "second" }] } });
 expect(pane.appendText(second.slice(0, 15))).toBe(false);
 expect(pane.appendText(`${second.slice(15)}\n`)).toBe(true);
 expect(pane.getState().entries).toBe(7);
 pane.scroll("G");
 expect(plain(pane.render(80, 40))).toContain("second");
 expect(pane.appendText("")).toBe(false);
});

test("a pane scrolls, clamps, fills its height exactly, and never overflows its width", () => {
 const pane = new TranscriptPane({ theme, ui, outputPad: 1, spec: spec("api", { read: () => ({ text: sessionText.repeat(3) }) }) });
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
 // Half-page keys now that the screen owns the viewport: ctrl+d down, ctrl+u back.
 const halfway = pane.getState().offset;
 pane.scroll("\u0004");
 expect(pane.getState().offset).toBeGreaterThan(halfway);
 pane.render(100, 20);
 const further = pane.getState().offset;
 pane.scroll("\u0015");
 expect(pane.getState().offset).toBeLessThan(further);
 // A tiny window still renders its header and one body row.
 expect(pane.render(40, 2)).toHaveLength(2);
});

test("the transcript screen shows one agent at a time and tab switches the batch", () => {
 const left = spec("api", { read: () => ({ text: sessionText }) });
 const right = spec("tests", { hue: 0.7, read: () => ({ text: sessionText }) });
 let closed = 0;
 const overlay = new AgentTranscriptOverlay({ theme, ui, specs: [left, right], onClose: () => closed++ });
 overlay.setHeight(20);
 const wide = overlay.render(120);
 expect(wide).toHaveLength(20);
 for (const line of wide) expect(visibleWidth(line)).toBeLessThanOrEqual(120);
 // One full-width column: only the focused agent is on screen.
 const first = plain(wide);
 expect(first).toContain("◆ api");
 expect(first).not.toContain("◆ tests");
 expect(first).toContain("1/2");
 expect(first).toContain("tab next");
 expect(first).not.toContain("│");
 overlay.handleInput("\t");
 const second = plain(overlay.render(120));
 expect(second).toContain("◆ tests");
 expect(second).not.toContain("◆ api");
 // `s` no longer exists: the transcript is always one column.
 overlay.handleInput("s");
 expect(plain(overlay.render(120))).toContain("◆ tests");
 overlay.handleInput("\u001b");
 expect(closed).toBe(1);
});

test("the wheel scrolls the transcript and is consumed before the chat behind it", () => {
 const wheel = (delta: number) => ({ type: "wheel" as const, button: "none" as const, x: 10, y: 5, screenX: 10, screenY: 5, width: 80, height: 40, shift: false, alt: false, ctrl: false, wheelDelta: delta });
 const left = spec("api", { read: () => ({ text: sessionText }) });
 const overlay = new AgentTranscriptOverlay({ theme, ui, specs: [left] });
 // Short enough that the run overflows, so there is somewhere to scroll.
 overlay.setHeight(8);
 overlay.render(80);
 expect(overlay.paneAt(0)!.getState().maxOffset).toBeGreaterThan(0);
 expect(overlay.paneAt(0)!.getState().following).toBe(true);
 // A tick up pauses following and moves the view; the event never reaches the chat.
 expect(overlay.handleMouse(wheel(-5))).toEqual({ handled: true });
 expect(overlay.paneAt(0)!.getState().following).toBe(false);
 // A tick down back to the end resumes following, so live lines keep arriving.
 expect(overlay.handleMouse(wheel(5))).toEqual({ handled: true });
 expect(overlay.paneAt(0)!.getState().following).toBe(true);
 // Presses belong to the screen too, so clicks cannot reach the chat under it.
 expect(overlay.handleMouse({ ...wheel(0), type: "press", button: "left" })).toEqual({ handled: true });
 expect(overlay.handleMouse({ ...wheel(0), type: "move" })).toBeUndefined();
});

test("the agents list wheel moves the selection instead of scrolling the chat", () => {
 const row = (id: string) => ({ id, kind: "agent" as const, label: id, model: "qwen", hue: 0.3, status: "done" as const, depth: 1, members: [] });
 const screen = new AgentsScreen({ theme, rows: [row("a"), row("b"), row("c")], onOpen: () => {}, onToggle: () => {}, onCancel: () => {}, onClose: () => {} });
 screen.setHeight(10);
 const wheel = (delta: number) => ({ type: "wheel" as const, button: "none" as const, x: 0, y: 0, screenX: 0, screenY: 0, width: 80, height: 10, shift: false, alt: false, ctrl: false, wheelDelta: delta });
 expect(screen.handleMouse(wheel(3))).toEqual({ handled: true });
 expect(screen.getState().selectedId).toBe("b");
 expect(screen.handleMouse(wheel(-3))).toEqual({ handled: true });
 expect(screen.getState().selectedId).toBe("a");
 // The top of the list is a hard stop, not a chat scroll.
 screen.handleMouse(wheel(-3));
 expect(screen.getState().selectedId).toBe("a");
});

test("a run exports as Markdown and o/y hand the focused pane to the caller", () => {
 const left = spec("api", { hue: 0.3, read: () => ({ text: sessionText }) });
 const right = spec("tests", { hue: 0.7, read: () => ({ text: sessionText }) });
 const opened: string[] = [];
 const copied: string[] = [];
 const second = new AgentTranscriptOverlay({
  theme, ui, specs: [left, right],
  onOpen: (pane) => opened.push(pane.id),
  onCopy: (pane) => copied.push(pane.id),
 });
 second.setHeight(20);
 // `o` exports the run the pane is showing, not whatever is on screen.
 const markdown = second.paneAt(0)!.markdown();
 expect(markdown).toContain("# api");
 expect(markdown).toContain("_qwen · done_");
 expect(markdown).toContain("## Assistant");
 expect(markdown).toContain("Reading the file now.");
 expect(markdown).toContain('    {"path":"/repo/a.ts","limit":20}');
 expect(markdown).not.toContain("\u001b");
 expect(markdown.endsWith("\n")).toBe(true);
 // The second column is the one with focus after tab.
 second.handleInput("\t");
 second.handleInput("o");
 second.handleInput("y");
 expect(opened).toEqual(["tests"]);
 expect(copied).toEqual(["tests"]);
 expect(second.paneAt(1)!.path).toBeUndefined();
 expect(plain([second.render(120).at(-1)!])).toContain("o open · y path");
});

test("reading keys hide thinking, expand tool output, find matches and jump to failures", () => {
 const lines: string[] = [];
 for (let index = 0; index < 30; index++) {
  lines.push(JSON.stringify({ type: "message", message: { role: "assistant", content: [
   ...(index === 4 ? [{ type: "thinking", thinking: "hidden thought" }] : []),
   { type: "text", text: `answer ${index} needle` },
  ] } }));
 }
 lines.push(JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "unknown_tool", arguments: { q: "x" } }] } }));
 lines.push(JSON.stringify({ type: "message", message: { role: "toolResult", toolCallId: "t1", toolName: "unknown_tool", isError: true, content: [{ type: "text", text: ["FAILED here", "line two", ...Array.from({ length: 12 }, (_, index) => `tail ${index}`)].join("\n") }] } }));
 const longSession = `${lines.join("\n")}\n`;
 const pane = new TranscriptPane({ theme, ui, outputPad: 1, spec: spec("api", { read: () => ({ text: longSession }) }) });
 pane.setHeight(40);
 pane.scroll("g");
 pane.render(80, 40);
 // Search is case-insensitive and ignores an empty query.
 expect(pane.findMatches("needle")).toHaveLength(30);
 expect(pane.findMatches("NEEDLE")).toHaveLength(30);
 expect(pane.findMatches("")).toEqual([]);
 expect(pane.findMatches("zzz")).toEqual([]);
 // `e` has exactly the failed result to jump to.
 expect(pane.errorLines()).toHaveLength(1);
 pane.jumpToLine(pane.findMatches("needle")[10]!);
 pane.render(80, 40);
 expect(pane.getState().following).toBe(false);
 pane.scroll("g");
 // `t` hides thinking through Pi's own switch, without losing it from the export.
 expect(plain(pane.render(80, 40))).toContain("hidden thought");
 pane.toggleThinking();
 expect(plain(pane.render(80, 40))).not.toContain("hidden thought");
 expect(pane.markdown()).toContain("hidden thought");
 pane.toggleThinking();
 expect(plain(pane.render(80, 40))).toContain("hidden thought");
 // `r` is Pi's ctrl+o expansion; the read result in the replay test pins the visual effect.
 expect(pane.toggleResults()).toBe(true);
 expect(pane.filterState.collapseResults).toBe(true);
 expect(pane.toggleResults()).toBe(false);
});

test("the transcript screen searches incrementally and offers the reading keys", () => {
 const lines = Array.from({ length: 40 }, (_, index) => JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: `answer ${index} needle` }] } }));
 const text = `${lines.join("\n")}\n`;
 let closed = 0;
 const overlay = new AgentTranscriptOverlay({ theme, ui, specs: [spec("api", { read: () => ({ text }) })], onClose: () => closed++ });
 overlay.setHeight(20);
 const footer = () => plain([overlay.render(100).at(-1)!]);
 expect(footer()).toContain("/ search");
 // `/` starts an incremental search; every keystroke jumps to the first match.
 overlay.handleInput("/");
 overlay.handleInput("n");
 overlay.handleInput("e");
 expect(footer()).toContain("/ne");
 expect(footer()).toContain("40 matches");
 expect(overlay.paneAt(0)!.getState().following).toBe(false);
 // Enter keeps the query so n/N can walk the matches.
 overlay.handleInput("\r");
 expect(footer()).toContain("n/N next");
 const afterFirst = overlay.paneAt(0)!.getState().offset;
 overlay.handleInput("n");
 expect(overlay.paneAt(0)!.getState().offset).toBeGreaterThan(afterFirst);
 overlay.handleInput("N");
 expect(overlay.paneAt(0)!.getState().offset).toBeLessThanOrEqual(afterFirst);
 // Esc clears the search first, and only then closes the screen.
 overlay.handleInput("\u001b");
 expect(closed).toBe(0);
 expect(footer()).toContain("/ search");
 overlay.handleInput("t");
 expect(footer()).toContain("thinking hidden");
 overlay.handleInput("r");
 expect(footer()).toContain("output expanded");
 overlay.handleInput("\u001b");
 expect(closed).toBe(1);
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

import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderComparisonResultCard, LiveTeamInspectorOverlay, TranscriptPickerOverlay, TranscriptViewerOverlay, parseSessionLine, parseSessionText, relativeAge, TRANSCRIPT_ARGS_LIMIT, type FabricAgentView } from "../../extensions/fabric/ui.ts";
import { clean, publishActivity, readActivity, readPreview } from "../../extensions/fabric/activity.ts";
const theme = { fg: (_: string, text: string) => text, bold: (text: string) => text };
const agents: FabricAgentView[] = Array.from({ length: 8 }, (_, i) => ({ id: `agent-${i}`, label: `Option ${i} 界`, model: "terra", status: i % 2 ? "done" : "running", activity: "Running tests", result: `Finding ${i}\nEvidence ${i}`, patch: "+first line\n-second line" }));
const sessionFixture = [
 JSON.stringify({ type: "message", message: { role: "user", content: "Summarize 界 the failure" } }),
 JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "The lock was held.".repeat(6) }, { type: "toolCall", name: "bash", arguments: { command: "false" } }] } }),
 JSON.stringify({ type: "message", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "exit 1" }], isError: true } }),
].join("\n") + "\n";
test("every surface respects terminal width, including tiny terminals", () => {
 for (const width of [1, 2, 3, 20, 75, 76, 100, 160]) {
  const inspector = new LiveTeamInspectorOverlay({ theme, data: { agents } });
  const viewer = new TranscriptViewerOverlay({ theme, title: "run", read: () => ({ text: sessionFixture }), maxRows: 5 });
  const surfaces = [renderComparisonResultCard({ left: { label: "Left", summary: "abc ".repeat(100) }, right: { label: "Right", summary: "界".repeat(100) } }, theme, width), inspector.render(width), viewer.render(width)];
  for (const lines of surfaces) for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
 }
});
test("inspector pins preserve selection and compare actual agents", () => {
 const inspector = new LiveTeamInspectorOverlay({ theme, data: { agents } });
 inspector.handleInput("p"); inspector.handleInput("j"); inspector.handleInput("p");
 expect(inspector.getState().selectedId).toBe("agent-1");
 for (let i = 0; i < 5; i++) inspector.handleInput("\t");
 expect(inspector.getState().tab).toBe("compare");
 const text = inspector.render(120).join("\n");
 expect(text).toContain("Finding 0"); expect(text).toContain("Finding 1");
 inspector.setData({ agents: [...agents] });
 expect(inspector.getState().selectedId).toBe("agent-1");
});
test("patch view preserves line breaks", () => {
 const inspector = new LiveTeamInspectorOverlay({ theme, data: { agents } });
 for (let i = 0; i < 4; i++) inspector.handleInput("\t");
 const lines = inspector.render(100);
 expect(lines).toContain("+first line"); expect(lines).toContain("-second line");
});
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

test("the transcript viewer replays a run, scrolls within bounds, and respects width", () => {
 let closed = 0;
 const tall = new TranscriptViewerOverlay({ theme, title: "Option A · agent-0", read: () => ({ text: sessionText }), maxRows: 40, onClose: () => closed++ });
 const page = tall.render(100).join("\n");
 expect(page).toContain("Review the parser");
 expect(page).toContain("Reading the file now.");
 expect(page).toContain("export const a = 1;");
 expect(page).toContain("read");
 expect(page).not.toContain("You are Fabric agent");
 expect(tall.getState().entries).toBe(6);

 const short = new TranscriptViewerOverlay({ theme, title: "Option A · agent-0", read: () => ({ text: sessionText }), maxRows: 4 });
 for (const width of [1, 2, 3, 20, 60, 120]) {
  for (const viewer of [tall, short]) for (const line of viewer.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
 }
 short.render(100);
 short.handleInput("G");
 expect(short.getState().offset).toBe(short.getState().maxOffset);
 expect(short.render(100).join("\n")).toContain("model → anthropic/claude-sonnet-4-5");
 short.handleInput("g");
 expect(short.getState().offset).toBe(0);
 short.handleInput("\u001b[6~"); // page down
 expect(short.getState().offset).toBeGreaterThan(0);
 expect(short.getState().offset).toBeLessThanOrEqual(short.getState().maxOffset);
 tall.handleInput("\u001b");
 expect(closed).toBe(1);
});

test("the viewer reports an empty or unreadable run instead of rendering nothing", () => {
 const blank = new TranscriptViewerOverlay({ theme, title: "Queued run", read: () => ({ text: "" }) });
 expect(blank.render(80).join("\n")).toContain("No transcript entries saved yet.");
 expect(blank.render(80).join("\n")).toContain("has not written any messages yet");
 const broken = new TranscriptViewerOverlay({ theme, title: "Broken", read: () => ({ text: "", notice: "Unable to read /tmp/x.jsonl" }) });
 expect(broken.render(80).join("\n")).toContain("Unable to read");
});

test("a live transcript refreshes only when the saved session changes and follows the tail", () => {
 let text = sessionText;
 const viewer = new TranscriptViewerOverlay({ theme, title: "Running", read: () => ({ text }), maxRows: 4 });
 viewer.render(90);
 expect(viewer.refresh()).toBe(false);
 viewer.handleInput("G");
 const before = viewer.getState();
 text = `${sessionText}${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Finished: all checks pass." }] } })}\n`;
 expect(viewer.refresh()).toBe(true);
 const after = viewer.render(90);
 expect(after.join("\n")).toContain("Finished: all checks pass.");
 expect(viewer.getState().entries).toBe(before.entries + 1);
 expect(viewer.getState().offset).toBeGreaterThanOrEqual(before.offset);
});

test("the inspector opens the transcript on enter and toggles the filter on a", () => {
 let opened: string | undefined;
 let toggles = 0;
 const inspector = new LiveTeamInspectorOverlay({ theme, data: { agents }, onOpen: (agent) => opened = agent.id, onToggleFilter: () => toggles++ });
 inspector.handleInput("\u001b[13u"); // kitty enter
 if (opened === undefined) inspector.handleInput("\r");
 expect(opened).toBe("agent-0");
 inspector.handleInput("a");
 expect(toggles).toBe(1);
 expect(inspector.render(100).join("\n")).toContain("enter transcript");
});

/* ---------- run picker ---------- */

test("relative age is short, monotonic, and tolerant of a missing timestamp", () => {
 const now = Date.parse("2026-01-02T12:00:00.000Z");
 const at = (msAgo: number) => new Date(now - msAgo).toISOString();
 expect(relativeAge(at(5_000), now)).toBe("just now");
 expect(relativeAge(at(4 * 60_000), now)).toBe("4m ago");
 expect(relativeAge(at(3 * 60 * 60_000), now)).toBe("3h ago");
 expect(relativeAge(at(2 * 24 * 60 * 60_000), now)).toBe("2d ago");
 expect(relativeAge(undefined, now)).toBe("");
 expect(relativeAge("not a date", now)).toBe("");
});

test("the picker lists runs, moves, clamps, and keeps its selection across refreshes", () => {
 const runs = [
  { id: "b", label: "Newest", model: "terra", status: "running" as const, sessionPath: "/tmp/b.jsonl", startedAt: new Date().toISOString() },
  { id: "a", label: "Older", model: "terra", status: "done" as const, finishedAt: new Date(Date.now() - 90 * 60_000).toISOString() },
 ];
 let opened: string | undefined;
 let closed = 0;
 const picker = new TranscriptPickerOverlay({ theme, runs, onOpen: (run) => opened = run.id, onClose: () => closed++ });
 for (const width of [1, 2, 3, 40, 120]) for (const line of picker.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
 const text = picker.render(100).join("\n");
 expect(text).toContain("Run transcripts  2 runs");
 expect(text).toContain("Newest");
 expect(text).toContain("no transcript yet"); // only the run without a saved session
 picker.handleInput("\r");
 expect(opened).toBe("b");
 picker.handleInput("j");
 picker.handleInput("j"); // clamped at the end
 picker.handleInput("\r");
 expect(opened).toBe("a");
 // A refresh (a run finishing) keeps "a" selected rather than jumping to the newest.
 picker.setRuns([...runs, { id: "c", label: "Fresh", model: "terra", status: "done" as const, finishedAt: new Date().toISOString() }]);
 picker.handleInput("\r");
 expect(opened).toBe("a");
 picker.handleInput("\u001b");
 expect(closed).toBe(1);
});

test("the picker explains an empty run list instead of rendering a blank frame", () => {
 const picker = new TranscriptPickerOverlay({ theme, runs: [], onOpen: () => {}, onClose: () => {} });
 const text = picker.render(80).join("\n");
 expect(text).toContain("Run transcripts  0 runs");
 expect(text).toContain("No Fabric runs in this session yet");
 picker.handleInput("\r"); // no selection, no crash, no open
});

test("appending a live transcript parses only new lines and never drops a partial one", () => {
 const viewer = new TranscriptViewerOverlay({ theme, title: "live", maxRows: 8 });
 const line = (text: string) => `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text }] } })}\n`;
 viewer.setSource({ text: line("first") });
 expect(viewer.getState().entries).toBe(1);
 // A half-written line waits for its newline instead of being parsed as garbage.
 const second = JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "second" }] } });
 expect(viewer.appendText(second.slice(0, 15))).toBe(false);
 expect(viewer.getState().entries).toBe(1);
 expect(viewer.appendText(`${second.slice(15)}\n`)).toBe(true);
 expect(viewer.getState().entries).toBe(2);
 expect(viewer.render(80).join("\n")).toContain("second");
 // Appending costs only the new line: earlier entries are kept, not re-parsed.
 viewer.appendText(line("third"));
 expect(viewer.getState().entries).toBe(3);
 expect(viewer.render(80).join("\n")).toContain("first");
 expect(viewer.appendText("")).toBe(false);
});

test("the viewer resizes its body to a new window height", () => {
 const viewer = new TranscriptViewerOverlay({ theme, title: "resize", read: () => ({ text: sessionText }), maxRows: 5 });
 viewer.setHeight(24);
 expect(viewer.getState().rows).toBe(19); // 24 - chrome (title, count, two rules, hint)
 expect(viewer.render(100).length).toBeLessThanOrEqual(24);
 viewer.setHeight(12);
 expect(viewer.getState().rows).toBe(7);
 expect(viewer.render(100).length).toBeLessThanOrEqual(12);
 // Too small a window still leaves a usable body.
 viewer.setHeight(1);
 expect(viewer.getState().rows).toBe(3);
 // A notice is part of the chrome, so it cannot push the scroll hint off-screen.
 const noticed = new TranscriptViewerOverlay({ theme, title: "notice", read: () => ({ text: sessionText, notice: "truncated" }) });
 noticed.setHeight(14);
 expect(noticed.getState().rows).toBe(8);
 expect(noticed.render(100).length).toBeLessThanOrEqual(14);
 // Long content fills the window exactly, which is what the TUI wrapper relies on.
 const long = new TranscriptViewerOverlay({ theme, title: "long", read: () => ({ text: sessionText.repeat(4) }), maxRows: 5 });
 long.setHeight(24);
 expect(long.render(100)).toHaveLength(24);
});

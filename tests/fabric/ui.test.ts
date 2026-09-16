import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderCompactFabricWidget, renderComparisonResultCard, LiveTeamInspectorOverlay, type FabricAgentView } from "../../extensions/fabric/ui.ts";
import { clean, publishActivity, readActivity, readPreview } from "../../extensions/fabric/activity.ts";
const theme = { fg: (_: string, text: string) => text, bold: (text: string) => text };
const agents: FabricAgentView[] = Array.from({ length: 8 }, (_, i) => ({ id: `agent-${i}`, label: `Option ${i} 界`, model: "terra", status: i % 2 ? "done" : "running", activity: "Running tests", result: `Finding ${i}\nEvidence ${i}`, patch: "+first line\n-second line" }));
test("all three surfaces respect terminal width, including tiny terminals", () => {
 for (const width of [1, 2, 3, 20, 75, 76, 100, 160]) {
  const inspector = new LiveTeamInspectorOverlay({ theme, data: { agents } });
  const surfaces = [renderCompactFabricWidget({ agents }, theme, width), renderComparisonResultCard({ left: { label: "Left", summary: "abc ".repeat(100) }, right: { label: "Right", summary: "界".repeat(100) } }, theme, width), inspector.render(width)];
  for (const lines of surfaces) for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
 }
 expect(renderCompactFabricWidget({ agents }, theme).length).toBeLessThanOrEqual(6);
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

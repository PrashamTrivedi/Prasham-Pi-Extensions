import { test, expect } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { PEEK_KEYS, PEEK_OVERLAY_OPTIONS, peekHeight, peekTarget, renderPeekPanel } from "../../extensions/fabric/peek.ts";

const theme = { fg: (_: string, text: string) => text, bg: (_: string, text: string) => text };

test("the peek panel docks right, stays non-capturing, and fits its height", () => {
  expect(PEEK_OVERLAY_OPTIONS.anchor).toBe("right-center");
  expect(PEEK_OVERLAY_OPTIONS.nonCapturing).toBe(true);
  expect(PEEK_OVERLAY_OPTIONS.minWidth).toBe(36);
  expect(PEEK_KEYS).toBe("ctrl+alt+f toggle");
  expect(peekHeight(40)).toBe(30);
  expect(peekHeight(24)).toBe(17);
  expect(peekHeight(Number.NaN)).toBe(17);

  const rows = Array.from({ length: 40 }, (_, index) => `row ${index} that is wider than a narrow panel`);
  for (const width of [36, 60, 120]) {
    const lines = renderPeekPanel({ label: "api", status: "running", rows }, theme, width, 20);
    expect(lines).toHaveLength(20);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
  const frame = renderPeekPanel({ label: "api", status: "running", rows }, theme, 60, 20).join("\n");
  expect(frame).toContain("◆ peek · api");
  expect(frame).toContain("running");
  expect(frame).toContain("live tail · ctrl+alt+f toggle");
  // The footer is always the last row, and padding keeps the frame closed.
  const short = renderPeekPanel({ label: "api", status: "running", rows: [] }, theme, 60, 12);
  expect(short).toHaveLength(12);
  expect(short.at(-1)!.startsWith("╰")).toBe(true);
});

test("the peek target prefers a working agent, then waiting, then the newest failure", () => {
  const agents = [
    { id: "done-1", status: "done", startedAt: "2026-01-01T00:00:00.000Z" },
    { id: "bad-1", status: "error", startedAt: "2026-01-01T01:00:00.000Z" },
    { id: "wait-1", status: "waiting", startedAt: "2026-01-01T02:00:00.000Z" },
    { id: "run-old", status: "running", startedAt: "2026-01-01T03:00:00.000Z" },
    { id: "run-new", status: "running", startedAt: "2026-01-01T04:00:00.000Z" },
  ];
  expect(peekTarget(agents)?.id).toBe("run-new");
  expect(peekTarget(agents.filter((agent) => agent.status !== "running"))?.id).toBe("wait-1");
  expect(peekTarget(agents.filter((agent) => agent.status === "error" || agent.status === "done"))?.id).toBe("bad-1");
  expect(peekTarget([])).toBeUndefined();
});

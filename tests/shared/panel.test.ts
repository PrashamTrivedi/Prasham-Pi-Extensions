import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  meter,
  panelInnerWidth,
  renderPanel,
  type PanelTheme,
} from "../../extensions/shared/panel.ts";

/** No-op theme: drops color so assertions read the plain text. */
const plain: PanelTheme = { fg: (_color, text) => text, bg: (_color, text) => text };

describe("renderPanel", () => {
  test("every line is exactly the requested width", () => {
    for (const width of [40, 80, 120, 200]) {
      const { lines } = renderPanel(plain, width, {
        title: "◈ cockpit",
        right: "opencode-go/m",
        body: [
          "CONTEXT",
          `  ${meter(plain, 62, 16)}  ·  1.5k tok`,
          "",
          "USAGE",
          "  opencode-go: rolling 2%",
          "",
          "RECENT DECISIONS",
          "  • shell-safety · Bash",
        ],
        footer: "/cockpit to hide · refreshes each turn",
      });
      for (const line of lines) {
        expect(visibleWidth(line)).toBe(width);
      }
    }
  });

  test("carries the title and right label on the top rule", () => {
    const { lines } = renderPanel(plain, 80, { title: "duck", right: "p/m · asking" , body: ["q?"] });
    expect(lines[0]).toContain("duck");
    expect(lines[0]).toContain("p/m · asking");
    expect(lines[0]!.startsWith("╭")).toBe(true);
    expect(lines[0]!.endsWith("╮")).toBe(true);
  });

  test("keeps the frame height fixed when a limit is set and pads short bodies", () => {
    const short = renderPanel(plain, 80, { title: "duck", body: ["one"], limit: 5, footer: "hint" });
    // top + 5 body rows + separator + footer + bottom
    expect(short.lines.length).toBe(5 + 1 + 1 + 1 + 1);
    expect(short.total).toBe(1);
  });

  test("windows a long body and reports clamped offset and total", () => {
    const body = Array.from({ length: 40 }, (_, index) => `line ${index}`);
    const atBottom = renderPanel(plain, 80, { title: "duck", body, limit: 10, offset: 999 });
    expect(atBottom.total).toBe(40);
    expect(atBottom.offset).toBe(30);
    expect(atBottom.lines.join("\n")).toContain("line 39");
    expect(atBottom.lines.join("\n")).not.toContain("line 0 ");
  });

  test("wraps long rows instead of clipping them across the frame", () => {
    const long = "word ".repeat(60).trim();
    const { lines, total } = renderPanel(plain, 40, { title: "duck", body: [long] });
    expect(total).toBeGreaterThan(1);
    for (const line of lines) expect(visibleWidth(line)).toBe(40);
  });

  test("handles a very narrow width without overflowing", () => {
    const { lines } = renderPanel(plain, 8, { title: "cockpit", right: "model", body: ["value"], footer: "hint" });
    for (const line of lines) expect(visibleWidth(line)).toBe(8);
  });
});

describe("meter", () => {
  test("fills proportionally and shows the rounded percent", () => {
    expect(meter(plain, 0, 10)).toBe("░".repeat(10) + " 0%");
    expect(meter(plain, 100, 10)).toBe("█".repeat(10) + " 100%");
    expect(meter(plain, 62, 10)).toBe("█".repeat(6) + "░".repeat(4) + " 62%");
  });

  test("shows an unknown marker instead of inventing a number", () => {
    expect(meter(plain, null, 6)).toBe("░".repeat(6) + " ?");
  });

  test("clamps out-of-range values", () => {
    expect(meter(plain, -5, 4)).toBe("░".repeat(4) + " 0%");
    expect(meter(plain, 140, 4)).toBe("█".repeat(4) + " 100%");
  });
});

describe("panelInnerWidth", () => {
  test("reserves one column per border", () => {
    expect(panelInnerWidth(40)).toBe(38);
    expect(panelInnerWidth(1)).toBe(1);
  });
});

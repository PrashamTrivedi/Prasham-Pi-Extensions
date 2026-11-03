import { describe, expect, test } from "bun:test";
import {
  BTW_OVERLAY_MIN_COLUMNS,
  BTW_OVERLAY_OPTIONS,
  BTW_OVERLAY_WIDTH,
  btwMode,
  panelHeight,
  terminalColumns,
  terminalRows,
} from "../../extensions/btw/layout.ts";

describe("btwMode", () => {
  test("uses the panel at 100+ columns and a usable height", () => {
    expect(BTW_OVERLAY_MIN_COLUMNS).toBe(100);
    expect(btwMode(120, 40)).toBe("panel");
    expect(btwMode(100, 40)).toBe("panel");
    expect(btwMode(99, 40)).toBe("full");
    expect(btwMode(120, 11)).toBe("full");
  });
});

describe("overlay geometry", () => {
  test("is the confirmed right-side 45% panel", () => {
    expect(BTW_OVERLAY_WIDTH).toBe("45%");
    expect(BTW_OVERLAY_OPTIONS).toEqual({
      anchor: "right-center",
      width: "45%",
      minWidth: 44,
      maxHeight: "80%",
      margin: 1,
    });
  });
});

describe("terminal size helpers", () => {
  test("mirror Pi's stdout/COLUMNS/LINES fallbacks", () => {
    expect(terminalColumns(120)).toBe(120);
    expect(terminalColumns(undefined, { COLUMNS: "100" })).toBe(100);
    expect(terminalColumns(0, {})).toBe(80);
    expect(terminalRows(40)).toBe(40);
    expect(terminalRows(undefined, { LINES: "30" })).toBe(30);
    expect(terminalRows(0, {})).toBe(24);
  });
});

describe("panelHeight", () => {
  test("stays under the overlay's 80% maxHeight", () => {
    expect(panelHeight(40)).toBe(30);
    expect(panelHeight(20)).toBe(14);
    expect(panelHeight(10)).toBe(8);
    expect(panelHeight(12)).toBe(8);
  });
});

import { describe, expect, test } from "bun:test";
import {
  BTW_NARROW_OVERLAY_OPTIONS,
  BTW_OVERLAY_MIN_COLUMNS,
  BTW_OVERLAY_OPTIONS,
  BTW_OVERLAY_WIDTH,
  btwMode,
  btwOverlayOptions,
  narrowHeight,
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

  test("stays an overlay on narrow terminals", () => {
    expect(BTW_NARROW_OVERLAY_OPTIONS).toEqual({
      anchor: "center",
      width: "100%",
      maxHeight: "90%",
      margin: 0,
    });
    expect(btwOverlayOptions("panel")).toBe(BTW_OVERLAY_OPTIONS);
    expect(btwOverlayOptions("full")).toBe(BTW_NARROW_OVERLAY_OPTIONS);
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

describe("narrowHeight", () => {
  test("stays under the narrow overlay's 90% maxHeight", () => {
    expect(narrowHeight(50)).toBe(43);
    expect(narrowHeight(24)).toBe(19);
    expect(narrowHeight(10)).toBe(8);
    expect(narrowHeight(9)).toBe(7);
    expect(narrowHeight(0)).toBe(19);
  });
});

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  buildCockpitSections,
  renderCockpitPanel,
  type CockpitInput,
} from "../../extensions/workbench/cockpit.ts";
import type { PanelTheme } from "../../extensions/shared/panel.ts";

const plain: PanelTheme = { fg: (_color, text) => text, bg: (_color, text) => text };

const populated: CockpitInput = {
  percent: 62,
  tokens: 1500,
  usageText: "opencode-go: rolling 2%",
  model: "opencode-go/m",
  decisions: ["shell-safety · Bash", "read-budget · Read"],
};

function rowsText(input: CockpitInput): string {
  return buildCockpitSections(input)
    .rows.map((row) => row.text)
    .join("\n");
}

describe("buildCockpitSections", () => {
  test("exposes context, tokens, usage and decisions", () => {
    const sections = buildCockpitSections(populated);
    const text = rowsText(populated);
    expect(text).toContain("CONTEXT");
    expect(text).toContain("1.5k tok");
    expect(text).toContain("opencode-go: rolling 2%");
    expect(text).toContain("• shell-safety · Bash");
    expect(text).toContain("• read-budget · Read");
    expect(sections.right).toBe("opencode-go/m");
    expect(sections.footer).toContain("/cockpit to hide");
  });

  test("carries the context percentage on the meter row", () => {
    const meterRow = buildCockpitSections(populated).rows.find((row) => row.kind === "meter");
    expect(meterRow).toEqual({ kind: "meter", percent: 62, text: "1.5k tok" });
  });

  test("surfaces a missing ledger server instead of throwing", () => {
    const sections = buildCockpitSections({ percent: null, tokens: 0, decisions: [], ledgerError: "Unable to connect" });
    expect(sections.rows.some((row) => row.kind === "error" && row.text.includes("ledger: Unable to connect"))).toBe(true);
  });

  test("shows (none) when there are no decisions and no error", () => {
    expect(rowsText({ percent: 10, tokens: 0, decisions: [] })).toContain("(none)");
    expect(rowsText({ percent: 10, tokens: 0, decisions: [] })).toContain("(unavailable)");
  });
});

describe("renderCockpitPanel", () => {
  test("renders a framed panel with the title and values", () => {
    const lines = renderCockpitPanel(plain, 80, populated);
    const text = lines.join("\n");
    expect(text).toContain("cockpit");
    expect(text).toContain("opencode-go/m");
    expect(text).toContain("62%");
    expect(text).toContain("opencode-go: rolling 2%");
    expect(lines[0]!.startsWith("╭")).toBe(true);
    expect(lines.at(-1)!.endsWith("╯")).toBe(true);
  });

  test("every line fits the overlay width", () => {
    for (const width of [40, 80, 120]) {
      for (const line of renderCockpitPanel(plain, width, populated)) {
        expect(visibleWidth(line)).toBe(width);
      }
    }
  });
});

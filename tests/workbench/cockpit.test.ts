import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  buildCockpitSections,
  formatReset,
  renderCockpitPanel,
  renderCockpitWidget,
  type CockpitInput,
} from "../../extensions/workbench/cockpit.ts";
import type { PanelTheme } from "../../extensions/shared/panel.ts";

const plain: PanelTheme = { fg: (_color, text) => text, bg: (_color, text) => text };

const populated: CockpitInput = {
  percent: 62,
  tokens: 1500,
  model: "opencode-go/m",
  usage: {
    provider: "opencode-go",
    windows: [
      { label: "rolling", percent: 2 },
      { label: "weekly", percent: 10 },
      { label: "monthly", percent: 0 },
    ],
    note: "percent-only",
  },
  decisions: ["shell-safety · Bash", "read-budget · Read"],
};

function rows(input: CockpitInput) {
  return buildCockpitSections(input).rows;
}

function rowsText(input: CockpitInput): string {
  return rows(input)
    .map((row) => (row.kind === "window" ? `${row.window.label} ${row.window.percent}` : row.text))
    .join("\n");
}

describe("buildCockpitSections", () => {
  test("exposes context, tokens and decisions", () => {
    const text = rowsText(populated);
    expect(text).toContain("CONTEXT");
    expect(text).toContain("1.5k tok");
    expect(text).toContain("• shell-safety · Bash");
    expect(text).toContain("• read-budget · Read");
    expect(buildCockpitSections(populated).right).toBe("opencode-go/m");
    expect(buildCockpitSections(populated).footer).toContain("/cockpit to hide");
  });

  test("emits one window row per reported window, in provider order", () => {
    const windows = rows(populated).filter((row) => row.kind === "window");
    expect(windows).toHaveLength(3);
    expect(windows.map((row) => (row.kind === "window" ? row.window.label : ""))).toEqual([
      "rolling",
      "weekly",
      "monthly",
    ]);
  });

  test("shows tokens, spend and note when the provider reports them", () => {
    const text = rowsText({
      ...populated,
      usage: {
        provider: "cloudflare",
        windows: [{ label: "rolling", percent: 40 }],
        tokensToday: { input: 1200, output: 300 },
        usdMtd: 1.5,
        note: "estimate",
      },
    });
    expect(text).toContain("1200 in / 300 out today");
    expect(text).toContain("$1.50 MTD");
    expect(text).toContain("estimate");
  });

  test("surfaces a usage error instead of a silent blank", () => {
    const out = rows({ ...populated, usage: { provider: "opencode-go", windows: [], error: "HTTP 401" } });
    expect(out.some((row) => row.kind === "error" && row.text.includes("HTTP 401"))).toBe(true);
  });

  test("surfaces a missing ledger server instead of throwing", () => {
    const out = rows({ percent: null, tokens: 0, decisions: [], ledgerError: "Unable to connect" });
    expect(out.some((row) => row.kind === "error" && row.text.includes("ledger: Unable to connect"))).toBe(true);
  });

  test("falls back to (none) and (unavailable) with no data", () => {
    const text = rowsText({ percent: 10, tokens: 0, decisions: [] });
    expect(text).toContain("(none)");
    expect(text).toContain("(unavailable)");
  });
});

describe("renderCockpitPanel", () => {
  test("renders a framed panel with the title, usage labels and values", () => {
    const lines = renderCockpitPanel(plain, 80, populated);
    const text = lines.join("\n");
    expect(text).toContain("cockpit");
    expect(text).toContain("opencode-go/m");
    expect(text).toContain("62%");
    expect(text).toContain("rolling");
    expect(text).toContain("2%");
    expect(text).toContain("weekly");
    expect(text).toContain("10%");
    expect(lines[0]!.startsWith("╭")).toBe(true);
    expect(lines.at(-1)!.endsWith("╯")).toBe(true);
  });

  test("shows a reset time next to a window", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const input: CockpitInput = {
      ...populated,
      usage: {
        provider: "opencode-go",
        windows: [{ label: "rolling", percent: 30, resetsAt: "2026-01-01T03:00:00.000Z" }],
      },
    };
    expect(renderCockpitPanel(plain, 90, input, now).join("\n")).toContain("resets 3h");
  });

  test("every line fits the overlay width", () => {
    for (const width of [40, 80, 120]) {
      for (const line of renderCockpitPanel(plain, width, populated)) {
        expect(visibleWidth(line)).toBe(width);
      }
    }
  });

  test("collapses to one fitting line on a narrow dock", () => {
    const lines = renderCockpitWidget(plain, 40, populated);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("ctx 62%");
    expect(visibleWidth(lines[0]!)).toBeLessThanOrEqual(40);
  });

  test("renders the full panel on a wide dock", () => {
    expect(renderCockpitWidget(plain, 100, populated)).toEqual(renderCockpitPanel(plain, 100, populated));
  });
});

describe("formatReset", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");

  test("formats minutes, hours and days", () => {
    expect(formatReset("2026-01-01T00:30:00.000Z", now)).toBe("30m");
    expect(formatReset("2026-01-01T03:00:00.000Z", now)).toBe("3h");
    expect(formatReset("2026-01-03T05:00:00.000Z", now)).toBe("2d");
  });

  test("reports a past reset as now", () => {
    expect(formatReset("2025-12-31T23:00:00.000Z", now)).toBe("now");
  });

  test("returns undefined for absent or invalid input", () => {
    expect(formatReset(undefined, now)).toBeUndefined();
    expect(formatReset("not-a-date", now)).toBeUndefined();
  });
});

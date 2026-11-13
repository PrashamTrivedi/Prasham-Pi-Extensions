import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  buildCockpitSections,
  formatReset,
  expandedRowBudget,
  formatResetExact,
  nextCockpitMode,
  renderCockpitCompact,
  renderCockpitPanel,
  renderCockpitWidget,
  type CockpitInput,
} from "../../extensions/workbench/cockpit.ts";
import type { HudCard } from "../../extensions/workbench/hud-logic.ts";
import type { PanelTheme } from "../../extensions/shared/panel.ts";

const plain: PanelTheme = { fg: (_color, text) => text, bg: (_color, text) => text };

const tagged: PanelTheme = { fg: (color, text) => `<${color}:${text}>`, bg: (_color, text) => text };

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

  test("compact mode is a colored usage line with no tokens or decision text", () => {
    const lines = renderCockpitWidget(plain, 120, populated, Date.now(), { mode: "compact", maxRows: 8 });
    expect(lines).toEqual(["◈ ctx 62% · rolling 2% · weekly 10% · monthly 0%"]);
  });

  test("compact usage percentages are colored by threshold, labels muted", () => {
    const input: CockpitInput = {
      ...populated,
      percent: 49,
      usage: { provider: "p", windows: [{ label: "a", percent: 50 }, { label: "b", percent: 79 }, { label: "c", percent: 80 }] },
    };
    const line = renderCockpitCompact(tagged, 400, input)[0]!;
    expect(line).toContain("<muted:ctx> <success:49%>");
    expect(line).toContain("<muted:a> <warning:50%>");
    expect(line).toContain("<muted:b> <warning:79%>");
    expect(line).toContain("<muted:c> <error:80%>");
  });

  test("compact shows only ctx without usage, and a dim usage ? on error", () => {
    expect(renderCockpitCompact(plain, 120, { percent: 10, tokens: 0, decisions: [] })).toEqual(["◈ ctx 10%"]);
    const err = renderCockpitCompact(tagged, 400, { percent: 10, tokens: 0, decisions: [], usage: { provider: "p", windows: [], error: "x" } });
    expect(err[0]).toContain("<dim:usage ?>");
  });

  test("compact lists at most 2 HUD cards, newest first, errors first on ties", () => {
    const card = (source: string, status: HudCard["status"], updatedAt: number, lines: string[] = []): HudCard => ({
      source, title: `T-${source}`, status, progress: null, lines, updatedAt, ttlSec: 900, detail: [], sections: [],
    });
    const hud = { at: 100_000, stale: 0, cards: [card("old", "ok", 1000), card("tie-ok", "ok", 90_000), card("tie-err", "error", 90_000, ["boom happened"]), card("new", "running", 95_000)] };
    const lines = renderCockpitCompact(tagged, 400, { ...populated, hud });
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("<accent:●> T-new");
    expect(lines[2]).toContain("<error:✗> T-tie-err");
    expect(lines[2]).toContain("<muted:boom happened>");
    expect(lines[2]).toContain("<dim:10s>");
    expect(lines.join("\n")).not.toContain("T-old");
    expect(lines.join("\n")).not.toContain("T-tie-ok");
  });

  test("compact renders only the usage line when there are no cards", () => {
    expect(renderCockpitCompact(plain, 100, { ...populated, hud: { at: 1, stale: 0, cards: [] } })).toHaveLength(1);
  });

  test("compact lines never exceed the width", () => {
    const long: HudCard = { source: "s", title: "x".repeat(80), status: "warn", progress: null, lines: ["y".repeat(200)], updatedAt: 1, ttlSec: 900, detail: [], sections: [] };
    for (const width of [60, 61, 80, 120]) {
      for (const line of renderCockpitWidget(plain, width, { ...populated, hud: { at: 2, stale: 0, cards: [long, long] } }, 2, { mode: "compact", maxRows: 8 })) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  test("full mode caps the body at maxRows and points at the view that reveals more", () => {
    const uncapped = renderCockpitPanel(plain, 100, populated);
    const capped = renderCockpitWidget(plain, 100, populated, Date.now(), { mode: "full", maxRows: 4 });
    expect(capped.length).toBeLessThan(uncapped.length);
    expect(capped.join("\n")).toMatch(/\+\d+ more · \/cockpit expanded/);
    expect(capped.join("\n")).not.toContain("/cockpit compact");
  });
});

describe("pace-colored usage windows", () => {
  const now = Date.parse("2026-11-13T12:00:00.000Z");
  const at = (ms: number): string => new Date(now + ms).toISOString();
  const withWindows = (percent: number, resetInMs: number): CockpitInput => ({
    ...populated,
    usage: { provider: "opencode-go", windows: [{ label: "rolling", percent, resetsAt: at(resetInMs) }] },
  });

  test("a slow window is green and a fast one is red, regardless of percent", () => {
    const slow = renderCockpitPanel(tagged, 120, withWindows(40, 2.5 * 3_600_000), now).join("\n");
    expect(slow).toContain("<success:40%>");
    const fast = renderCockpitPanel(tagged, 120, withWindows(51, 2.5 * 3_600_000), now).join("\n");
    expect(fast).toContain("<warning:51%>");
    const worst = renderCockpitPanel(tagged, 120, withWindows(60, 2.5 * 3_600_000), now).join("\n");
    expect(worst).toContain("<error:60%>");
  });

  test("compact mode colors the same way", () => {
    const line = renderCockpitCompact(tagged, 400, withWindows(60, 2.5 * 3_600_000), now)[0]!;
    expect(line).toContain("<muted:rolling> <error:60%>");
  });

  test("expanded mode shows the exact reset date instead of a shorthand", () => {
    const input = withWindows(40, 3 * 3_600_000);
    const compact = renderCockpitPanel(plain, 120, input, now).join("\n");
    const expanded = renderCockpitPanel(plain, 120, input, now, Number.POSITIVE_INFINITY, true).join("\n");
    expect(compact).toContain("resets 3h");
    expect(expanded).toContain(`resets ${formatResetExact(input.usage!.windows[0]!.resetsAt, now)}`);
    expect(expanded).not.toContain("resets 3h");
  });
});

describe("formatResetExact", () => {
  // Built from local parts, so the assertion holds in any timezone.
  const local = new Date(2026, 10, 16, 0, 0, 0);

  test("formats weekday, day, month and local time", () => {
    expect(formatResetExact(local.toISOString(), local.getTime() - 60_000)).toBe("Mon 16 Nov 00:00");
  });

  test("adds the year only when it differs", () => {
    const next = new Date(2027, 0, 5, 9, 5, 0);
    expect(formatResetExact(next.toISOString(), local.getTime())).toBe("Tue 5 Jan 2027 09:05");
  });

  test("reports a past reset as now and ignores invalid input", () => {
    expect(formatResetExact(local.toISOString(), local.getTime() + 60_000)).toBe("now");
    expect(formatResetExact(undefined, local.getTime())).toBeUndefined();
    expect(formatResetExact("nope", local.getTime())).toBeUndefined();
  });
});

describe("expanded view", () => {
  const now = Date.parse("2026-11-13T12:00:00.000Z");
  const jev: HudCard = {
    source: "jev",
    title: "Jev · shell-safety",
    status: "ok",
    progress: null,
    // 60 chars: the full view clips at 34, expanded keeps it and wraps the panel.
    lines: [`→ pass · bash · 574ms · ${"x".repeat(37)}`],
    updatedAt: now - 4_000,
    ttlSec: 600,
    detail: ["detail line one"],
    sections: [
      { title: "Verdict", open: true, tone: "ok", lines: ["action: none (not applied)", "mode: enforce"] },
      { title: "Answers", open: false, summary: "2 in 574ms", lines: ["hidden line"] },
    ],
  };
  const input: CockpitInput = {
    ...populated,
    tokens: 1500,
    contextWindow: 200_000,
    hud: { at: now, stale: 0, cards: [jev] },
  };
  const expanded = renderCockpitPanel(plain, 160, input, now, Number.POSITIVE_INFINITY, true).join("\n");
  const full = renderCockpitPanel(plain, 160, input, now).join("\n");

  test("shows the context window and known ceilings", () => {
    expect(expanded).toContain("1,500 / 200,000 tok");
    expect(expanded).toContain("≤ 8,000 chars · project-context tree");
    expect(expanded).toContain("recursive-context");
    expect(full).not.toContain("1,500 / 200,000 tok");
  });

  test("expands HUD sections in place, without duplicating detail", () => {
    expect(expanded).toContain("▾ Verdict");
    expect(expanded).toContain("action: none (not applied)");
    expect(expanded).toContain("▸ Answers  2 in 574ms");
    expect(expanded).not.toContain("hidden line");
    expect(expanded).not.toContain("detail line one");
    expect(full).not.toContain("Verdict");
  });

  test("shows a card's raw detail when it has no sections", () => {
    const plainCard: HudCard = { ...jev, source: "deploy", title: "backend: deployed", sections: [], detail: ["deployed 89b9f87", "HEAD 89b9f87"] };
    const out = renderCockpitPanel(plain, 160, { ...input, hud: { at: now, stale: 0, cards: [plainCard] } }, now, Number.POSITIVE_INFINITY, true).join("\n");
    expect(out).toContain("▾ Detail");
    expect(out).toContain("deployed 89b9f87");
  });

  test("keeps card lines untruncated for a card without sections", () => {
    const plainCard: HudCard = { ...jev, source: "deploy", title: "deploy: backend", status: "ok", lines: ["deployed 89b9f87 · " + "x".repeat(37)], sections: [], detail: [] };
    const out = renderCockpitPanel(plain, 160, { ...input, hud: { at: now, stale: 0, cards: [plainCard] } }, now, Number.POSITIVE_INFINITY, true).join("\n");
    expect(out).toContain("x".repeat(37));
    expect(full).not.toContain("x".repeat(37));
  });

  test("a card with sections replaces its summary lines instead of repeating them", () => {
    expect(expanded).not.toContain("→ pass · bash · 574ms · " + "x".repeat(37));
  });

  test("maxRows counts wrapped rows, not source rows", () => {
    const long: HudCard = { ...jev, sections: [], detail: [], lines: ["y".repeat(400)] };
    const capped = renderCockpitWidget(plain, 100, { ...input, hud: { at: now, stale: 0, cards: [long] } }, now, { mode: "expanded", maxRows: 8 });
    // 8 body rows + top border + footer separator + footer + bottom border.
    expect(capped.length).toBeLessThanOrEqual(12);
    expect(capped.join("\n")).toMatch(/\+\d+ more · \/hud <source> for all/);
  });

  test("the widget renders expanded and still honors maxRows", () => {
    const uncapped = renderCockpitWidget(plain, 160, input, now, { mode: "expanded", maxRows: 500 });
    expect(uncapped.join("\n")).toContain("▾ Verdict");
    const capped = renderCockpitWidget(plain, 160, input, now, { mode: "expanded", maxRows: 5 });
    expect(capped.join("\n")).toMatch(/\+\d+ more/);
  });

  test("the footer says how to collapse", () => {
    expect(buildCockpitSections(input, { expanded: true, now }).footer).toContain("/cockpit collapse");
  });
});

describe("expandedRowBudget", () => {
  test("uses about 45% of the terminal, never less than the configured maxRows", () => {
    expect(expandedRowBudget(40, 8)).toBe(18);
    expect(expandedRowBudget(24, 8)).toBe(11);
    expect(expandedRowBudget(80, 8)).toBe(36);
    // A tiny terminal falls back to the configured cap.
    expect(expandedRowBudget(12, 8)).toBe(8);
    // A raised maxRows still wins.
    expect(expandedRowBudget(50, 20)).toBe(23);
    expect(expandedRowBudget(Number.NaN, 8)).toBe(18);
  });

  test("an expanded dock leaves the transcript most of a 40-row screen", () => {
    const rows = expandedRowBudget(40, 8);
    expect(rows).toBeLessThan(20);
    expect(rows).toBeGreaterThan(8);
  });
});

describe("nextCockpitMode", () => {
  test("collapse is an alias for compact", () => {
    expect(nextCockpitMode("expanded", "collapse")).toBe("compact");
    expect(nextCockpitMode("full", " COLLAPSE ")).toBe("compact");
    expect(nextCockpitMode("compact", "compact")).toBe("compact");
  });

  test("full and expanded switch, with expanded as a toggle", () => {
    expect(nextCockpitMode("compact", "full")).toBe("full");
    expect(nextCockpitMode("full", "expanded")).toBe("expanded");
    expect(nextCockpitMode("expanded", "expanded")).toBe("full");
    expect(nextCockpitMode("full", "expand")).toBe("expanded");
  });

  test("anything else leaves the dock toggle alone", () => {
    expect(nextCockpitMode("full", "")).toBeUndefined();
    expect(nextCockpitMode("full", "bogus")).toBeUndefined();
  });
});

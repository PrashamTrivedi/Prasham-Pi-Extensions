import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PanelTheme } from "../../extensions/shared/panel.ts";
import { renderPanel } from "../../extensions/shared/panel.ts";
import { buildCockpitSections, renderCockpitWidget } from "../../extensions/workbench/cockpit.ts";
import { buildDetailBody, createHudFeed, readHudCards } from "../../extensions/workbench/hud.ts";
import {
  detailOf,
  findCard,
  hudDir,
  isHudFile,
  listLines,
  parseCard,
  sectionsOf,
  snapshotOf,
  toastLevel,
  transitions,
  type HudCard,
  type HudStatus,
} from "../../extensions/workbench/hud-logic.ts";

const plain: PanelTheme = { fg: (_c, t) => t, bg: (_c, t) => t };
const NOW = 1_800_000_000_000;

function card(source: string, status: HudStatus, over: Partial<HudCard> = {}): HudCard {
  return { source, title: source, status, progress: null, lines: [], updatedAt: NOW, ttlSec: 900, detail: [], sections: [], ...over };
}

describe("parseCard", () => {
  test("requires a valid status", () => {
    expect(parseCard("a.json", "{}", NOW)).toBeNull();
    expect(parseCard("a.json", "not json", NOW)).toBeNull();
    expect(parseCard("a.json", '{"status":"bogus"}', NOW)).toBeNull();
    expect(parseCard("a.json", "[]", NOW)).toBeNull();
  });

  test("fills defaults from the file name and mtime", () => {
    const parsed = parseCard("jobhunt.json", '{"status":"RUNNING"}', NOW)!;
    expect(parsed.source).toBe("jobhunt");
    expect(parsed.title).toBe("jobhunt");
    expect(parsed.status).toBe("running");
    expect(parsed.updatedAt).toBe(NOW);
    expect(parsed.ttlSec).toBe(900);
  });

  test("clamps progress, keeps the last 3 lines, accepts epoch seconds", () => {
    const parsed = parseCard(
      "x.json",
      JSON.stringify({ status: "ok", progress: 250, lines: ["a", "b", "c", "d"], updatedAt: 1_800_000_000 }),
      0,
    )!;
    expect(parsed.progress).toBe(100);
    expect(parsed.lines).toEqual(["b", "c", "d"]);
    expect(parsed.updatedAt).toBe(1_800_000_000_000);
  });

  test("a single `line` becomes lines", () => {
    expect(parseCard("x.json", '{"status":"ok","line":"hi"}', 0)!.lines).toEqual(["hi"]);
  });
});

describe("detail and sections", () => {
  test("detail splits strings and replaces tabs", () => {
    expect(detailOf("a\n\tb")).toEqual(["a", "  b"]);
    expect(detailOf(5)).toEqual([]);
  });

  test("sections drop untitled entries, ignore bad tone/open", () => {
    const out = sectionsOf([
      { lines: ["no title"] },
      { title: "Steps", lines: "a\nb", tone: "nope", open: "yes", summary: "2" },
      { title: "Log", lines: ["x"], tone: "muted", open: false },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ title: "Steps", lines: ["a", "b"], summary: "2" });
    expect(out[1]?.tone).toBe("muted");
    expect(out[1]?.open).toBe(false);
  });
});

describe("snapshotOf", () => {
  test("expires by ttl and sorts error > warn > running > idle > ok", () => {
    const cards = [
      card("ok", "ok"),
      card("idle", "idle"),
      card("run", "running"),
      card("warn", "warn"),
      card("err", "error"),
      card("old", "error", { updatedAt: NOW - 2_000_000, ttlSec: 60 }),
    ];
    const snap = snapshotOf(cards, NOW);
    expect(snap.cards.map((c) => c.source)).toEqual(["err", "warn", "run", "idle", "ok"]);
    expect(snap.stale).toBe(1);
  });

  test("same status: newest first, capped at 6", () => {
    const cards = Array.from({ length: 8 }, (_, i) => card(`s${i}`, "ok", { updatedAt: NOW - i }));
    const snap = snapshotOf(cards, NOW);
    expect(snap.cards).toHaveLength(6);
    expect(snap.cards[0]?.source).toBe("s0");
  });
});

describe("transitions", () => {
  test("toasts only known sources that moved to ok/warn/error", () => {
    const previous = new Map<string, HudStatus>([
      ["a", "running"],
      ["b", "running"],
      ["c", "ok"],
      ["d", "running"],
    ]);
    const next = [card("a", "ok"), card("b", "running"), card("c", "ok"), card("d", "idle"), card("new", "error")];
    expect(transitions(previous, next).map((c) => c.source)).toEqual(["a"]);
  });

  test("toast levels", () => {
    expect(toastLevel("error")).toBe("error");
    expect(toastLevel("warn")).toBe("warning");
    expect(toastLevel("ok")).toBe("info");
  });
});

describe("feed and files", () => {
  test("hudDir honours the override", () => {
    expect(hudDir("/h")).toBe("/h/.workbench/hud");
    expect(hudDir("/h", "/x")).toBe("/x");
  });

  test("isHudFile", () => {
    expect(isHudFile({ name: "a.json", isFile: true, size: 10 })).toBe(true);
    expect(isHudFile({ name: ".a.json", isFile: true, size: 10 })).toBe(false);
    expect(isHudFile({ name: "a.txt", isFile: true, size: 10 })).toBe(false);
    expect(isHudFile({ name: "a.json", isFile: true, size: 1e6 })).toBe(false);
  });

  test("readHudCards reads a real drop dir and skips junk", () => {
    const dir = mkdtempSync(join(tmpdir(), "hud-"));
    writeFileSync(join(dir, "a.json"), JSON.stringify({ status: "ok", title: "A" }));
    writeFileSync(join(dir, "bad.json"), "{nope");
    writeFileSync(join(dir, "note.txt"), "x");
    const cards = readHudCards(dir);
    expect(cards.map((c) => c.title)).toEqual(["A"]);
    expect(readHudCards(join(dir, "missing"))).toEqual([]);
  });

  test("feed toasts a transition once and stays quiet on first sight", () => {
    let cards = [card("a", "running")];
    const feed = createHudFeed(() => cards);
    const toasts: string[] = [];
    const notify = (m: string): void => void toasts.push(m);
    feed.poll(notify, NOW);
    expect(toasts).toEqual([]);
    cards = [card("a", "error", { title: "Sweep", lines: ["✗ boom"] })];
    feed.poll(notify, NOW);
    feed.poll(notify, NOW);
    expect(toasts).toEqual(["✗ Sweep: ✗ boom"]);
    expect(feed.snapshot.cards).toHaveLength(1);
  });
});

describe("/hud helpers", () => {
  test("findCard prefers exact then prefix then substring", () => {
    const cards = [card("deploy-api", "ok", { title: "Deploy api" }), card("deploy", "ok"), card("jobhunt", "ok", { title: "Daily sweep" })];
    expect(findCard(cards, "deploy")?.source).toBe("deploy");
    expect(findCard(cards, "deploy-")?.source).toBe("deploy-api");
    expect(findCard(cards, "sweep")?.source).toBe("jobhunt");
    expect(findCard(cards, "zzz")).toBeUndefined();
  });

  test("listLines", () => {
    expect(listLines({ at: NOW, cards: [], stale: 0 })[0]).toContain("no cards");
    const lines = listLines({ at: NOW, cards: [card("a", "warn", { progress: 40, lines: ["x"] })], stale: 2 });
    expect(lines[0]).toContain("! a");
    expect(lines[0]).toContain("40%");
    expect(lines[1]).toContain("2 stale");
  });
});

describe("detail body", () => {
  const detailed = card("a", "ok", {
    lines: ["first"],
    detail: ["raw one"],
    sections: [
      { title: "Steps", lines: ["build ok"], open: true, tone: "ok" },
      { title: "Log", lines: ["hidden line"], tone: "muted" },
    ],
  });

  test("open sections show lines, closed ones do not; toggling flips", () => {
    const text = buildDetailBody(plain, detailed, new Set(), NOW).join("\n");
    expect(text).toContain("build ok");
    expect(text).not.toContain("hidden line");
    expect(text).toContain("raw one");
    const flipped = buildDetailBody(plain, detailed, new Set([0, 1]), NOW).join("\n");
    expect(flipped).not.toContain("build ok");
    expect(flipped).toContain("hidden line");
  });

  test("panel keeps every line at exactly the width", () => {
    const layout = renderPanel(plain, 50, { title: "t", body: buildDetailBody(plain, detailed, new Set(), NOW), limit: 8 });
    for (const line of layout.lines) expect(visibleWidth(line)).toBe(50);
  });
});

describe("cockpit integration", () => {
  const base = { percent: 10, tokens: 5, decisions: [] };
  test("no hud block when the feature is off", () => {
    expect(buildCockpitSections(base).rows.some((r) => r.kind === "hud")).toBe(false);
  });

  test("hud cards, progress and clipped lines become rows", () => {
    const hud = { at: NOW, stale: 1, cards: [card("a", "running", { progress: 40, lines: ["x".repeat(60)] })] };
    const rows = buildCockpitSections({ ...base, hud }).rows;
    expect(rows.some((r) => r.kind === "label" && r.text === "HUD · 1 stale")).toBe(true);
    expect(rows.some((r) => r.kind === "hud-progress")).toBe(true);
    const line = rows.find((r) => r.kind === "hud-line");
    expect(line && line.kind === "hud-line" && line.text.length).toBe(34);
  });

  test("narrow widget collapses to one line and flags attention", () => {
    const hud = { at: NOW, stale: 0, cards: [card("a", "error"), card("b", "ok")] };
    const lines = renderCockpitWidget(plain, 40, { ...base, hud });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("hud 2 (1!)");
  });

  test("wide panel keeps exact width with hud rows", () => {
    const hud = { at: NOW, stale: 0, cards: [card("a", "warn", { lines: ["! look"], progress: 50 })] };
    for (const line of renderCockpitWidget(plain, 70, { ...base, hud })) expect(visibleWidth(line)).toBe(70);
  });
});

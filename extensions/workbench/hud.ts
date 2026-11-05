/**
 * hud — the HUD feed on the Pi side. Reads the same drop directory as the Claude Code workbench
 * (`~/.workbench/hud/*.json`, `WORKBENCH_HUD_DIR` overrides) so feeders (jev-harness, jobhunt, the
 * `hud` CLI) show on both surfaces unchanged. Cards render in the docked cockpit; `/hud` lists them
 * and `/hud <source>` opens the detail in an overlay that Esc closes.
 *
 * Parsing, sorting and transitions are pure and live in `hud-logic.ts`.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component } from "@earendil-works/pi-tui";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { renderPanel, type PanelTheme } from "../shared/panel.ts";
import type { WorkbenchConfig } from "./config.ts";
import {
  age,
  emptyHud,
  findCard,
  hudDir,
  isHudFile,
  listLines,
  MAX_FILES,
  parseCard,
  snapshotOf,
  STATUS_GLYPH,
  toastLevel,
  toastText,
  transitions,
  type HudCard,
  type HudSnapshot,
  type HudStatus,
  type HudTone,
} from "./hud-logic.ts";

export function resolveHudDir(): string {
  return hudDir(homedir(), process.env.WORKBENCH_HUD_DIR);
}

/** Read every card file in `dir`, newest file first. Never throws: a missing dir is an empty feed. */
export function readHudCards(dir: string): HudCard[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const files: Array<{ name: string; mtimeMs: number }> = [];
  for (const name of names) {
    try {
      const stat = statSync(join(dir, name));
      if (isHudFile({ name, isFile: stat.isFile(), size: stat.size })) files.push({ name, mtimeMs: stat.mtimeMs });
    } catch {
      // File vanished between listing and stat.
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const cards: HudCard[] = [];
  for (const file of files.slice(0, MAX_FILES)) {
    try {
      const card = parseCard(file.name, readFileSync(join(dir, file.name), "utf8"), file.mtimeMs);
      if (card) cards.push(card);
    } catch {
      // Half-written or unreadable: skipped, the next poll retries.
    }
  }
  return cards;
}

export type HudNotify = (message: string, level: "info" | "warning" | "error") => void;

export interface HudFeed {
  readonly snapshot: HudSnapshot;
  /** Re-read the drop dir, toast any known source that moved to ok/warn/error, return the snapshot. */
  poll(notify?: HudNotify, now?: number): HudSnapshot;
}

export function createHudFeed(readCards: () => HudCard[] = () => readHudCards(resolveHudDir())): HudFeed {
  let seen = new Map<string, HudStatus>();
  let current: HudSnapshot = emptyHud(0);
  return {
    get snapshot() {
      return current;
    },
    poll(notify, now = Date.now()) {
      const next = snapshotOf(readCards(), now);
      if (notify) {
        for (const card of transitions(seen, next.cards)) notify(toastText(card), toastLevel(card.status));
      }
      seen = new Map(next.cards.map((card) => [card.source, card.status]));
      current = next;
      return next;
    },
  };
}

/** Process-wide feed shared by the cockpit and `/hud`. */
export const hudFeed: HudFeed = createHudFeed();

// ---------------------------------------------------------------------------------------------
// Detail view

const TONE_COLOR: Record<HudTone, "success" | "warning" | "error" | "dim"> = {
  ok: "success",
  warn: "warning",
  error: "error",
  muted: "dim",
};

const STATUS_COLOR: Record<HudStatus, "accent" | "success" | "warning" | "error" | "dim"> = {
  running: "accent",
  ok: "success",
  warn: "warning",
  error: "error",
  idle: "dim",
};

export const isSectionOpen = (card: HudCard, index: number, toggled: ReadonlySet<number>): boolean => {
  const base = card.sections[index]?.open === true;
  return toggled.has(index) ? !base : base;
};

/** Body rows of the detail panel; pure and ANSI-free apart from theme colors. */
export function buildDetailBody(
  theme: PanelTheme,
  card: HudCard,
  toggled: ReadonlySet<number>,
  now: number,
): string[] {
  const body: string[] = [];
  body.push(
    theme.fg(STATUS_COLOR[card.status], `${STATUS_GLYPH[card.status]} ${card.status}`) +
      theme.fg("dim", `  ${card.source} · ${age(now - card.updatedAt)} ago`) +
      (card.progress === null ? "" : theme.fg("muted", `  ${Math.round(card.progress)}%`)),
  );
  for (const line of card.lines) body.push(`  ${line}`);

  card.sections.forEach((section, index) => {
    const open = isSectionOpen(card, index, toggled);
    const color = section.tone ? TONE_COLOR[section.tone] : "accent";
    const key = index < 9 ? theme.fg("dim", `${index + 1} `) : "  ";
    body.push("");
    body.push(
      key +
        theme.fg(color, `${open ? "▾" : "▸"} ${section.title}`) +
        (section.summary ? theme.fg("dim", `  ${section.summary}`) : ""),
    );
    if (!open) return;
    for (const line of section.lines) {
      const gutter = theme.fg(section.tone ? TONE_COLOR[section.tone] : "dim", "│ ");
      const colored = line.startsWith("✗") ? theme.fg("error", line) : line.startsWith("!") ? theme.fg("warning", line) : line;
      body.push(`  ${gutter}${colored}`);
    }
  });

  if (card.detail.length > 0) {
    body.push("");
    body.push(theme.fg("accent", "Detail"));
    for (const line of card.detail) body.push(`  ${line}`);
  }
  if (card.sections.length === 0 && card.detail.length === 0) {
    body.push("");
    body.push(theme.fg("dim", '  No detail from this source (writers add it with hud set <source> -d "...").'));
  }
  return body;
}

class HudDetail implements Component {
  private offset = 0;
  private limit: number;
  private readonly toggled = new Set<number>();

  constructor(
    private readonly theme: PanelTheme,
    private readonly card: HudCard,
    private readonly done: () => void,
    rows: number,
    private readonly requestRender: () => void,
  ) {
    this.limit = Math.max(6, Math.floor(rows * 0.8) - 5);
  }

  render(width: number): string[] {
    const layout = renderPanel(this.theme, width, {
      title: `◈ ${this.card.title}`,
      right: this.card.source,
      body: buildDetailBody(this.theme, this.card, this.toggled, Date.now()),
      footer: "esc close · ↑↓ pgup/pgdn scroll · 1-9 toggle section",
      offset: this.offset,
      limit: this.limit,
    });
    this.offset = layout.offset;
    return layout.lines;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) return this.done();
    if (matchesKey(data, Key.up)) this.offset = Math.max(0, this.offset - 1);
    else if (matchesKey(data, Key.down)) this.offset += 1;
    else if (matchesKey(data, Key.pageUp)) this.offset = Math.max(0, this.offset - this.limit);
    else if (matchesKey(data, Key.pageDown)) this.offset += this.limit;
    else if (/^[1-9]$/.test(data)) {
      const index = Number(data) - 1;
      if (index < this.card.sections.length) {
        if (this.toggled.has(index)) this.toggled.delete(index);
        else this.toggled.add(index);
      }
    } else return;
    this.requestRender();
  }

  invalidate(): void {}
}

const HUD_OVERLAY = { anchor: "center", width: "70%", minWidth: 44, maxHeight: "85%", margin: 1 } as const;

async function openDetail(ctx: ExtensionContext, card: HudCard): Promise<void> {
  if (!ctx.hasUI || ctx.mode !== "tui") {
    ctx.ui.notify([toastText(card), ...card.detail].join("\n"), "info");
    return;
  }
  const rows = typeof process.stdout.rows === "number" && process.stdout.rows > 0 ? process.stdout.rows : 24;
  await ctx.ui.custom<void>(
    (tui, theme, _keys, done) => new HudDetail(theme, card, () => done(), rows, () => tui.requestRender()),
    { overlay: true, overlayOptions: { ...HUD_OVERLAY } },
  );
}

export function registerHud(pi: ExtensionAPI, getConfig: () => WorkbenchConfig): void {
  // With the cockpit off nothing else polls the feed; keep toasts alive on turn boundaries.
  pi.on("turn_end", async (_event, ctx) => {
    const config = getConfig();
    if (!config.hud.enabled || config.cockpit.enabled || !ctx.hasUI) return;
    hudFeed.poll((message, level) => ctx.ui.notify(message, level));
  });

  pi.registerCommand("hud", {
    description: "List HUD cards, or /hud <source> to open one's detail",
    handler: async (args, ctx) => {
      if (!getConfig().hud.enabled) {
        ctx.ui.notify("hud disabled in workbench.config.json", "warning");
        return;
      }
      const snapshot = hudFeed.poll((message, level) => ctx.ui.notify(message, level));
      const query = args.trim();
      if (query.length === 0) {
        ctx.ui.notify(listLines(snapshot).join("\n"), "info");
        return;
      }
      const card = findCard(snapshot.cards, query);
      if (!card) {
        ctx.ui.notify(`hud: no card matching "${query}"`, "warning");
        return;
      }
      await openDetail(ctx, card);
    },
  });
}

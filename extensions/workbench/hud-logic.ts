/**
 * HUD feed logic — pure. Ported (copied, not imported) from the Claude Code workbench mod's
 * `hooks/lib/hud.ts`, so both surfaces read the same `~/.workbench/hud/*.json` drop dir with the
 * same card schema, ttl expiry, sort order and transition rules.
 *
 *   { "source": "jobhunt", "title": "Daily sweep", "status": "running", "progress": 40,
 *     "lines": ["12 of 30 boards"], "updatedAt": 1791181945233, "ttlSec": 900 }
 *
 * Only `status` is required. A card older than its ttl is hidden; the file stays until its writer
 * (or `hud rm`) removes it.
 */

export type HudStatus = "running" | "ok" | "warn" | "error" | "idle";
export type HudTone = "ok" | "warn" | "error" | "muted";

export interface HudSection {
  title: string;
  summary?: string;
  lines: string[];
  open?: boolean;
  tone?: HudTone;
}

export interface HudCard {
  source: string;
  title: string;
  status: HudStatus;
  progress: number | null;
  lines: string[];
  updatedAt: number;
  ttlSec: number;
  detail: string[];
  sections: HudSection[];
}

export interface HudSnapshot {
  at: number;
  cards: HudCard[];
  stale: number;
}

export const HUD_DIR_SUFFIX = "/.workbench/hud";
export const DEFAULT_TTL_SEC = 15 * 60;
export const MAX_CARDS = 6;
export const MAX_LINES = 3;
export const MAX_DETAIL_LINES = 200;
export const MAX_SECTIONS = 12;
export const MAX_SECTION_LINES = 300;
export const MAX_TITLE_CHARS = 80;
export const MAX_FILES = 24;
const MAX_DETAIL_CHARS = 16 * 1024;
export const MAX_FILE_BYTES = 64 * 1024;

const TONES: readonly HudTone[] = ["ok", "warn", "error", "muted"];
const STATUSES: readonly HudStatus[] = ["running", "ok", "warn", "error", "idle"];
const ORDER: Record<HudStatus, number> = { error: 0, warn: 1, running: 2, idle: 3, ok: 4 };

export const STATUS_GLYPH: Record<HudStatus, string> = { running: "●", ok: "✓", warn: "!", error: "✗", idle: "○" };

export const hudDir = (home: string, override?: string): string =>
  override && override.length > 0 ? override : `${home}${HUD_DIR_SUFFIX}`;

export const emptyHud = (at: number): HudSnapshot => ({ at, cards: [], stale: 0 });

export const isHudFile = (entry: { name: string; isFile: boolean; size: number }): boolean =>
  entry.isFile && entry.name.endsWith(".json") && !entry.name.startsWith(".") && entry.size <= MAX_FILE_BYTES;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function timeOf(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Seconds since the epoch are accepted too (`date +%s`).
    return value < 1e12 ? value * 1000 : value;
  }
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** One file's text to a card, or null when it is not a card. `mtimeMs` stands in for a missing updatedAt. */
export function parseCard(fileName: string, body: string, mtimeMs: number): HudCard | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const fields = raw as Record<string, unknown>;
  const status = text(fields.status).toLowerCase() as HudStatus;
  if (!STATUSES.includes(status)) return null;

  const source = text(fields.source) || fileName.replace(/\.json$/, "");
  const progress =
    typeof fields.progress === "number" && Number.isFinite(fields.progress)
      ? Math.min(100, Math.max(0, fields.progress))
      : null;
  const lines = Array.isArray(fields.lines)
    ? fields.lines.map(text).filter((line) => line.length > 0).slice(-MAX_LINES)
    : text(fields.line)
      ? [text(fields.line)]
      : [];
  const ttl = typeof fields.ttlSec === "number" && fields.ttlSec > 0 ? fields.ttlSec : DEFAULT_TTL_SEC;

  return {
    source,
    title: text(fields.title) || source,
    status,
    progress,
    lines,
    updatedAt: timeOf(fields.updatedAt, mtimeMs),
    ttlSec: ttl,
    detail: detailOf(fields.detail),
    sections: sectionsOf(fields.sections),
  };
}

/** `detail` as a string (split on newlines) or an array of strings, capped in lines and characters. */
export function detailOf(value: unknown): string[] {
  const raw =
    typeof value === "string"
      ? value.split("\n")
      : Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [];
  const out: string[] = [];
  let chars = 0;
  for (const line of raw.slice(0, MAX_DETAIL_LINES)) {
    chars += line.length;
    if (chars > MAX_DETAIL_CHARS) {
      out.push("... (detail cut)");
      break;
    }
    out.push(line.replace(/\t/g, "  ").trimEnd());
  }
  return out;
}

/**
 * `sections` as `[{ title, summary?, lines[], open?, tone? }]`. An entry without a title is dropped,
 * `lines` may be an array or one newline-split string, a bad tone or non-boolean `open` is ignored.
 * Capped at MAX_SECTIONS, MAX_SECTION_LINES lines in all and MAX_DETAIL_CHARS characters in all.
 */
export function sectionsOf(value: unknown): HudSection[] {
  if (!Array.isArray(value)) return [];
  const out: HudSection[] = [];
  let lineBudget = MAX_SECTION_LINES;
  let chars = 0;
  let cut = false;

  for (const item of value) {
    if (out.length >= MAX_SECTIONS || cut) break;
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const fields = item as Record<string, unknown>;
    const title = text(fields.title).slice(0, MAX_TITLE_CHARS);
    if (title.length === 0) continue;

    const raw = typeof fields.lines === "string" ? fields.lines.split("\n") : Array.isArray(fields.lines) ? fields.lines : [];
    const lines: string[] = [];
    for (const entry of raw) {
      if (typeof entry !== "string") continue;
      if (lines.length >= lineBudget) {
        lines.push("... (section cut)");
        lineBudget = 0;
        break;
      }
      chars += entry.length;
      if (chars > MAX_DETAIL_CHARS) {
        lines.push("... (section cut)");
        cut = true;
        lineBudget = 0;
        break;
      }
      lines.push(entry.replace(/\t/g, "  ").trimEnd());
    }
    lineBudget = Math.max(0, lineBudget - lines.length);

    const section: HudSection = { title, lines };
    const summary = text(fields.summary).slice(0, 120);
    if (summary.length > 0) section.summary = summary;
    if (typeof fields.open === "boolean") section.open = fields.open;
    if (TONES.includes(fields.tone as HudTone)) section.tone = fields.tone as HudTone;
    out.push(section);
    if (lineBudget === 0) break;
  }
  return out;
}

export const isFresh = (card: HudCard, now: number): boolean => now - card.updatedAt <= card.ttlSec * 1000;

/** Fresh cards, worst status first then newest, capped; `stale` counts the hidden ones. */
export function snapshotOf(cards: readonly HudCard[], now: number): HudSnapshot {
  const fresh = cards.filter((card) => isFresh(card, now));
  const sorted = [...fresh].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.updatedAt - a.updatedAt);
  return { at: now, cards: sorted.slice(0, MAX_CARDS), stale: cards.length - fresh.length };
}

export function age(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}

/**
 * Cards that moved into ok, warn or error since the previous snapshot: these toast.
 * A source seen for the first time never toasts, so a reload or a pane reopen stays quiet.
 */
export function transitions(previous: ReadonlyMap<string, HudStatus>, cards: readonly HudCard[]): HudCard[] {
  return cards.filter((card) => {
    const before = previous.get(card.source);
    return before !== undefined && before !== card.status && card.status !== "running" && card.status !== "idle";
  });
}

/** Toast severity for a card status. */
export function toastLevel(status: HudStatus): "info" | "warning" | "error" {
  return status === "error" ? "error" : status === "warn" ? "warning" : "info";
}

/** `✓ Title: first line`, the toast body. */
export function toastText(card: HudCard): string {
  const first = card.lines[0];
  return `${STATUS_GLYPH[card.status]} ${card.title}${first ? `: ${first}` : ""}`;
}

/** Match `/hud <query>`: exact source, then source prefix, then substring of source or title. */
export function findCard(cards: readonly HudCard[], query: string): HudCard | undefined {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return undefined;
  return (
    cards.find((card) => card.source.toLowerCase() === q) ??
    cards.find((card) => card.source.toLowerCase().startsWith(q)) ??
    cards.find((card) => card.source.toLowerCase().includes(q) || card.title.toLowerCase().includes(q))
  );
}

/** One plain line per card for `/hud` with no argument. */
export function listLines(snapshot: HudSnapshot): string[] {
  if (snapshot.cards.length === 0) return ["hud: no cards (hud set <source> --status running)"];
  const rows = snapshot.cards.map((card) => {
    const progress = card.progress === null ? "" : ` ${Math.round(card.progress)}%`;
    const first = card.lines[0] ? ` · ${card.lines[0]}` : "";
    return `${STATUS_GLYPH[card.status]} ${card.source}  ${card.title}${progress} (${age(snapshot.at - card.updatedAt)})${first}`;
  });
  if (snapshot.stale > 0) rows.push(`${snapshot.stale} stale card${snapshot.stale === 1 ? "" : "s"} hidden`);
  return rows;
}

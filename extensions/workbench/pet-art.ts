/**
 * Per-theme 8x4 half-block pixel badges, ported from the Claude Code mod's `pet-art.ts`: a Star Wars
 * TIE, a Barca shield, and a Marvel infinity stone that cycles by variant. Each badge is two text rows
 * of eight cells; every cell packs two pixel rows into one half-block glyph.
 */
import type { PetTheme } from "./verbs.ts";

export type ArtTheme = Exclude<PetTheme, "auto">;

export interface IconCell {
  glyph: string;
  fg: string | null;
  bg: string | null;
}

export const THEME_LABEL: Record<ArtTheme, string> = {
  starwars: "Star Wars",
  marvel: "Marvel",
  barca: "Barca",
};

export const STONES = [
  { name: "Power", palette: { P: "#9B59B6", L: "#D7BDE2", V: "#6C3483" } },
  { name: "Space", palette: { P: "#2E86DE", L: "#AED6F1", V: "#1B4F72" } },
  { name: "Reality", palette: { P: "#C0392B", L: "#F5B7B1", V: "#7B241C" } },
  { name: "Soul", palette: { P: "#E67E22", L: "#FAD7A0", V: "#935116" } },
  { name: "Time", palette: { P: "#27AE60", L: "#A9DFBF", V: "#196F3D" } },
  { name: "Mind", palette: { P: "#F1C40F", L: "#FCF3CF", V: "#9A7D0A" } },
] as const;

interface Art {
  rows: readonly string[];
  palette: Record<string, string>;
}

const ART: Record<ArtTheme, Art> = {
  starwars: {
    rows: ["G......G", "GGDWWDGG", "GGDWWDGG", "G......G"],
    palette: { G: "#F5C518", D: "#B8860B", W: "#FFF3B0" },
  },
  barca: {
    rows: ["BBRRBBRR", "BBRRBBRR", ".BRRBBR.", "..RRBB.."],
    palette: { B: "#004D98", R: "#A50044" },
  },
  marvel: {
    rows: ["..PPPP..", ".PLPPPV.", ".PPPPVV.", "..PVVV.."],
    palette: STONES[0].palette,
  },
};

function cellOf(top: string | null, bottom: string | null): IconCell {
  if (top !== null && bottom !== null) return { glyph: "▀", fg: top, bg: bottom };
  if (top !== null) return { glyph: "▀", fg: top, bg: null };
  if (bottom !== null) return { glyph: "▄", fg: bottom, bg: null };
  return { glyph: " ", fg: null, bg: null };
}

export function stoneAt(variant: number): (typeof STONES)[number] {
  return STONES[((Math.trunc(variant) % STONES.length) + STONES.length) % STONES.length] ?? STONES[0];
}

/** Two text rows of eight cells; empty for a null theme. `variant` picks the Marvel stone. */
export function iconRows(theme: ArtTheme | null, variant = 0): IconCell[][] {
  if (theme === null) return [];
  const base = ART[theme];
  const art: Art = theme === "marvel" ? { ...base, palette: stoneAt(variant).palette } : base;
  const colorAt = (row: string, column: number): string | null => art.palette[row[column] ?? "."] ?? null;
  const textRow = (top: string, bottom: string): IconCell[] =>
    Array.from({ length: 8 }, (_, column) => cellOf(colorAt(top, column), colorAt(bottom, column)));
  return [textRow(art.rows[0] ?? "", art.rows[1] ?? ""), textRow(art.rows[2] ?? "", art.rows[3] ?? "")];
}

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** A row of cells as one truecolor ANSI string, reset at the end. */
export function ansiRow(cells: readonly IconCell[]): string {
  return (
    cells
      .map((cell) => {
        if (cell.fg === null && cell.bg === null) return cell.glyph;
        const fg = cell.fg === null ? "" : `\x1b[38;2;${rgb(cell.fg).join(";")}m`;
        const bg = cell.bg === null ? "" : `\x1b[48;2;${rgb(cell.bg).join(";")}m`;
        return `${fg}${bg}${cell.glyph}\x1b[0m`;
      })
      .join("")
  );
}

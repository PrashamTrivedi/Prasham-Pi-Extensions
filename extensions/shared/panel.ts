/**
 * panel — the shared visual language for the workbench cockpit and the duck
 * overlay: a rounded, background-filled frame whose every returned line is
 * exactly `width` visible columns.
 *
 * Pure string composition with no state. `PanelTheme` is a structural subset of
 * Pi's `Theme`, so production passes the real theme and tests pass a no-op.
 */
import type { ThemeBg, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/** The `fg`/`bg` surface used here; Pi's `Theme` satisfies it structurally. */
export interface PanelTheme {
  fg(color: ThemeColor, text: string): string;
  bg(color: ThemeBg, text: string): string;
}

/** Neutral panel background; defined by both built-in dark and light themes. */
export const PANEL_BG: ThemeBg = "toolPendingBg";

export interface PanelView {
  title: string;
  /** Right-aligned, muted title-bar label. */
  right?: string;
  /** Body rows; wrapped to the inner width before windowing. */
  body: string[];
  /** Dim hint row rendered after a separator. */
  footer?: string;
  /** Body viewport start (clamped). */
  offset?: number;
  /** Body viewport height. When set, the frame keeps this height (padded). */
  limit?: number;
}

export interface PanelLayout {
  lines: string[];
  /** Clamped offset actually used. */
  offset: number;
  limit: number;
  total: number;
}

/** Inner content width for an overall `width`. */
export function panelInnerWidth(width: number): number {
  return Math.max(1, width - 2);
}

/** Pad/truncate plain or ANSI text to exactly `inner` visible columns. */
function fit(text: string, inner: number): string {
  const clipped = truncateToWidth(text, inner, "…", true);
  const padding = Math.max(0, inner - visibleWidth(clipped));
  return clipped + " ".repeat(padding);
}

function borderTop(theme: PanelTheme, width: number, title: string, right?: string): string {
  const inner = panelInnerWidth(width);
  const titleText = ` ${title} `;
  const rightText = right ? ` ${right} ` : "";
  let titleWidth = visibleWidth(titleText);
  let rightWidth = visibleWidth(rightText);

  // Keep at least one rule character on each side of the title.
  if (titleWidth + rightWidth + 2 > inner) {
    rightWidth = 0;
    titleWidth = Math.min(titleWidth, Math.max(0, inner - 2));
  }
  const middle = Math.max(0, inner - 2 - titleWidth - rightWidth);
  const titleSeg = truncateToWidth(titleText, titleWidth, "", false);
  const rightSeg = rightWidth > 0 ? truncateToWidth(rightText, rightWidth, "", false) : "";
  const content =
    theme.fg("borderAccent", "─") +
    theme.fg("accent", titleSeg + " ".repeat(Math.max(0, titleWidth - visibleWidth(titleSeg)))) +
    theme.fg("borderAccent", "─".repeat(middle)) +
    (rightSeg.length > 0 ? theme.fg("muted", rightSeg) : "") +
    theme.fg("borderAccent", "─");
  return theme.fg("borderAccent", "╭") + content + theme.fg("borderAccent", "╮");
}

/** One background-filled inner row: `│ content │`. */
function frameRow(theme: PanelTheme, width: number, content: string): string {
  const inner = panelInnerWidth(width);
  const body = theme.bg(PANEL_BG, fit(` ${content}`, inner));
  return theme.fg("borderMuted", "│") + body + theme.fg("borderMuted", "│");
}

function borderRule(theme: PanelTheme, width: number): string {
  const inner = panelInnerWidth(width);
  return theme.fg("borderMuted", `├${"─".repeat(inner)}┤`);
}

function borderBottom(theme: PanelTheme, width: number): string {
  const inner = panelInnerWidth(width);
  return theme.fg("borderMuted", `╰${"─".repeat(inner)}╯`);
}

/** Compose a bordered panel; every line is exactly `width` visible columns. */
export function renderPanel(theme: PanelTheme, width: number, view: PanelView): PanelLayout {
  const inner = panelInnerWidth(width);
  const bodyRows = view.body.flatMap((row) => wrapTextWithAnsi(row, inner));
  const total = bodyRows.length;
  const limit = view.limit === undefined ? total : Math.max(0, view.limit);
  const maxOffset = Math.max(0, total - limit);
  const offset = Math.min(Math.max(0, view.offset ?? 0), maxOffset);
  const window = bodyRows.slice(offset, offset + limit);
  if (view.limit !== undefined) {
    while (window.length < limit) window.push("");
  }

  const lines: string[] = [borderTop(theme, width, view.title, view.right)];
  for (const row of window) lines.push(frameRow(theme, width, row));
  if (view.footer !== undefined) {
    lines.push(borderRule(theme, width));
    const footerRows = wrapTextWithAnsi(view.footer, inner);
    const shown = view.limit === undefined ? footerRows : footerRows.slice(0, limit);
    for (const row of shown) lines.push(frameRow(theme, width, theme.fg("dim", row)));
  }
  lines.push(borderBottom(theme, width));
  return { lines, offset, limit, total };
}

/** A pressure-colored progress meter, e.g. `████████░░░░░░░░ 62%`. */
export function meter(theme: PanelTheme, percent: number | null, cells: number): string {
  const count = Math.max(1, cells);
  if (percent === null || !Number.isFinite(percent)) {
    return theme.fg("dim", "░".repeat(count)) + " " + theme.fg("muted", "?");
  }
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.round((clamped / 100) * count);
  const color: ThemeColor = clamped < 50 ? "success" : clamped < 80 ? "warning" : "error";
  return (
    theme.fg(color, "█".repeat(filled)) +
    theme.fg("dim", "░".repeat(count - filled)) +
    " " +
    theme.fg("muted", `${Math.round(clamped)}%`)
  );
}

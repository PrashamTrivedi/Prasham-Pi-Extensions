/**
 * Layout policy for the BTW side panel.
 *
 * Pi has no split-pane API, so every BTW view is an overlay: a right-docked panel
 * on wide terminals, and a centered full-width overlay on narrow ones. The main
 * chat is still drawn underneath at full width.
 *
 * The narrow view must stay an overlay. Pi places a non-overlay custom component
 * in the editor slot of its layout, so a tall "full-window" component gets clipped
 * and, worse, the fullscreen transcript viewport consumes PageUp/PageDown before
 * the component sees them (the chat scrolls behind the screen). An overlay keeps
 * keyboard focus, so its own scroll keys always win.
 */
import type { OverlayOptions } from "@earendil-works/pi-tui";

/** Below this width the 45% overlay would be too narrow to frame and type in. */
export const BTW_OVERLAY_MIN_COLUMNS = 100;

/** The docked panel's fixed width. */
export const BTW_OVERLAY_WIDTH = "45%";

/** Overlay geometry; `minWidth` keeps the frame usable on a 100-column terminal. */
export const BTW_OVERLAY_OPTIONS: OverlayOptions = {
  anchor: "right-center",
  width: BTW_OVERLAY_WIDTH,
  minWidth: 44,
  maxHeight: "80%",
  margin: 1,
};

/** Narrow terminals get a centered, full-width overlay instead of the docked panel. */
export const BTW_NARROW_OVERLAY_OPTIONS: OverlayOptions = {
  anchor: "center",
  width: "100%",
  maxHeight: "90%",
  // No gutter: the narrow view draws the whole width, so a margin would leave a
  // one-column strip of the chat visible on each side.
  margin: 0,
};

export type BtwMode = "panel" | "full";

/** Panel at ≥100 columns and a usable height; centered full-width overlay otherwise. */
export function btwMode(columns: number, rows = 24): BtwMode {
  return Number.isFinite(columns) && columns >= BTW_OVERLAY_MIN_COLUMNS && Number.isFinite(rows) && rows >= 12
    ? "panel"
    : "full";
}

/** Overlay geometry for the chosen mode. */
export function btwOverlayOptions(mode: BtwMode): OverlayOptions {
  return mode === "panel" ? BTW_OVERLAY_OPTIONS : BTW_NARROW_OVERLAY_OPTIONS;
}

/** Pi's terminal uses `process.stdout.columns || COLUMNS || 80`; mirror that. */
export function terminalColumns(columns?: number, env: NodeJS.ProcessEnv = process.env): number {
  const value = columns ?? Number(env.COLUMNS) ?? 80;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 80;
}

/** Rows mirror `process.stdout.rows || LINES || 24`. */
export function terminalRows(rows?: number, env: NodeJS.ProcessEnv = process.env): number {
  const value = rows ?? Number(env.LINES) ?? 24;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 24;
}

/**
 * Rows the panel should render. The overlay's `maxHeight: "80%"` slices returned
 * lines from the bottom, so stay two rows under it and never drop the editor.
 */
export function panelHeight(rows: number): number {
  const safe = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 24;
  return Math.max(8, Math.floor(safe * 0.8) - 2);
}

/**
 * Rows the narrow overlay renders: two rows under its 90% `maxHeight` so the
 * overlay never slices the footer, and never below the renderer's 8-row minimum.
 */
export function narrowHeight(rows: number): number {
  const safe = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 24;
  const insideMargin = Math.max(6, safe - 2);
  return Math.min(insideMargin, Math.max(8, Math.floor(safe * 0.9) - 2));
}

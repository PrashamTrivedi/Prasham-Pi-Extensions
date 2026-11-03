/**
 * Layout policy for the BTW side panel.
 *
 * Pi has no split-pane API, so the "side" view is an overlay docked to the right.
 * The main chat is still drawn underneath at full width; the overlay covers its
 * right side rather than reflowing it. Narrow terminals fall back to the original
 * full-window screen.
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

export type BtwMode = "panel" | "full";

/** Panel at ≥100 columns and a usable height; full-window fallback otherwise. */
export function btwMode(columns: number, rows = 24): BtwMode {
  return Number.isFinite(columns) && columns >= BTW_OVERLAY_MIN_COLUMNS && Number.isFinite(rows) && rows >= 12
    ? "panel"
    : "full";
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

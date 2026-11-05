/**
 * The Fabric peek panel (a spike, off by default).
 *
 * A right-docked, `nonCapturing` overlay: the selected run's live tail stays
 * visible while typing continues in the main chat. It reuses the BTW overlay
 * geometry, the shared panel frame, and `TranscriptPane`'s follow logic, so it
 * behaves like the full-window viewer without taking the window.
 */
import type { OverlayOptions } from "@earendil-works/pi-tui";
import { BTW_OVERLAY_OPTIONS, panelHeight } from "../btw/layout.ts";
import { renderPanel } from "../shared/panel.ts";
import type { PanelTheme } from "../shared/panel.ts";

/** Narrower than BTW: it is a tail, not a conversation. `nonCapturing` keeps focus in the editor. */
export const PEEK_OVERLAY_OPTIONS: OverlayOptions = {
  ...BTW_OVERLAY_OPTIONS,
  width: "38%",
  minWidth: 36,
  nonCapturing: true,
};

/** Panel height for a terminal: two rows under the overlay's 80% cap. */
export function peekHeight(rows: number): number {
  return panelHeight(rows);
}

/** The shortcut that opens and closes the panel. */
export const PEEK_KEYS = "ctrl+alt+f toggle";

/**
 * What to peek at: a working agent first (newest start), then a waiting one, then
 * the newest failure, then the newest finished run. Undefined when nothing is live.
 */
export function peekTarget<T extends { status: string; startedAt?: string; finishedAt?: string }>(agents: readonly T[]): T | undefined {
  const statusRank = (status: string): number =>
    status === "running" ? 0 : status === "waiting" || status === "queued" ? 1 : status === "error" ? 2 : 3;
  const recency = (agent: T): number => Date.parse(agent.startedAt ?? agent.finishedAt ?? "") || 0;
  return [...agents].sort((left, right) => statusRank(left.status) - statusRank(right.status) || recency(right) - recency(left))[0];
}

export interface PeekPanelView {
  label: string;
  status: string;
  /** Already-wrapped body rows from a `TranscriptPane`. */
  rows: readonly string[];
}

/** Exactly `height` framed lines with a fixed footer, for the overlay. */
export function renderPeekPanel(view: PeekPanelView, theme: PanelTheme, width: number, height: number): string[] {
  const rows = Math.max(1, Math.floor(height) - 4);
  const body = [...view.rows].slice(0, rows);
  while (body.length < rows) body.push("");
  return renderPanel(theme, width, {
    title: `◆ peek · ${view.label}`,
    right: view.status,
    body,
    footer: `live tail · ${PEEK_KEYS}`,
    limit: rows,
  }).lines;
}

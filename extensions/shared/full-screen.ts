/**
 * Full-window custom-screen helpers shared by Fabric and the BTW side chat.
 *
 * Pi keeps its own footer below a custom screen: cwd/branch, context+model, and
 * one status row. Filling the whole terminal scrolls the first rows out of view,
 * so screens size themselves to the rows above the footer and pad/trim to exactly
 * that height.
 *
 * `beginFullScreen` / `endFullScreen` form a process-wide lock. Widgets are laid
 * out beside the interactive area, so an always-on widget (Fabric's agent rows)
 * would clip a full-window screen. Fabric and BTW both hold the lock while their
 * screen is open, and Fabric restores its rows only when the last screen closes.
 */
import { truncateToWidth } from "@earendil-works/pi-tui";

/** Rows Pi reserves for its own footer below the interactive area. */
export const PI_FOOTER_ROWS = 3;

/** Widget key for the Fabric agent rows below the prompt. */
export const FABRIC_AGENTS_WIDGET = "pi-fabric-agents";

let depth = 0;

/** Rows a full-window screen may draw above Pi's footer. */
export function windowHeight(rows: number): number {
  return Math.max(8, rows - PI_FOOTER_ROWS);
}

/** Pads or trims a screen to exactly the window height, so nothing scrolls off. */
export function fitScreen(lines: readonly string[], height: number, width: number): string[] {
  const sized = lines.length >= height
    ? lines.slice(0, height)
    : [...lines, ...Array<string>(height - lines.length).fill("")];
  return sized.map((line) => truncateToWidth(line, width));
}

/** Marks one full-window screen open. */
export function beginFullScreen(): void {
  depth += 1;
}

/** Marks one full-window screen closed; the counter never goes below zero. */
export function endFullScreen(): void {
  depth = Math.max(0, depth - 1);
}

/** True while any extension owns a full-window screen. */
export function fullScreenOpen(): boolean {
  return depth > 0;
}

/** Current lock depth, for tests and diagnostics. */
export function currentScreenDepth(): number {
  return depth;
}

/** Test-only reset so one test cannot leak depth into the next. */
export function resetScreenDepth(): void {
  depth = 0;
}

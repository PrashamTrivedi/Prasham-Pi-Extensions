/**
 * Text hygiene for BTW. Chat text and tool output can contain terminal escape
 * sequences; the side window must not let them repaint the terminal, and the
 * nested prompt should not carry them either.
 */

const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const CONTROLS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** Remove ANSI/OSC sequences and control bytes while keeping tabs and newlines. */
export function stripControls(value: string): string {
  return value.replace(OSC, "").replace(CSI, "").replace(/\r\n?/g, "\n").replace(CONTROLS, "");
}

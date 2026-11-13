/**
 * Verdict toasts — pure part. A tool call blocked by `sandbox-dev` (decision-server gate / "denied by
 * you") or by a jev hook reaches the transcript as an errored tool result whose text is the block
 * reason. This module recognizes that shape and builds the pet-voiced toast.
 */
import { DENIAL_TEXT } from "./pet-logic.ts";
import { petLine } from "./pet-lines.ts";

const MAX_REASON = 90;

/** One line, clipped, so a long denial never floods the toast. */
export function shortReason(reason: string, max = MAX_REASON): string {
  const flat = reason.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

/** The block reason when this errored result is a gate's denial, else null. */
export function denialReason(isError: boolean, text: string): string | null {
  if (!isError) return null;
  const trimmed = text.trim();
  return DENIAL_TEXT.test(trimmed) ? trimmed : null;
}

/** `Pip: nope, not that. denied by you` — the pet line plus the reason without its owner prefix. */
export function verdictToast(reason: string, rng: () => number = Math.random): string {
  const detail = shortReason(reason.replace(/^(?:sandbox-dev|jev[\w-]*)\s*:\s*/i, ""));
  return `${petLine("denied", "", rng)} ${detail}`.trim();
}

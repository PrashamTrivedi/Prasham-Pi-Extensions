/**
 * Pet logic that does not touch Pi: real-failure counting, the recent-result ring, the chatty-mood
 * rule and the sign-off text. Ported from the Claude Code mod's `pet-logic.ts`.
 */
import type { PetLineKind } from "./pet-lines.ts";
import { formatDuration } from "./stats.ts";

export interface ToolOutcome {
  isError?: boolean;
  text?: string;
}

/** A hook's own words; a denial is not the pet's failure. Pi gates reply `sandbox-dev: ...` / `jev...`. */
export const DENIAL_TEXT = /^(?:sandbox-dev|jev[\w-]*|blocked)\b/i;

/**
 * An errored result that is not benign. Benign: a gate's denial, or a bash that exited 1 with no output
 * (grep, diff and test finding nothing). Pi renders a nonzero exit as `<output>\n\nCommand exited with
 * code N`, so a bare `Command exited with code 1` (optionally after `(no output)`) is the empty case.
 */
export function isRealFailure(outcome: ToolOutcome): boolean {
  if (outcome.isError !== true) return false;
  const text = (outcome.text ?? "").trim();
  if (DENIAL_TEXT.test(text)) return false;
  return !/^(?:\(no output\)\s*)?(?:Exit code 1|Command exited with code 1)$/.test(text);
}

/** Pushes `isError` into a ring of at most `size` results, newest last. */
export function pushResult(ring: readonly boolean[], isError: boolean, size = 8): boolean[] {
  return [...ring, isError].slice(-size);
}

export const countErrors = (ring: readonly boolean[]): number => ring.filter(Boolean).length;

/** Line kind for the pet's current state; Claude's rules: stuffed >= 80% ctx, sad >= 3 errors. */
export function lineKindFor(percent: number | null, recentErrors: number): PetLineKind {
  if (percent !== null && percent >= 80) return "stuffed";
  if (recentErrors >= 3) return "sad";
  return "happy";
}

export const isChatty = (kind: PetLineKind): boolean => kind === "stuffed" || kind === "nervous" || kind === "sad";

/** Chatty moods speak on every third turn, counted from one. */
export const isThirdTurn = (count: number): boolean => count > 0 && count % 3 === 0;

/** `Pip: Pressed high for 2m14s`-style footer text, without the sign-off choice (caller picks it). */
export function signOffLine(signOff: string, durationMs: number): string {
  return `${signOff} for ${formatDuration(durationMs)}`;
}

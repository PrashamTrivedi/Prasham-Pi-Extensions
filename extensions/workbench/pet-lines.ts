/**
 * Pip's own words, ported from the Claude Code mod's `pet-lines.ts` (same wording). Short lines by
 * mood or event. Kinds that need Claude-only signals (`ramp-up`, `fed`, `busy`, `nervous`) are kept
 * so the lists stay in step, even though Pi does not raise them yet.
 */
export type PetLineKind = "denied" | "fed" | "busy" | "ramp-up" | "stuffed" | "nervous" | "sad" | "happy";

export const LINES: Record<PetLineKind, readonly string[]> = {
  denied: [
    "Pip: that one bounced off the gate.",
    "Pip: nope, not that.",
    "Pip: the gate said no, and it said it politely.",
    "Pip: I checked. The answer is still no.",
    "Pip: blocked. I would argue, but I am small.",
    "Pip: that door is locked and I did not lock it.",
  ],
  fed: [
    "Pip: ahh, much roomier.",
    "Pip: thanks, I can think again.",
    "Pip: that was overdue. I feel lighter.",
    "Pip: compacted. I remember the important bits, I think.",
    "Pip: better. Do not wait this long next time.",
    "Pip: room to breathe. Dangerous, I may get ideas.",
  ],
  busy: [
    "Pip: not while I am busy.",
    "Pip: give me a second.",
    "Pip: mid-turn. Ask again when I stop.",
    "Pip: I cannot eat and work. Ask me after.",
    "Pip: one thing at a time, please.",
    "Pip: the turn is still running. Patience is free.",
  ],
  "ramp-up": [
    "Pip: quota is climbing, going careful.",
    "Pip: getting strict about screenshots.",
    "Pip: the meter is moving. I am pretending not to look.",
    "Pip: we are spending faster than we are earning.",
    "Pip: tightening up. Fewer pictures, more text.",
    "Pip: quota is getting thin and so is my patience.",
  ],
  stuffed: [
    "Pip: too full to think.",
    "Pip: please, a /compact.",
    "Pip: the context is nearly full. I can feel it in my ears.",
    "Pip: I am forgetting things to make room for other things.",
    "Pip: one more file read and I burst.",
    "Pip: full. Not a metaphor, the number is right there.",
  ],
  nervous: [
    "Pip: watching the quota.",
    "Pip: careful now.",
    "Pip: the quota is high and I am keeping both eyes on it.",
    "Pip: I would take the cheap option here.",
    "Pip: every call counts now. I am counting.",
    "Pip: tense. Not panicking, just tense.",
  ],
  sad: [
    "Pip: that was a rough run.",
    "Pip: we keep failing.",
    "Pip: three errors in a row. I noticed.",
    "Pip: the tools are not on our side today.",
    "Pip: maybe read the error before the next attempt.",
    "Pip: I am fine. The build is not.",
  ],
  happy: [
    "Pip: all green.",
    "Pip: nice and steady.",
    "Pip: no errors. I am suspicious but pleased.",
    "Pip: tools are behaving. Enjoy it.",
    "Pip: good run. Quietly proud.",
    "Pip: smooth. Do not touch anything.",
  ],
};

/** A line for `kind` that is not `last` when another exists. `rng` is injectable for tests. */
export function petLine(kind: PetLineKind, last = "", rng: () => number = Math.random): string {
  const all = LINES[kind];
  const pool = all.filter((line) => line !== last);
  const from = pool.length > 0 ? pool : all;
  return from[Math.floor(rng() * from.length)] ?? "";
}

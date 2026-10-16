/** The plan's `Original Ask` section (any heading level), up to the next same-or-higher heading. */
export function extractOutcome(plan: string): string {
  const lines = plan.split(/\r?\n/);
  let start = -1;
  let level = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(lines[index]);
    if (heading && /original ask/i.test(heading[2])) {
      start = index + 1;
      level = heading[1].length;
      break;
    }
  }
  if (start === -1) return "";
  const collected: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const heading = /^(#{1,6})\s+/.exec(lines[index]);
    if (heading && heading[1].length <= level) break;
    collected.push(lines[index]);
  }
  return collected.join("\n").trim();
}

export function anchorMessage(anchor: { outcome: string; budget: number }, turn: number): string {
  return [
    `ANCHORED OUTCOME (unchanged, do not widen): ${anchor.outcome}`,
    `Supervised turn ${turn}/${anchor.budget}.`,
    "Keep working only toward that outcome. When it is satisfied, call dev_outcome_met with raw",
    "transcript-visible evidence (exit codes, test summary lines). If this requires a different",
    "outcome, stop and report that a new plan is needed.",
  ].join("\n");
}

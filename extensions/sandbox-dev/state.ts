import { createHash } from "node:crypto";

/** Persisted by `sandbox-dev-approval`; approval and outcome anchoring are one event. */
export interface ApprovalRecord {
  task: string;
  planHash: string;
  outcome: string;
  budget: number;
  approvedAt: number;
}

export interface OutcomeRecord {
  task: string;
  met: boolean;
  evidence: string;
  at: number;
}

/** Keyed by content, so editing the plan invalidates its approval. */
export function hashPlan(plan: string): string {
  return createHash("sha256").update(plan).digest("hex").slice(0, 16);
}

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

export function isApprovalRecord(value: unknown): value is ApprovalRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ApprovalRecord>;
  return (
    typeof record.task === "string" &&
    typeof record.planHash === "string" &&
    typeof record.outcome === "string" &&
    typeof record.budget === "number" &&
    typeof record.approvedAt === "number"
  );
}

function isCustomEntry(entry: unknown, customType: string): boolean {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as { type?: unknown; customType?: unknown };
  return candidate.type === "custom" && candidate.customType === customType;
}

/** Latest approval in a session branch, or undefined. Tolerates unknown entry shapes. */
export function findLatestApproval(entries: readonly unknown[]): ApprovalRecord | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as { data?: unknown };
    if (isCustomEntry(entries[index], "sandbox-dev-approval") && isApprovalRecord(entry.data)) {
      return entry.data;
    }
  }
  return undefined;
}

/** True when a `sandbox-dev-outcome` entry with `met: true` exists for the task. */
export function isOutcomeMet(entries: readonly unknown[], task: string): boolean {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (!isCustomEntry(entries[index], "sandbox-dev-outcome")) continue;
    const data = (entries[index] as { data?: unknown }).data as Partial<OutcomeRecord> | undefined;
    if (data && data.task === task && data.met === true) return true;
  }
  return false;
}

/** How many anchor continuation messages have been injected, to restore the turn count after reload. */
export function countAnchorContinuations(entries: readonly unknown[]): number {
  let count = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { type?: unknown; customType?: unknown };
    if (candidate.type === "custom_message" && candidate.customType === "sandbox-dev-anchor") count += 1;
  }
  return count;
}

export function anchorMessage(approval: ApprovalRecord, turn: number): string {
  return [
    `ANCHORED OUTCOME (unchanged, do not widen): ${approval.outcome}`,
    `Supervised turn ${turn}/${approval.budget}.`,
    "Keep working only toward that outcome. When it is satisfied, call dev_outcome_met with raw",
    "transcript-visible evidence (exit codes, test summary lines). If this requires a different",
    "outcome, stop and report that a new plan is needed.",
  ].join("\n");
}

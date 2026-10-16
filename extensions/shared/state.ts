/**
 * Branch-scoped extension state.
 *
 * Callers must pass the entries of the *active* branch only (Pi's
 * `ctx.sessionManager.getBranch()`); this never reads the session file, so
 * abandoned sibling history is not resurrected. State kept here is persisted via
 * `pi.appendEntry` and stays out of model context.
 */

export interface SessionEntryLike {
  type?: string;
  customType?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface BranchState {
  /** Latest `data` seen per custom entry type, in branch order. */
  latest: Record<string, unknown>;
  /** Custom entries on the active branch, in order. */
  entries: SessionEntryLike[];
  /** How many custom entries of each type the branch holds. */
  counts: Record<string, number>;
}

function isEntry(value: unknown): value is SessionEntryLike {
  return typeof value === "object" && value !== null;
}

/** Reduce active-branch entries into latest values and counts, tolerating junk. */
export function stateFromBranch(entries?: readonly unknown[] | null): BranchState {
  const state: BranchState = { latest: {}, entries: [], counts: {} };
  if (!Array.isArray(entries)) return state;
  for (const raw of entries) {
    if (!isEntry(raw)) continue;
    const customType = raw.customType;
    if (typeof customType !== "string" || customType.length === 0) continue;
    state.entries.push(raw);
    state.latest[customType] = raw.data;
    state.counts[customType] = (state.counts[customType] ?? 0) + 1;
  }
  return state;
}

/** Typed accessor for the latest value of one custom entry type. */
export function latestByType<T>(state: BranchState, customType: string): T | undefined {
  return state.latest[customType] as T | undefined;
}

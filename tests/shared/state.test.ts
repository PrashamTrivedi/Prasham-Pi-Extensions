import { describe, expect, test } from "bun:test";
import { latestByType, stateFromBranch } from "../../extensions/shared/state.ts";

describe("stateFromBranch", () => {
  test("keeps the latest value per custom type and counts entries", () => {
    const entries = [
      { type: "custom", customType: "pet", data: { theme: "auto" } },
      null,
      "junk",
      { type: "custom", customType: "pet", data: { theme: "starwars" } },
      { type: "custom", customType: "usage", data: { count: 1 } },
    ];
    const state = stateFromBranch(entries);
    expect(latestByType<{ theme: string }>(state, "pet")).toEqual({ theme: "starwars" });
    expect(state.counts.pet).toBe(2);
    expect(state.counts.usage).toBe(1);
    expect(state.entries).toHaveLength(3);
  });

  test("tolerates a missing or non-array branch", () => {
    expect(stateFromBranch(undefined).entries).toEqual([]);
    expect(stateFromBranch(null).latest).toEqual({});
  });

  test("entries without a string customType are ignored", () => {
    const state = stateFromBranch([{ type: "custom", data: 1 }, { customType: "", data: 2 }]);
    expect(state.entries).toEqual([]);
  });
});

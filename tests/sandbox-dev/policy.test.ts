import { describe, expect, test } from "bun:test";
import { BUDGET } from "../../extensions/sandbox-dev/policy.ts";

describe("BUDGET", () => {
  test("supervises eight continuation turns", () => {
    expect(BUDGET).toBe(8);
  });
});

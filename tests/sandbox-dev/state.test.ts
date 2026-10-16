import { describe, expect, test } from "bun:test";
import { anchorMessage, extractOutcome } from "../../extensions/sandbox-dev/state.ts";

const plan = [
  "# Task: add widget",
  "",
  "## Original Ask",
  "Add a widget that renders the current turn count.",
  "",
  "- must be visible in the footer",
  "",
  "## Complexity",
  "Score 3",
].join("\n");

describe("extractOutcome", () => {
  test("captures the Original Ask section only", () => {
    const outcome = extractOutcome(plan);
    expect(outcome).toContain("Add a widget");
    expect(outcome).toContain("visible in the footer");
    expect(outcome).not.toContain("Complexity");
  });
  test("returns empty when absent", () => {
    expect(extractOutcome("# No plan\nbody")).toBe("");
  });
});

describe("anchorMessage", () => {
  test("restates the outcome and budget", () => {
    const message = anchorMessage({ outcome: extractOutcome(plan), budget: 8 }, 2);
    expect(message).toContain("Add a widget");
    expect(message).toContain("2/8");
    expect(message).toContain("dev_outcome_met");
  });
});

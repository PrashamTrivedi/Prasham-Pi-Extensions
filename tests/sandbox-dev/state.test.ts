import { describe, expect, test } from "bun:test";
import {
  anchorMessage,
  countAnchorContinuations,
  extractOutcome,
  findLatestApproval,
  hashPlan,
  isOutcomeMet,
  type ApprovalRecord,
} from "../../extensions/sandbox-dev/state.ts";

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

const record: ApprovalRecord = {
  task: "add-widget",
  planHash: hashPlan(plan),
  outcome: extractOutcome(plan),
  budget: 8,
  approvedAt: 1,
};

describe("hashPlan", () => {
  test("is stable and content-addressed", () => {
    expect(hashPlan(plan)).toBe(hashPlan(plan));
    expect(hashPlan(plan)).not.toBe(hashPlan(`${plan} `));
  });
});

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

describe("session entry helpers", () => {
  const approvalEntry = { type: "custom", customType: "sandbox-dev-approval", data: record };
  const otherEntry = { type: "custom", customType: "other", data: { task: "x" } };
  const outcomeEntry = { type: "custom", customType: "sandbox-dev-outcome", data: { task: "add-widget", met: true, evidence: "exit 0", at: 2 } };
  const anchorEntry = { type: "custom_message", customType: "sandbox-dev-anchor", content: "x", display: true };

  test("findLatestApproval tolerates junk and returns the last approval", () => {
    expect(findLatestApproval([otherEntry, null, "junk"])).toBeUndefined();
    expect(findLatestApproval([approvalEntry, otherEntry])?.task).toBe("add-widget");
  });

  test("isOutcomeMet is task-scoped", () => {
    expect(isOutcomeMet([outcomeEntry], "add-widget")).toBe(true);
    expect(isOutcomeMet([outcomeEntry], "other")).toBe(false);
    expect(isOutcomeMet([{ type: "custom", customType: "sandbox-dev-outcome", data: { task: "add-widget", met: false } }], "add-widget")).toBe(false);
  });

  test("countAnchorContinuations counts only anchor messages", () => {
    expect(countAnchorContinuations([anchorEntry, otherEntry, anchorEntry])).toBe(2);
  });
});

describe("anchorMessage", () => {
  test("restates the outcome and budget", () => {
    const message = anchorMessage(record, 2);
    expect(message).toContain(record.outcome);
    expect(message).toContain("2/8");
    expect(message).toContain("dev_outcome_met");
  });
});

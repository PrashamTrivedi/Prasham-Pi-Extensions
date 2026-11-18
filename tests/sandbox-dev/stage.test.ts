import { describe, expect, test } from "bun:test";
import {
  MAX_STAGE_FAILURES,
  applyWaivers,
  bumpFailure,
  completeGoal,
  criterionQuestions,
  criterionScores,
  detectMode,
  extractCriteria,
  goalMessage,
  isOneLineConventionalCommit,
  parseGateReply,
  requiredArtifacts,
  terminalReviewLine,
  verificationBlock,
  workGoal,
} from "../../extensions/sandbox-dev/stage.ts";

describe("parseGateReply", () => {
  test("bare g approves, with or without whitespace", () => {
    expect(parseGateReply("g")).toEqual({ approve: true });
    expect(parseGateReply("  G  ")).toEqual({ approve: true });
    expect(parseGateReply("\n g \n")).toEqual({ approve: true });
  });

  test("g: note approves and keeps the note", () => {
    expect(parseGateReply("g: prefer tests first")).toEqual({ approve: true, note: "prefer tests first" });
    expect(parseGateReply("g : note")).toEqual({ approve: true, note: "note" });
    expect(parseGateReply("g:\nline one")).toEqual({ approve: true, note: "line one" });
  });

  test("t:, r, and other text leave the gate closed", () => {
    expect(parseGateReply("t: change the scope")).toEqual({ approve: false });
    expect(parseGateReply("r")).toEqual({ approve: false });
    expect(parseGateReply("go ahead")).toEqual({ approve: false });
    expect(parseGateReply("")).toEqual({ approve: false });
  });
});

describe("goal templates", () => {
  test("the work goal names the plan, the stage switch, and the ask verbatim", () => {
    const goal = workGoal({ task: "add-widget", outcome: "Add a turn-count widget." });
    expect(goal).toContain("taskNotes/add-widget/taskFindings.md");
    expect(goal).toContain('dev_stage { "to": "complete" }');
    expect(goal).toContain("# Task\nAdd a turn-count widget.");
    expect(goal).not.toContain("## Human note");
  });

  test("the human note is appended only when present", () => {
    const goal = workGoal({ task: "add-widget", outcome: "Add a widget.", note: "Keep the footer height." });
    expect(goal).toContain("## Human note\nKeep the footer height.");
  });

  const complete = (mode: "backend" | "frontend" | "both") =>
    completeGoal({
      task: "add-widget",
      outcome: "Add a widget.",
      completeWorkPath: "/repo/commands/completeWork.md",
      mode,
    });

  test("the complete goal names the procedure and the always-required files", () => {
    const goal = complete("backend");
    expect(goal).toContain("/repo/commands/completeWork.md");
    for (const file of ["taskWalkthrough.md", "review-passes.md", "currentCommitHash"]) {
      expect(goal).toContain(`taskNotes/add-widget/${file}`);
    }
    expect(goal).toContain("taskNotes/add-widget/backend-validation.md");
    expect(goal).not.toContain("frontend-validation.md");
  });

  test("the files list follows the work mode", () => {
    expect(complete("frontend")).toContain("frontend-validation.md");
    expect(complete("frontend")).not.toContain("backend-validation.md");
    expect(complete("both")).toContain("backend-validation.md");
    expect(complete("both")).toContain("frontend-validation.md");
  });
});

describe("detectMode", () => {
  test("explicit work mode wins, human note first", () => {
    expect(detectMode("# Plan\n\nwork mode: frontend\n")).toBe("frontend");
    expect(detectMode("mode = both")).toBe("both");
    expect(detectMode("work mode: backend", "mode: frontend")).toBe("frontend");
  });

  test("defaults to backend", () => {
    expect(detectMode("# Plan\n\nNothing here.")).toBe("backend");
    expect(detectMode("", "")).toBe("backend");
  });
});

describe("requiredArtifacts", () => {
  test("lists the mode-dependent validation artifact", () => {
    expect(requiredArtifacts("backend")).toEqual(["taskWalkthrough.md", "review-passes.md", "currentCommitHash", "backend-validation.md"]);
    expect(requiredArtifacts("frontend")).toContain("frontend-validation.md");
    expect(requiredArtifacts("both")).toEqual([
      "taskWalkthrough.md",
      "review-passes.md",
      "currentCommitHash",
      "backend-validation.md",
      "frontend-validation.md",
    ]);
  });
});

describe("isOneLineConventionalCommit", () => {
  test("accepts emoji + type + subject", () => {
    expect(isOneLineConventionalCommit("✨ feat: Add the widget")).toBe(true);
    expect(isOneLineConventionalCommit("🐛 fix: Stop the crash")).toBe(true);
    expect(isOneLineConventionalCommit("🧑‍💻 chore: Bump the toolchain")).toBe(true);
    expect(isOneLineConventionalCommit("  ✅ test: Cover the widget  \n")).toBe(true);
  });

  test("rejects a body, a missing emoji, and an unknown type", () => {
    expect(isOneLineConventionalCommit("✨ feat: Add the widget\n\nWith a body.")).toBe(false);
    expect(isOneLineConventionalCommit("feat: Add the widget")).toBe(false);
    expect(isOneLineConventionalCommit("✨ nope: Add the widget")).toBe(false);
    expect(isOneLineConventionalCommit("")).toBe(false);
  });
});

describe("terminalReviewLine", () => {
  test("accepts the three terminal lines as the last non-empty line", () => {
    expect(terminalReviewLine("Pass 1: 4 findings\nPass 2: 0 findings")).toBe("0 findings");
    expect(terminalReviewLine("- Pass 5: cap (5 passes)")).toBe("cap (5 passes)");
    expect(terminalReviewLine("Pass 3: 0 findings")).toBe("0 findings");
    expect(terminalReviewLine("`escalated`")).toBe("escalated");
  });

  test("rejects a missing or non-terminal line", () => {
    expect(terminalReviewLine("Pass 1: 4 findings")).toBeNull();
    expect(terminalReviewLine("")).toBeNull();
    expect(terminalReviewLine("0 findings\nPass 3: 1 finding")).toBeNull();
  });
});

describe("waivers and the failure cap", () => {
  test("a waiver needs a matching check and a reason", () => {
    const misses = [
      { check: "pushed", detail: "no upstream" },
      { check: "commit", detail: "bad subject" },
    ];
    expect(applyWaivers(misses, [{ check: "pushed", reason: "local only repo" }])).toEqual({
      remaining: [{ check: "commit", detail: "bad subject" }],
      waived: [{ check: "pushed", reason: "local only repo" }],
    });
    expect(applyWaivers(misses, [{ check: "pushed", reason: "   " }]).remaining).toHaveLength(2);
    expect(applyWaivers(misses, [{ check: "other", reason: "nope" }]).remaining).toHaveLength(2);
  });

  test("the third consecutive failure escalates", () => {
    expect(bumpFailure(0)).toEqual({ failures: 1, escalate: false });
    expect(bumpFailure(1)).toEqual({ failures: 2, escalate: false });
    expect(bumpFailure(2)).toEqual({ failures: 3, escalate: true });
    expect(MAX_STAGE_FAILURES).toBe(3);
  });
});

describe("criteria", () => {
  const plan = [
    "## Acceptance Criteria",
    "- [ ] AC1 first",
    "1. AC2 second",
    "2. AC3 third",
    "",
    "## Validation",
    "not a criterion",
  ].join("\n");

  test("extracts checklist and numbered items only", () => {
    expect(extractCriteria(plan)).toEqual(["AC1 first", "AC2 second", "AC3 third"]);
    expect(extractCriteria("# Plan\n\nNo section")).toEqual([]);
  });

  test("caps the questions and maps answers back to criteria", () => {
    const many = Array.from({ length: 12 }, (_, index) => `- criterion ${index + 1}`);
    const criteria = extractCriteria(["## Acceptance Criteria", ...many].join("\n"));
    expect(criteria).toHaveLength(8);
    const questions = criterionQuestions(criteria);
    expect(Object.keys(questions)).toHaveLength(8);
    expect(questions.criterion_1.instructions).toContain("criterion 1");

    const scores = criterionScores(criteria, {
      criterion_1: { noul: 0.9 },
      criterion_2: { noul: 0.2 },
    });
    expect(scores[0]).toEqual({ criterion: "criterion 1", score: 0.9 });
    expect(scores[1]).toEqual({ criterion: "criterion 2", score: 0.2 });
    expect(scores[7].score).toBe(0);
  });
});

describe("goalMessage and verificationBlock", () => {
  test("the per-turn message carries the goal and the counters", () => {
    const message = goalMessage({ goal: "Do the thing.", stage: "work", turn: 2, budget: 8, failures: 1 });
    expect(message).toContain("LIVE WORK GOAL");
    expect(message).toContain("turn 2/8");
    expect(message).toContain("validator failures 1/3");
    expect(message).toContain("Do the thing.");
    expect(goalMessage({ goal: "Finish.", stage: "complete", turn: 1, budget: 8, failures: 0 })).toContain("LIVE COMPLETE GOAL");
  });

  test("the verification block records criteria, waivers, not-run items and misses", () => {
    const block = verificationBlock({
      criteria: [{ criterion: "AC1", score: 0.93 }],
      misses: [{ check: "pushed", detail: "no upstream" }],
      waived: [{ check: "review-passes", reason: "docs only" }],
      notRun: ["browser check"],
    });
    expect(block).toContain("## Verification (extension)");
    expect(block).toContain("0.93 AC1");
    expect(block).toContain("`review-passes`: docs only");
    expect(block).toContain("- browser check");
    expect(block).toContain("`pushed`: no upstream");
    expect(verificationBlock({ criteria: [], misses: [], waived: [], notRun: [] })).toContain("no acceptance criteria");
  });
});

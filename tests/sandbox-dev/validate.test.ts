import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectFacts,
  deterministicChecks,
  evidenceLines,
  isTestFile,
  pathsOutsideRoot,
  validateComplete,
  validateWork,
} from "../../extensions/sandbox-dev/validate.ts";
import { workGoal, type WorkMode } from "../../extensions/sandbox-dev/stage.ts";
import { cleanup, completeRepo, git, tempRepo } from "./helpers.ts";

const TASK = "add-widget";

function seed(cwd: string, mode: WorkMode = "backend", task = TASK) {
  writeFileSync(join(cwd, "taskNotes", task, "goal.md"), workGoal({ task, outcome: "Add a turn-count widget." }));
  return collectFacts(cwd, task, "", mode);
}

function answersFor(questions: Record<string, unknown>, overrides: Record<string, number> = {}): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(questions).map((id) => [id, { noul: overrides[id] ?? (id === "not_run_matters" ? 0.1 : 0.9) }]),
  );
}

function deps(overrides: Record<string, number> = {}) {
  return {
    askJev: async (_state: unknown, questions: Record<string, unknown>) => ({ answers: answersFor(questions, overrides) }),
  };
}

const unreachable = {
  askJev: async () => {
    throw new Error("jev offline");
  },
};

describe("pure path helpers", () => {
  test("isTestFile recognises the common conventions", () => {
    expect(isTestFile("tests/sandbox-dev/stage.test.ts")).toBe(true);
    expect(isTestFile("src/__tests__/app.tsx")).toBe(true);
    expect(isTestFile("src/widget.spec.ts")).toBe(true);
    expect(isTestFile("src/widget.ts")).toBe(false);
  });

  test("pathsOutsideRoot rejects absolute and escaping paths", () => {
    const cwd = "/repo";
    expect(pathsOutsideRoot(cwd, ["src/a.ts", "taskNotes/x/goal.md"])).toEqual([]);
    expect(pathsOutsideRoot(cwd, ["../escape.ts"])).toEqual(["../escape.ts"]);
    expect(pathsOutsideRoot(cwd, ["/etc/passwd"])).toEqual(["/etc/passwd"]);
  });

  test("evidenceLines keeps exit codes and test summaries", () => {
    const text = ["linting...", "typecheck exit 0", "bun test: 42 pass, 0 fail", "npm test -> 0 fail", "noise line"].join("\n");
    const kept = evidenceLines(text);
    expect(kept).toContain("typecheck exit 0");
    expect(kept).toContain("0 fail");
    expect(kept).not.toContain("noise line");
  });
});

describe("deterministic checks", () => {
  test("the work stage only checks the goal and the plan", () => {
    const cwd = tempRepo(TASK);
    try {
      const facts = seed(cwd);
      expect(deterministicChecks({ cwd, task: TASK, stage: "work", mode: "backend", goal: facts.goal, plan: facts.plan })).toEqual([]);
      expect(
        deterministicChecks({ cwd, task: TASK, stage: "work", mode: "backend", goal: "", plan: "" }).map((miss) => miss.check),
      ).toEqual(["plan", "goal"]);
    } finally {
      cleanup(cwd);
    }
  });

  test("a complete repo passes every fs/git check", () => {
    const cwd = completeRepo();
    try {
      const facts = seed(cwd);
      expect(deterministicChecks({ cwd, task: TASK, stage: "complete", mode: "backend", goal: facts.goal, plan: facts.plan })).toEqual([]);
    } finally {
      cleanup(cwd);
    }
  });

  test("facts judge the committed range, not only the working tree", () => {
    const cwd = completeRepo();
    try {
      const facts = seed(cwd);
      expect(facts.diffStat).toContain("tests/widget.test.ts");
    } finally {
      cleanup(cwd);
    }
  });

  test("a missing artifact is a named file miss", () => {
    const cwd = completeRepo();
    try {
      const facts = seed(cwd);
      writeFileSync(join(cwd, "taskNotes", TASK, "backend-validation.md"), "");
      const misses = deterministicChecks({ cwd, task: TASK, stage: "complete", mode: "backend", goal: facts.goal, plan: facts.plan });
      expect(misses.some((miss) => miss.check === "files" && miss.detail.includes("backend-validation.md"))).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });

  test("a review without a terminal line fails", () => {
    const cwd = completeRepo();
    try {
      const facts = seed(cwd);
      writeFileSync(join(cwd, "taskNotes", TASK, "review-passes.md"), "Pass 1: 2 findings\nPass 2: 1 finding\n");
      const misses = deterministicChecks({ cwd, task: TASK, stage: "complete", mode: "backend", goal: facts.goal, plan: facts.plan });
      expect(misses.map((miss) => miss.check)).toContain("review-passes");
    } finally {
      cleanup(cwd);
    }
  });

  test("a commit with a body fails", () => {
    const cwd = completeRepo();
    try {
      const facts = seed(cwd);
      writeFileSync(join(cwd, "notes.txt"), "more\n");
      git(cwd, ["add", "-A"]);
      const body = join(cwd, "commit-body.txt");
      writeFileSync(body, "✨ feat: Add notes\n\nThis body breaks the one-line rule.\n");
      git(cwd, ["commit", "-q", "-F", body]);
      const misses = deterministicChecks({ cwd, task: TASK, stage: "complete", mode: "backend", goal: facts.goal, plan: facts.plan });
      expect(misses.map((miss) => miss.check)).toContain("commit");
    } finally {
      cleanup(cwd);
    }
  });

  test("an unpushed branch fails", () => {
    const cwd = completeRepo({ noPush: true });
    try {
      const facts = seed(cwd);
      const misses = deterministicChecks({ cwd, task: TASK, stage: "complete", mode: "backend", goal: facts.goal, plan: facts.plan });
      expect(misses.some((miss) => miss.check === "pushed")).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });

  test("no test file in currentCommitHash..HEAD fails", () => {
    const cwd = completeRepo();
    try {
      const facts = seed(cwd);
      writeFileSync(join(cwd, "taskNotes", TASK, "currentCommitHash"), `${git(cwd, ["rev-parse", "HEAD"])}\n`);
      const misses = deterministicChecks({ cwd, task: TASK, stage: "complete", mode: "backend", goal: facts.goal, plan: facts.plan });
      expect(misses.map((miss) => miss.check)).toContain("tests-in-diff");
    } finally {
      cleanup(cwd);
    }
  });
});

describe("work validator", () => {
  test("passes when the server says the plan is followed and the work is finished", async () => {
    const cwd = completeRepo();
    try {
      const facts = seed(cwd);
      expect(await validateWork({ cwd, task: TASK, mode: "backend", facts, deps: deps() })).toEqual({ ok: true, misses: [] });
    } finally {
      cleanup(cwd);
    }
  });

  test("names the semantic miss when the work is not finished", async () => {
    const cwd = completeRepo();
    try {
      const facts = seed(cwd);
      const verdict = await validateWork({ cwd, task: TASK, mode: "backend", facts, deps: deps({ work_finished: 0.2 }) });
      expect(verdict.ok).toBe(false);
      expect(verdict.misses.map((miss) => miss.check)).toEqual(["work_finished"]);
    } finally {
      cleanup(cwd);
    }
  });

  test("an unreachable server is a semantics miss, never a pass", async () => {
    const cwd = completeRepo();
    try {
      const facts = seed(cwd);
      const verdict = await validateWork({ cwd, task: TASK, mode: "backend", facts, deps: unreachable });
      expect(verdict.ok).toBe(false);
      expect(verdict.misses[0].check).toBe("semantics");
    } finally {
      cleanup(cwd);
    }
  });
});

describe("complete validator", () => {
  test("passes on the 88-skills-commands-import fixture and returns the criterion map", async () => {
    const cwd = completeRepo({ fixtureTask: "88-skills-commands-import" });
    try {
      const facts = seed(cwd);
      expect(facts.criteria.length).toBe(8);
      const verdict = await validateComplete({ cwd, task: TASK, mode: "backend", stage: "complete", facts, notRun: [], deps: deps() });
      expect(verdict.ok).toBe(true);
      expect(verdict.misses).toEqual([]);
      expect(verdict.criteria).toHaveLength(8);
      expect(verdict.criteria.every((item) => item.score === 0.9)).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });

  test("a criterion below the bar is a named miss", async () => {
    const cwd = completeRepo({ fixtureTask: "88-skills-commands-import" });
    try {
      const facts = seed(cwd);
      const verdict = await validateComplete({
        cwd,
        task: TASK,
        mode: "backend",
        stage: "complete",
        facts,
        notRun: [],
        deps: deps({ criterion_2: 0.2 }),
      });
      expect(verdict.ok).toBe(false);
      expect(verdict.misses.map((miss) => miss.check)).toEqual(["criterion_2"]);
    } finally {
      cleanup(cwd);
    }
  });

  test("not-run items that matter block the outcome", async () => {
    const cwd = completeRepo();
    try {
      const facts = seed(cwd);
      const blocking = await validateComplete({
        cwd,
        task: TASK,
        mode: "backend",
        stage: "complete",
        facts,
        notRun: ["browser check"],
        deps: deps({ not_run_matters: 0.9 }),
      });
      expect(blocking.misses.map((miss) => miss.check)).toContain("not_run");

      const fine = await validateComplete({
        cwd,
        task: TASK,
        mode: "backend",
        stage: "complete",
        facts,
        notRun: ["browser check"],
        deps: deps(),
      });
      expect(fine.misses.map((miss) => miss.check)).not.toContain("not_run");
    } finally {
      cleanup(cwd);
    }
  });

  test("declaring in the work stage is a stage miss", async () => {
    const cwd = completeRepo();
    try {
      const facts = seed(cwd);
      const verdict = await validateComplete({ cwd, task: TASK, mode: "backend", stage: "work", facts, notRun: [], deps: deps() });
      expect(verdict.ok).toBe(false);
      expect(verdict.misses.map((miss) => miss.check)).toContain("stage");
    } finally {
      cleanup(cwd);
    }
  });

  test("a waiver with a reason passes every miss it names", async () => {
    const cwd = completeRepo({ noPush: true });
    try {
      const facts = seed(cwd);
      const blocked = await validateComplete({ cwd, task: TASK, mode: "backend", stage: "complete", facts, notRun: [], deps: deps() });
      expect(blocked.ok).toBe(false);
      expect(blocked.misses.map((miss) => miss.check)).toContain("pushed");

      const waived = await validateComplete({
        cwd,
        task: TASK,
        mode: "backend",
        stage: "complete",
        facts,
        notRun: [],
        waive: [{ check: "pushed", reason: "local scratch repo, remote not configured" }],
        deps: deps(),
      });
      expect(waived.ok).toBe(true);
      expect(waived.waived).toEqual([{ check: "pushed", reason: "local scratch repo, remote not configured" }]);

      const emptyReason = await validateComplete({
        cwd,
        task: TASK,
        mode: "backend",
        stage: "complete",
        facts,
        notRun: [],
        waive: [{ check: "pushed", reason: "  " }],
        deps: deps(),
      });
      expect(emptyReason.ok).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });

  test("the declared evidence is judged together with the transcript", async () => {
    const cwd = completeRepo();
    let seen = "";
    try {
      const facts = seed(cwd);
      const capture = {
        askJev: async (state: unknown, questions: Record<string, unknown>) => {
          seen = (state as { evidence?: string }).evidence ?? "";
          return { answers: answersFor(questions) };
        },
      };
      await validateComplete({
        cwd,
        task: TASK,
        mode: "backend",
        stage: "complete",
        facts,
        evidence: "npm run typecheck exit 0; bun test: 88 pass, 0 fail",
        notRun: [],
        deps: capture,
      });
      expect(seen).toContain("bun test: 88 pass, 0 fail");
    } finally {
      cleanup(cwd);
    }
  });

  test("semantics and stage can never be waived", async () => {
    const cwd = completeRepo();
    try {
      const facts = seed(cwd);
      const stageWaived = await validateComplete({
        cwd,
        task: TASK,
        mode: "backend",
        stage: "work",
        facts,
        notRun: [],
        waive: [{ check: "stage", reason: "skip the work stage" }],
        deps: deps(),
      });
      expect(stageWaived.ok).toBe(false);
      expect(stageWaived.waived).toEqual([]);

      const serverWaived = await validateComplete({
        cwd,
        task: TASK,
        mode: "backend",
        stage: "complete",
        facts,
        notRun: [],
        waive: [{ check: "semantics", reason: "the server is offline" }],
        deps: unreachable,
      });
      expect(serverWaived.ok).toBe(false);
      expect(serverWaived.waived).toEqual([]);
      expect(serverWaived.misses.map((miss) => miss.check)).toContain("semantics");
    } finally {
      cleanup(cwd);
    }
  });

  test("the fixture dry run fails when the review loop has no terminal line", async () => {
    const cwd = completeRepo({ fixtureTask: "88-skills-commands-import" });
    try {
      const facts = seed(cwd);
      writeFileSync(join(cwd, "taskNotes", TASK, "review-passes.md"), "# Review passes\n\n- Pass 4: 1 finding\n");
      const verdict = await validateComplete({ cwd, task: TASK, mode: "backend", stage: "complete", facts, notRun: [], deps: deps() });
      expect(verdict.ok).toBe(false);
      expect(verdict.misses.map((miss) => miss.check)).toContain("review-passes");
    } finally {
      cleanup(cwd);
    }
  });
});

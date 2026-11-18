import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanup,
  completeRepo,
  harness,
  readTaskFile,
  tempRepo,
  type CompleteRepoOptions,
  type HarnessOptions,
} from "./helpers.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

const TASK = "add-widget";

/** Present the gate the way `dev_request_approval` does, with Jev failing closed. */
async function openGate(task = TASK) {
  const cwd = tempRepo(task);
  const instance = harness(cwd, { hasUI: true });
  await instance.hooks.get("session_start")!({}, instance.ctx);
  await instance.tools.get("dev_request_approval").execute("id", { task }, undefined, undefined, instance.ctx);
  return { cwd, instance };
}

/** Present the gate, approve the human way, and return the armed instance. */
async function approved(options: Omit<HarnessOptions, "hasUI"> = {}, repo = () => tempRepo(TASK)) {
  const cwd = repo();
  const instance = harness(cwd, { hasUI: true, ...options });
  await instance.hooks.get("session_start")!({}, instance.ctx);
  await instance.tools.get("dev_request_approval").execute("id", { task: TASK }, undefined, undefined, instance.ctx);
  await instance.hooks.get("input")!({ type: "input", text: "g", source: "interactive" }, instance.ctx);
  return { cwd, instance };
}

/** Approved inside a repo whose complete-stage checks pass. */
async function approvedRepo(
  options: Omit<HarnessOptions, "hasUI"> = {},
  repoOptions: CompleteRepoOptions = {},
) {
  const cwd = completeRepo(repoOptions);
  const instance = harness(cwd, { hasUI: true, ...options });
  await instance.hooks.get("session_start")!({}, instance.ctx);
  await instance.commands.get("dev-approve").handler(TASK, instance.ctx);
  return { cwd, instance };
}

function answersWith(overrides: Record<string, number>) {
  return async (_state: any, questions: any) => ({
    answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { noul: overrides[id] ?? 0.9 }])),
  });
}

describe("decision server (single gate)", () => {
  test("every tool call reaches the decision server exactly once", async () => {
    const { hooks, jevDecisionCalls, ctx } = harness(process.cwd(), { hasUI: true, jevDecision: async () => ({}) });
    await hooks.get("session_start")!({}, ctx);
    const calls: Array<{ toolName: string; input: Record<string, unknown> }> = [
      { toolName: "bash", input: { command: "ls" } },
      { toolName: "read", input: { path: "src/a.ts" } },
      { toolName: "write", input: { path: "src/a.ts", content: "x" } },
      { toolName: "edit", input: { path: "src/a.ts", edits: [] } },
      { toolName: "mcp__memory__find", input: { q: "x" } },
      { toolName: "spawn_agents", input: { agents: [{ model: "flash", task: "x" }] } },
      { toolName: "web_fetch", input: { url: "https://example.com" } },
    ];
    for (const call of calls) {
      expect(await hooks.get("tool_call")!(call, ctx)).toBeUndefined();
    }
    expect(jevDecisionCalls).toHaveLength(calls.length);
    expect(jevDecisionCalls.every((name) => name === "pre_tool")).toBe(true);
  });

  test("nothing is blocked by policy, not even a root rm or a secret read", async () => {
    const { hooks, confirmCalls, jevDecisionCalls, ctx } = harness(process.cwd(), {
      hasUI: true,
      jevDecision: async () => ({}),
    });
    await hooks.get("session_start")!({}, ctx);
    for (const call of [
      { toolName: "bash", input: { command: "rm -rf /" } },
      { toolName: "bash", input: { command: "git push --force origin main" } },
      { toolName: "read", input: { path: "~/.ssh/id_rsa" } },
      { toolName: "write", input: { path: ".env" } },
    ]) {
      expect(await hooks.get("tool_call")!(call, ctx)).toBeUndefined();
    }
    expect(jevDecisionCalls).toHaveLength(4);
    expect(confirmCalls).toHaveLength(0);
  });

  test("a rejected call asks the human and honors the answer", async () => {
    const rejecting = harness(process.cwd(), {
      hasUI: true,
      confirm: true,
      jevDecision: async () => ({ gate: { action: "deny", reason: "secret material" } }),
    });
    await rejecting.hooks.get("session_start")!({}, rejecting.ctx);
    const allowed = await rejecting.hooks.get("tool_call")!({ toolName: "read", input: { path: ".env" } }, rejecting.ctx);
    expect(allowed).toBeUndefined();
    expect(rejecting.confirmCalls).toHaveLength(1);
    expect(rejecting.confirmCalls[0]).toContain("secret material");

    const declining = harness(process.cwd(), {
      hasUI: true,
      confirm: false,
      jevDecision: async () => ({ gate: { action: "deny", reason: "secret material" } }),
    });
    await declining.hooks.get("session_start")!({}, declining.ctx);
    const blocked = await declining.hooks.get("tool_call")!({ toolName: "read", input: { path: ".env" } }, declining.ctx);
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain("denied by you");
  });

  test("no server answer still prompts, and the gate tools are exempt", async () => {
    const unavailable = harness(process.cwd(), { hasUI: true, confirm: true, jevDecision: async () => undefined });
    await unavailable.hooks.get("session_start")!({}, unavailable.ctx);
    expect(
      await unavailable.hooks.get("tool_call")!({ toolName: "read", input: { path: "src/a.ts" } }, unavailable.ctx),
    ).toBeUndefined();
    expect(unavailable.confirmCalls).toHaveLength(1);
    expect(unavailable.confirmCalls[0]).toContain("unavailable");

    const denied = harness(process.cwd(), {
      hasUI: false,
      jevDecision: async () => ({ gate: { action: "deny", reason: "no ui" } }),
    });
    await denied.hooks.get("session_start")!({}, denied.ctx);
    const blocked = await denied.hooks.get("tool_call")!({ toolName: "read", input: { path: ".env" } }, denied.ctx);
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain("failing closed");

    const exempt = harness(process.cwd(), { hasUI: true, jevDecision: async () => ({}) });
    await exempt.hooks.get("session_start")!({}, exempt.ctx);
    for (const toolName of ["dev_outcome_met", "dev_request_approval", "dev_stage"]) {
      await exempt.hooks.get("tool_call")!({ toolName, input: {} }, exempt.ctx);
    }
    expect(exempt.jevDecisionCalls).toHaveLength(0);
  });

  test("a command the human typed is not judged", async () => {
    const { hooks } = harness(process.cwd(), { hasUI: true, jevDecision: async () => ({}) });
    expect(hooks.has("user_bash")).toBe(false);
  });

  test("/dev-status reports the counters and /dev-reset clears them", async () => {
    const { hooks, commands, notifications, ctx } = harness(process.cwd(), {
      hasUI: true,
      confirm: false,
      jevDecision: async () => ({ gate: { action: "deny", reason: "nope" } }),
    });
    await hooks.get("session_start")!({}, ctx);
    await hooks.get("tool_call")!({ toolName: "read", input: { path: ".env" } }, ctx);
    await hooks.get("tool_call")!({ toolName: "bash", input: { command: "ls" } }, ctx);

    notifications.length = 0;
    await commands.get("dev-status").handler("", ctx);
    expect(notifications.some((line) => line.includes("policy: 2 judged, 0 server-approved, 2 prompted"))).toBe(true);

    await commands.get("dev-reset").handler("", ctx);
    notifications.length = 0;
    await commands.get("dev-status").handler("", ctx);
    expect(notifications.some((line) => line.includes("policy: 0 judged, 0 server-approved, 0 prompted"))).toBe(true);
  });
});

describe("plan gate (conversational)", () => {
  test("presents the gate in the chat and records nothing", async () => {
    const { cwd, instance } = await openGate();
    try {
      expect(instance.messages).toHaveLength(1);
      expect(instance.messages[0].content).toContain("sandbox-dev gate");
      expect(instance.messages[0].content).toContain("transcript is the record");
      expect(instance.appended).toHaveLength(0);
      expect(existsSync(join(cwd, "taskNotes", TASK, "goal.md"))).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });

  test("does not supervise until the human approves", async () => {
    const { cwd, instance } = await openGate();
    try {
      const result = await instance.hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        instance.ctx,
      );
      expect(result).toBeUndefined();
    } finally {
      cleanup(cwd);
    }
  });

  test("a model source write does not approve the gate", async () => {
    const cwd = tempRepo(TASK);
    const instance = harness(cwd, { hasUI: true, jevDecision: async () => ({}) });
    try {
      await instance.hooks.get("session_start")!({}, instance.ctx);
      await instance.tools.get("dev_request_approval").execute("id", { task: TASK }, undefined, undefined, instance.ctx);
      await instance.hooks.get("tool_call")!({ toolName: "write", input: { path: "src/a.ts", content: "x" } }, instance.ctx);
      expect(existsSync(join(cwd, "taskNotes", TASK, "goal.md"))).toBe(false);
      const settle = await instance.hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        instance.ctx,
      );
      expect(settle).toBeUndefined();
    } finally {
      cleanup(cwd);
    }
  });

  test("refuses when the plan is missing", async () => {
    const cwd = tempRepo(TASK);
    const instance = harness(cwd, { hasUI: true });
    try {
      await instance.hooks.get("session_start")!({}, instance.ctx);
      const result = await instance.tools
        .get("dev_request_approval")
        .execute("id", { task: "missing" }, undefined, undefined, instance.ctx);
      expect(result.content[0].text).toContain("NOT APPROVED");
    } finally {
      cleanup(cwd);
    }
  });

  test("/dev-approve writes the goal, arms the anchor, and starts the implementation", async () => {
    const cwd = tempRepo(TASK);
    const instance = harness(cwd, { hasUI: true });
    try {
      await instance.hooks.get("session_start")!({}, instance.ctx);
      await instance.commands.get("dev-approve").handler(TASK, instance.ctx);
      expect(instance.sent[0]).toContain("/startWork");
      expect(readTaskFile(cwd, TASK, "goal.md")).toContain('dev_stage { "to": "complete" }');
      expect(instance.appended.some((entry) => entry.customType === "sandbox-dev-stage")).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });

  test("dev-reset clears the gate and anchor", async () => {
    const { cwd, instance } = await approved();
    try {
      await instance.commands.get("dev-reset").handler("", instance.ctx);
      const settle = await instance.hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        instance.ctx,
      );
      expect(settle).toBeUndefined();
    } finally {
      cleanup(cwd);
    }
  });
});

describe("human approval with g", () => {
  test("a typed g writes the work goal and arms supervision", async () => {
    const { cwd, instance } = await openGate();
    try {
      const reply = await instance.hooks.get("input")!(
        { type: "input", text: "  g  ", source: "interactive" },
        instance.ctx,
      );
      expect(reply).toEqual({ action: "continue" });
      const goal = readTaskFile(cwd, TASK, "goal.md");
      expect(goal).toContain("# Task\nAdd a turn-count widget to the footer.");
      expect(goal).toContain('dev_stage { "to": "complete" }');
      const settle = await instance.hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        instance.ctx,
      );
      expect(settle?.continue).toBe(true);
      expect(settle.entries[0].content).toContain("LIVE WORK GOAL");
    } finally {
      cleanup(cwd);
    }
  });

  test("g: note becomes the human note in the goal", async () => {
    const { cwd, instance } = await openGate();
    try {
      await instance.hooks.get("input")!(
        { type: "input", text: "g: keep the footer height", source: "interactive" },
        instance.ctx,
      );
      expect(readTaskFile(cwd, TASK, "goal.md")).toContain("## Human note\nkeep the footer height");
    } finally {
      cleanup(cwd);
    }
  });

  test("t:, r, and non-human sources leave the gate open", async () => {
    for (const event of [
      { text: "t: change the scope", source: "interactive" },
      { text: "r", source: "interactive" },
      { text: "g", source: "extension" },
      { text: "g", source: "rpc" },
    ]) {
      const { cwd, instance } = await openGate();
      try {
        await instance.hooks.get("input")!({ type: "input", ...event }, instance.ctx);
        expect(existsSync(join(cwd, "taskNotes", TASK, "goal.md"))).toBe(false);
        instance.notifications.length = 0;
        await instance.commands.get("dev-status").handler("", instance.ctx);
        expect(instance.notifications.some((line) => line.includes("awaiting the human's approval"))).toBe(true);
      } finally {
        cleanup(cwd);
      }
    }
  });

  test("a stray g without a gate is ignored", async () => {
    const cwd = tempRepo(TASK);
    const instance = harness(cwd, { hasUI: true });
    try {
      await instance.hooks.get("session_start")!({}, instance.ctx);
      await instance.hooks.get("input")!({ type: "input", text: "g", source: "interactive" }, instance.ctx);
      expect(existsSync(join(cwd, "taskNotes", TASK, "goal.md"))).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });
});

describe("stage switch", () => {
  test("dev_stage refuses while the work validator fails and escalates on the third try", async () => {
    const { cwd, instance } = await approvedRepo({ askJev: answersWith({ work_finished: 0.2 }) });
    try {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const result = await instance.tools.get("dev_stage").execute("id", { to: "complete" }, undefined, undefined, instance.ctx);
        expect(result.content[0].text).toContain("NOT READY");
        expect(result.content[0].text).toContain("work_finished");
        if (attempt < 3) expect(result.content[0].text).not.toContain("ESCALATED");
      }
      expect(readTaskFile(cwd, TASK, "goal.md")).not.toContain("## Files present");

      const settle = await instance.hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        instance.ctx,
      );
      expect(settle?.continue).toBe(false);
      expect(settle.entries[0].content).toContain("ESCALATED");
      expect(instance.appended.some((entry) => (entry.data as any)?.escalated === true)).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });

  test("dev_stage passes, rewrites goal.md, announces the switch, and resets the budget", async () => {
    const { cwd, instance } = await approvedRepo();
    try {
      for (let turn = 0; turn < 2; turn += 1) {
        await instance.hooks.get("agent_before_settle")!(
          { outcome: "completed", context: { canContinue: true } },
          instance.ctx,
        );
      }
      const result = await instance.tools.get("dev_stage").execute("id", { to: "complete" }, undefined, undefined, instance.ctx);
      expect(result.content[0].text).toContain("Stage: complete");
      const goal = readTaskFile(cwd, TASK, "goal.md");
      expect(goal).toContain("## Files present");
      expect(goal).toContain("taskNotes/add-widget/backend-validation.md");
      expect(instance.messages.some((message) => message.content.includes("stage → complete"))).toBe(true);
      expect(instance.appended.some((entry) => (entry.data as any)?.stage === "complete")).toBe(true);

      const afterSwitch = await instance.hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        instance.ctx,
      );
      expect(afterSwitch.entries[0].content).toContain("turn 1/8");

      instance.notifications.length = 0;
      await instance.commands.get("dev-status").handler("", instance.ctx);
      expect(instance.notifications.some((line) => line.includes("stage: complete"))).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });

  test("an unsupported or mismatched stage is refused", async () => {
    const { cwd, instance } = await approvedRepo();
    try {
      const wrongTarget = await instance.tools.get("dev_stage").execute("id", { task: "other", to: "complete" }, undefined, undefined, instance.ctx);
      expect(wrongTarget.content[0].text).toContain("NOT READY");
      const wrongStage = await instance.tools.get("dev_stage").execute("id", { to: "deploy" }, undefined, undefined, instance.ctx);
      expect(wrongStage.content[0].text).toContain('unsupported stage "deploy"');
    } finally {
      cleanup(cwd);
    }
  });
});

describe("single-outcome anchoring", () => {
  test("continues with the live work goal", async () => {
    const { cwd, instance } = await approved();
    try {
      const result = await instance.hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        instance.ctx,
      );
      expect(result?.continue).toBe(true);
      expect(result.entries[0].content).toContain("LIVE WORK GOAL");
      expect(result.entries[0].content).toContain("turn-count widget");
      expect(result.entries[0].content).toContain("dev_stage");
    } finally {
      cleanup(cwd);
    }
  });

  test("validator failures continue with the specific misses", async () => {
    const { cwd, instance } = await approved({ askJev: answersWith({ work_finished: 0.1 }) });
    try {
      const first = await instance.hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        instance.ctx,
      );
      expect(first?.continue).toBe(true);
      expect(first.entries[0].content).toContain("VALIDATOR NOT READY · stage work · failure 1/3");
      expect(first.entries[0].content).toContain("work_finished");

      await instance.hooks.get("agent_before_settle")!({ outcome: "completed", context: { canContinue: true } }, instance.ctx);
      const third = await instance.hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        instance.ctx,
      );
      expect(third?.continue).toBe(false);
      expect(third.entries[0].content).toContain("ESCALATED");
    } finally {
      cleanup(cwd);
    }
  });

  test("does not continue when the boundary cannot continue", async () => {
    const { cwd, instance } = await approved();
    try {
      const result = await instance.hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: false } },
        instance.ctx,
      );
      expect(result).toBeUndefined();
    } finally {
      cleanup(cwd);
    }
  });

  test("budget exhaustion is not a satisfied outcome", async () => {
    const { cwd, instance } = await approved();
    try {
      for (let turn = 0; turn < 8; turn += 1) {
        const result = await instance.hooks.get("agent_before_settle")!(
          { outcome: "completed", context: { canContinue: true } },
          instance.ctx,
        );
        expect(result?.continue).toBe(true);
      }
      const exhausted = await instance.hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        instance.ctx,
      );
      expect(exhausted?.continue).toBeUndefined();
      expect(exhausted.entries[0].content).toContain("BUDGET EXHAUSTED");

      instance.notifications.length = 0;
      await instance.commands.get("dev-status").handler("", instance.ctx);
      expect(instance.notifications.some((line) => line.includes("exhausted: true"))).toBe(true);
      expect(instance.notifications.some((line) => line.includes("met: true"))).toBe(false);
      expect(instance.appended.some((entry) => entry.customType === "sandbox-dev-outcome")).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });
});

describe("outcome declaration", () => {
  test("dev_outcome_met records met only after the complete stage and a passing validator", async () => {
    const { cwd, instance } = await approvedRepo();
    try {
      await instance.tools.get("dev_stage").execute("id", { to: "complete" }, undefined, undefined, instance.ctx);
      const result = await instance.tools.get("dev_outcome_met").execute(
        "id",
        { task: TASK, evidence: "npm run typecheck exit 0; bun test: 42 pass, 0 fail", not_run: [] },
        undefined,
        undefined,
        instance.ctx,
      );
      expect(result.content[0].text).toContain("Outcome marked met");
      const outcome = instance.appended.find((entry) => entry.customType === "sandbox-dev-outcome");
      expect((outcome?.data as any)?.met).toBe(true);
      expect((outcome?.data as any)?.criteria).toEqual([]);
      expect(readTaskFile(cwd, TASK, "goal.md")).toContain("## Verification (extension)");

      const settle = await instance.hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        instance.ctx,
      );
      expect(settle).toBeUndefined();
    } finally {
      cleanup(cwd);
    }
  });

  test("declaring in the work stage is refused with a stage miss", async () => {
    const { cwd, instance } = await approvedRepo();
    try {
      const result = await instance.tools.get("dev_outcome_met").execute(
        "id",
        { task: TASK, evidence: "exit 0", not_run: [] },
        undefined,
        undefined,
        instance.ctx,
      );
      expect(result.content[0].text).toContain("NOT READY");
      expect(result.content[0].text).toContain("stage:");
      const outcome = instance.appended.find((entry) => entry.customType === "sandbox-dev-outcome");
      expect((outcome?.data as any)?.met).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });

  test("not_run and waivers are persisted and shown in the status line", async () => {
    const { cwd, instance } = await approvedRepo();
    try {
      await instance.tools.get("dev_stage").execute("id", { to: "complete" }, undefined, undefined, instance.ctx);
      writeFileSync(join(cwd, "taskNotes", TASK, "review-passes.md"), "Pass 1: 2 findings\nPass 2: 1 finding\n");
      const result = await instance.tools.get("dev_outcome_met").execute(
        "id",
        {
          task: TASK,
          evidence: "exit 0; 12 pass, 0 fail",
          not_run: ["browser walkthrough"],
          waive: [{ check: "review-passes", reason: "docs-only change; the loop found nothing to fix" }],
        },
        undefined,
        undefined,
        instance.ctx,
      );
      expect(result.content[0].text).toContain("1 waived, 1 not run");
      const outcome = instance.appended.find((entry) => entry.customType === "sandbox-dev-outcome");
      expect((outcome?.data as any)?.waived).toEqual([{ check: "review-passes", reason: "docs-only change; the loop found nothing to fix" }]);
      expect((outcome?.data as any)?.not_run).toEqual(["browser walkthrough"]);

      instance.notifications.length = 0;
      await instance.commands.get("dev-status").handler("", instance.ctx);
      expect(instance.notifications.some((line) => line.includes("waived: 1"))).toBe(true);
      expect(instance.notifications.some((line) => line.includes("not run: 1"))).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });

  test("the criterion map is persisted for a plan with acceptance criteria", async () => {
    const { cwd, instance } = await approvedRepo({}, { fixtureTask: "88-skills-commands-import" });
    try {
      await instance.tools.get("dev_stage").execute("id", { to: "complete" }, undefined, undefined, instance.ctx);
      const result = await instance.tools.get("dev_outcome_met").execute(
        "id",
        { task: TASK, evidence: "npx tsc --noEmit exit 0; npm test: 214 pass, 0 fail", not_run: [] },
        undefined,
        undefined,
        instance.ctx,
      );
      expect(result.content[0].text).toContain("Outcome marked met");
      const outcome = instance.appended.find((entry) => entry.customType === "sandbox-dev-outcome");
      expect((outcome?.data as any)?.criteria).toHaveLength(8);
      expect(readTaskFile(cwd, TASK, "goal.md")).toContain("0.90");
    } finally {
      cleanup(cwd);
    }
  });
});

describe("resume", () => {
  test("a stage entry regenerates the goal from the plan, never from a stale goal.md", async () => {
    const cwd = completeRepo();
    try {
      writeFileSync(join(cwd, "taskNotes", TASK, "goal.md"), "stale goal text\n");
      const branch = [{ type: "custom", customType: "sandbox-dev-stage", data: { task: TASK, stage: "complete", note: "keep it small" } }];
      const instance = harness(cwd, { hasUI: true, branch });
      await instance.hooks.get("session_start")!({}, instance.ctx);
      const goal = readTaskFile(cwd, TASK, "goal.md");
      expect(goal).not.toContain("stale goal text");
      expect(goal).toContain("## Files present");
      instance.notifications.length = 0;
      await instance.commands.get("dev-status").handler("", instance.ctx);
      expect(instance.notifications.some((line) => line.includes("stage: complete"))).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });

  test("a met outcome entry is not resurrected", async () => {
    const cwd = completeRepo();
    try {
      const branch = [
        { type: "custom", customType: "sandbox-dev-stage", data: { task: TASK, stage: "complete" } },
        { type: "custom", customType: "sandbox-dev-outcome", data: { task: TASK, met: true } },
      ];
      const instance = harness(cwd, { hasUI: true, branch });
      await instance.hooks.get("session_start")!({}, instance.ctx);
      instance.notifications.length = 0;
      await instance.commands.get("dev-status").handler("", instance.ctx);
      expect(instance.notifications.some((line) => line.includes("no plan gate or anchored outcome"))).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });

  test("an escalated stage entry is not resurrected", async () => {
    const cwd = completeRepo();
    try {
      const branch = [{ type: "custom", customType: "sandbox-dev-stage", data: { task: TASK, stage: "complete", escalated: true } }];
      const instance = harness(cwd, { hasUI: true, branch });
      await instance.hooks.get("session_start")!({}, instance.ctx);
      instance.notifications.length = 0;
      await instance.commands.get("dev-status").handler("", instance.ctx);
      expect(instance.notifications.some((line) => line.includes("no plan gate or anchored outcome"))).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });
});

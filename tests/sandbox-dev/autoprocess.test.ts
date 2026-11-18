import { describe, expect, test } from "bun:test";
import { cleanup, harness, readTaskFile, tempRepo } from "./helpers.ts";

const SAFE_ANSWERS = {
  answers: {
    irreversible: { type: "noul", noul: 0.1 },
    scope_risk: { type: "noul", noul: 0.1 },
    safe_autoproceed: { type: "noul", noul: 0.9 },
  },
  model: "test",
  inputTokens: 0,
};

describe("decision server (single gate)", () => {
  test("approval runs the call silently, with no prompt", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, notifications, confirmCalls, jevDecisionCalls, ctx } = harness(cwd, {
        hasUI: true,
        jevDecision: async () => ({}),
      });
      await hooks.get("session_start")!({}, ctx);
      const result = await hooks.get("tool_call")!({ toolName: "bash", input: { command: "sudo ls" } }, ctx);
      expect(result).toBeUndefined();
      expect(jevDecisionCalls).toEqual(["pre_tool"]);
      // Approval adds no notification line: the tool call is its own feedback.
      expect(notifications).toHaveLength(0);
      expect(confirmCalls).toHaveLength(0);
    } finally {
      cleanup(cwd);
    }
  });

  test("a reject prompts once with the server's reason and approving runs it", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, confirmCalls, ctx } = harness(cwd, {
        hasUI: true,
        confirm: true,
        jevDecision: async () => ({ gate: { action: "deny", reason: "destructive rm" } }),
      });
      await hooks.get("session_start")!({}, ctx);
      const result = await hooks.get("tool_call")!({ toolName: "bash", input: { command: "rm -rf build" } }, ctx);
      expect(result).toBeUndefined();
      expect(confirmCalls).toHaveLength(1);
      expect(confirmCalls[0]).toContain("destructive rm");
    } finally {
      cleanup(cwd);
    }
  });

  test("a reject plus a decline blocks with the human's own refusal", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, confirmCalls, ctx } = harness(cwd, {
        hasUI: true,
        confirm: false,
        jevDecision: async () => ({ gate: { action: "ask", reason: "risky push" } }),
      });
      await hooks.get("session_start")!({}, ctx);
      const result = await hooks.get("tool_call")!({ toolName: "bash", input: { command: "git push origin main" } }, ctx);
      expect(result?.block).toBe(true);
      expect(result?.reason).toContain("denied by you");
      expect(confirmCalls).toHaveLength(1);
    } finally {
      cleanup(cwd);
    }
  });

  test("an unreachable server prompts instead of failing open", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, confirmCalls, ctx } = harness(cwd, {
        hasUI: true,
        confirm: true,
        jevDecision: async () => undefined, // adapter subprocess unavailable
      });
      await hooks.get("session_start")!({}, ctx);
      const result = await hooks.get("tool_call")!({ toolName: "bash", input: { command: "git reset --hard" } }, ctx);
      expect(result).toBeUndefined();
      expect(confirmCalls).toHaveLength(1);
      expect(confirmCalls[0]).toContain("unavailable");
    } finally {
      cleanup(cwd);
    }
  });

  test("no UI fails closed with the server's reason", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, ctx } = harness(cwd, {
        hasUI: false,
        jevDecision: async () => ({ gate: { action: "deny", reason: "secret read" } }),
      });
      await hooks.get("session_start")!({}, ctx);
      const result = await hooks.get("tool_call")!({ toolName: "read", input: { path: ".env" } }, ctx);
      expect(result?.block).toBe(true);
      expect(result?.reason).toContain("secret read");
      expect(result?.reason).toContain("failing closed");
    } finally {
      cleanup(cwd);
    }
  });

  test("a rewrite is applied and notify lines are shown", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, notifications, ctx } = harness(cwd, {
        hasUI: true,
        jevDecision: async () => ({
          notify: ["narrowed the command"],
          rewrite: { input: { command: "ls -la" }, note: "rewrote the command" },
        }),
      });
      await hooks.get("session_start")!({}, ctx);
      const event = { toolName: "bash", input: { command: "ls" } };
      expect(await hooks.get("tool_call")!(event, ctx)).toBeUndefined();
      expect(event.input.command).toBe("ls -la");
      expect(notifications.some((line) => line.includes("narrowed the command"))).toBe(true);
      expect(notifications.some((line) => line.includes("rewrote the command"))).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });

  test("there is no grant memory: the same rejected call prompts every time", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, confirmCalls, jevDecisionCalls, ctx } = harness(cwd, {
        hasUI: true,
        confirm: false,
        jevDecision: async () => ({ gate: { action: "deny", reason: "secret read" } }),
      });
      await hooks.get("session_start")!({}, ctx);
      await hooks.get("tool_call")!({ toolName: "read", input: { path: ".env" } }, ctx);
      await hooks.get("tool_call")!({ toolName: "read", input: { path: ".env" } }, ctx);
      expect(confirmCalls).toHaveLength(2);
      expect(jevDecisionCalls).toHaveLength(2);
    } finally {
      cleanup(cwd);
    }
  });
});

describe("plan-gate Jev routing", () => {
  test("(d) clearly-safe answers auto-approve, write the work goal, and arm the anchor", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, tools, messages, notifications, confirmCalls, ctx } = harness(cwd, {
        hasUI: true,
        askJev: async () => SAFE_ANSWERS,
      });
      await hooks.get("session_start")!({}, ctx);
      const result = await tools.get("dev_request_approval").execute("id", { task: "add-widget" }, undefined, undefined, ctx);

      expect(result.content[0].text).toContain("Auto-approved");
      expect(notifications.some((line) => line.includes("auto-approved add-widget") && line.includes("Jev: safe"))).toBe(true);
      expect(messages.some((message) => message.content.includes("auto-approved by Jev"))).toBe(true);
      expect(messages.some((message) => message.content.includes("sandbox-dev gate"))).toBe(false);
      expect(confirmCalls).toHaveLength(0);
      expect(readTaskFile(cwd, "add-widget", "goal.md")).toContain('dev_stage { "to": "complete" }');

      // The anchor is armed, so supervision is active without a human reply.
      const settle = await hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        ctx,
      );
      expect(settle?.continue).toBe(true);
      expect(settle.entries[0].content).toContain("LIVE WORK GOAL");
    } finally {
      cleanup(cwd);
    }
  });

  test("(e) an askJev error presents the human gate (fail closed)", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, tools, messages, ctx } = harness(cwd, {
        hasUI: true,
        askJev: async () => {
          throw new Error("jev offline");
        },
      });
      await hooks.get("session_start")!({}, ctx);
      const result = await tools.get("dev_request_approval").execute("id", { task: "add-widget" }, undefined, undefined, ctx);
      expect(result.content[0].text).toContain("Gate presented");
      expect(messages[0].content).toContain("sandbox-dev gate");
    } finally {
      cleanup(cwd);
    }
  });

  test("risky answers present the human gate", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, tools, messages, ctx } = harness(cwd, {
        hasUI: true,
        askJev: async () => ({
          answers: {
            irreversible: { type: "noul", noul: 0.8 },
            scope_risk: { type: "noul", noul: 0.2 },
            safe_autoproceed: { type: "noul", noul: 0.9 },
          },
          model: "test",
          inputTokens: 0,
        }),
      });
      await hooks.get("session_start")!({}, ctx);
      const result = await tools.get("dev_request_approval").execute("id", { task: "add-widget" }, undefined, undefined, ctx);
      expect(result.content[0].text).toContain("Gate presented");
      expect(messages[0].content).toContain("sandbox-dev gate");
    } finally {
      cleanup(cwd);
    }
  });
});

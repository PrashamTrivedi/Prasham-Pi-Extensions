import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sandboxDev, { jev } from "../../extensions/sandbox-dev/index.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

function harness(
  cwd: string,
  options: {
    hasUI: boolean;
    confirm?: boolean;
    jevDecision?: (eventName: string, payload: any) => Promise<any>;
    askJev?: (state: any, questions: any) => Promise<any>;
  } = { hasUI: true },
) {
  const hooks = new Map<string, Function>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const appended: Array<{ customType: string; data?: unknown }> = [];
  const notifications: string[] = [];
  const sent: string[] = [];
  const messages: Array<{ customType: string; content: string }> = [];
  const confirmCalls: string[] = [];
  const jevDecisionCalls: string[] = [];

  const pi: any = {
    on: (name: string, handler: Function) => hooks.set(name, handler),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    appendEntry: (customType: string, data?: unknown) => appended.push({ customType, data }),
    sendMessage: (message: { customType: string; content: string }) => messages.push(message),
    sendUserMessage: (text: string) => sent.push(text),
  };

  const ctx: any = {
    cwd,
    mode: options.hasUI ? "tui" : "print",
    hasUI: options.hasUI,
    ui: {
      setStatus: () => {},
      notify: (message: string) => notifications.push(message),
      input: async () => undefined,
      select: async () => undefined,
      editor: async () => undefined,
      confirm: async (_title: string, message: string) => {
        confirmCalls.push(message);
        return options.confirm ?? false;
      },
    },
    sessionManager: { getBranch: () => [], getSessionId: () => "test-session" },
  };

  // No subprocess, no network: stub the Jev bridge. The default fails closed (ask / uncertain)
  // so tests that do not opt into a Jev verdict keep the deterministic human-path behavior.
  jev.runJevDecision = options.jevDecision ?? (async () => ({ gate: { action: "ask", reason: "test: uncertain" } }));
  jev.askJev = options.askJev ?? (async () => ({
    answers: {
      irreversible: { type: "noul", noul: 0.9 },
      scope_risk: { type: "noul", noul: 0.9 },
      safe_autoproceed: { type: "noul", noul: 0.1 },
    },
    model: "test",
    inputTokens: 0,
  }));

  const baseRunDecision = jev.runJevDecision;
  jev.runJevDecision = async (eventName: string, payload: any) => {
    jevDecisionCalls.push(eventName);
    return baseRunDecision(eventName, payload);
  };

  sandboxDev(pi);
  return { hooks, tools, commands, appended, notifications, sent, messages, confirmCalls, jevDecisionCalls, ctx };
}

function tempRepo(task: string): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-sandbox-dev-"));
  mkdirSync(join(cwd, "taskNotes", task), { recursive: true });
  writeFileSync(
    join(cwd, "taskNotes", task, "taskFindings.md"),
    ["# Add widget", "", "## Original Ask", "Add a turn-count widget to the footer.", "", "## Complexity", "3"].join("\n"),
  );
  return cwd;
}

/** Present the gate, the way `dev_request_approval` does. */
async function armGate(task: string) {
  const cwd = tempRepo(task);
  const instance = harness(cwd, { hasUI: true });
  await instance.hooks.get("session_start")!({}, instance.ctx);
  const result = await instance.tools
    .get("dev_request_approval")
    .execute("id", { task }, undefined, undefined, instance.ctx);
  return { cwd, instance, result };
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
    await exempt.hooks.get("tool_call")!({ toolName: "dev_outcome_met", input: {} }, exempt.ctx);
    await exempt.hooks.get("tool_call")!({ toolName: "dev_request_approval", input: {} }, exempt.ctx);
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
    const { cwd, instance } = await armGate("add-widget");
    try {
      expect(instance.messages).toHaveLength(1);
      expect(instance.messages[0].content).toContain("sandbox-dev gate");
      expect(instance.messages[0].content).toContain("transcript is the record");
      expect(instance.appended).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("does not supervise until implementation starts", async () => {
    const { cwd, instance } = await armGate("add-widget");
    try {
      const result = await instance.hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        instance.ctx,
      );
      expect(result).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("the first source write arms the outcome anchor", async () => {
    const { cwd, instance } = await armGate("add-widget");
    try {
      // A planning write does not count as implementation.
      await instance.hooks.get("tool_call")!({ toolName: "write", input: { path: "taskNotes/add-widget/notes.md" } }, instance.ctx);
      expect(
        await instance.hooks.get("agent_before_settle")!({ outcome: "completed", context: { canContinue: true } }, instance.ctx),
      ).toBeUndefined();

      // A source write does.
      await instance.hooks.get("tool_call")!({ toolName: "write", input: { path: "src/a.ts" } }, instance.ctx);
      const result = await instance.hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        instance.ctx,
      );
      expect(result?.continue).toBe(true);
      expect(result.entries[0].content).toContain("ANCHORED OUTCOME");
      expect(result.entries[0].content).toContain("turn-count widget");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("refuses when the plan is missing", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, tools, messages, ctx } = harness(cwd, { hasUI: true });
      await hooks.get("session_start")!({}, ctx);
      const result = await tools.get("dev_request_approval").execute("id", { task: "nope" }, undefined, undefined, ctx);
      expect(result.content[0].text).toContain("NOT APPROVED");
      expect(messages).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("/dev-approve arms the anchor and starts the implementation", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, commands, sent, ctx } = harness(cwd, { hasUI: true });
      await hooks.get("session_start")!({}, ctx);
      await commands.get("dev-approve").handler("add-widget", ctx);
      expect(sent[0]).toContain("/startWork");
      const result = await hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        ctx,
      );
      expect(result?.continue).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("dev-reset clears the gate and anchor", async () => {
    const { cwd, instance } = await armGate("add-widget");
    try {
      await instance.commands.get("dev-reset").handler("", instance.ctx);
      expect(
        await instance.hooks.get("agent_before_settle")!({ outcome: "completed", context: { canContinue: true } }, instance.ctx),
      ).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("single-outcome anchoring", () => {
  async function approved() {
    const cwd = tempRepo("add-widget");
    const instance = harness(cwd, { hasUI: true });
    await instance.hooks.get("session_start")!({}, instance.ctx);
    await instance.commands.get("dev-approve").handler("add-widget", instance.ctx);
    return { cwd, instance };
  }

  test("continues with the anchored outcome", async () => {
    const { cwd, instance } = await approved();
    try {
      const result = await instance.hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        instance.ctx,
      );
      expect(result?.continue).toBe(true);
      expect(result.entries[0].content).toContain("ANCHORED OUTCOME");
      expect(result.entries[0].content).toContain("turn-count widget");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("dev_outcome_met stops continuation", async () => {
    const { cwd, instance } = await approved();
    try {
      await instance.tools
        .get("dev_outcome_met")
        .execute("id", { task: "add-widget", evidence: "bun test: 19 pass, 0 fail" }, undefined, undefined, instance.ctx);
      const result = await instance.hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        instance.ctx,
      );
      expect(result).toBeUndefined();
      expect(instance.appended.some((entry) => entry.customType === "sandbox-dev-outcome")).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
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
      rmSync(cwd, { recursive: true, force: true });
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
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

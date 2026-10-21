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

  sandboxDev(pi);
  return { hooks, tools, commands, appended, notifications, sent, messages, confirmCalls, ctx };
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

describe("permission floor", () => {
  test("denies protected paths", async () => {
    const { hooks, ctx } = harness(process.cwd());
    await hooks.get("session_start")!({}, ctx);
    const result = await hooks.get("tool_call")!({ toolName: "read", input: { path: ".env" } }, ctx);
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("protected pattern");
  });

  test("fails closed without UI for confirmation-tier calls", async () => {
    const { hooks, ctx } = harness(process.cwd(), { hasUI: false });
    await hooks.get("session_start")!({}, ctx);
    const result = await hooks.get("tool_call")!({ toolName: "bash", input: { command: "git push origin main" } }, ctx);
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("failing closed");
  });

  test("allows ordinary work", async () => {
    const { hooks, ctx } = harness(process.cwd());
    await hooks.get("session_start")!({}, ctx);
    expect(await hooks.get("tool_call")!({ toolName: "bash", input: { command: "npm test" } }, ctx)).toBeUndefined();
    expect(await hooks.get("tool_call")!({ toolName: "read", input: { path: "src/a.ts" } }, ctx)).toBeUndefined();
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

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

  // No subprocess, no network: stub the Jev bridge. Defaults fail closed.
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
  jev.runJevDecision = async (eventName, payload) => {
    jevDecisionCalls.push(eventName);
    return baseRunDecision(eventName, payload);
  };

  sandboxDev(pi);
  return { hooks, tools, commands, appended, notifications, sent, messages, confirmCalls, jevDecisionCalls, ctx };
}

function tempRepo(task: string): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-sandbox-dev-auto-"));
  mkdirSync(join(cwd, "taskNotes", task), { recursive: true });
  writeFileSync(
    join(cwd, "taskNotes", task, "taskFindings.md"),
    ["# Add widget", "", "## Original Ask", "Add a turn-count widget to the footer.", "", "## Complexity", "3"].join("\n"),
  );
  return cwd;
}

const SAFE_ANSWERS = {
  answers: {
    irreversible: { type: "noul", noul: 0.1 },
    scope_risk: { type: "noul", noul: 0.1 },
    safe_autoproceed: { type: "noul", noul: 0.9 },
  },
  model: "test",
  inputTokens: 0,
};

describe("shell-confirm Jev routing", () => {
  test("(a) Jev gate none auto-approves with a visible notify", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, notifications, ctx } = harness(cwd, {
        hasUI: true,
        jevDecision: async () => ({}),
      });
      await hooks.get("session_start")!({}, ctx);
      const result = await hooks.get("tool_call")!({ toolName: "bash", input: { command: "sudo ls" } }, ctx);
      expect(result).toBeUndefined();
      expect(notifications.some((line) => line.includes("auto-approved bash") && line.includes("Jev: safe"))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("(b) Jev gate deny blocks the command", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, confirmCalls, ctx } = harness(cwd, {
        hasUI: true,
        jevDecision: async () => ({ gate: { action: "deny", reason: "destructive rm" } }),
      });
      await hooks.get("session_start")!({}, ctx);
      const result = await hooks.get("tool_call")!({ toolName: "bash", input: { command: "rm -rf build" } }, ctx);
      expect(result?.block).toBe(true);
      expect(result?.reason).toContain("destructive rm");
      expect(confirmCalls).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("(c) Jev gate ask falls through to exactly one human confirm", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, confirmCalls, ctx } = harness(cwd, {
        hasUI: true,
        confirm: true,
        jevDecision: async () => ({ gate: { action: "ask", reason: "risky push" } }),
      });
      await hooks.get("session_start")!({}, ctx);
      const result = await hooks.get("tool_call")!({ toolName: "bash", input: { command: "git push origin main" } }, ctx);
      expect(result).toBeUndefined();
      expect(confirmCalls).toHaveLength(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("non-shell confirm stays deterministic and never calls Jev", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, confirmCalls, jevDecisionCalls, ctx } = harness(cwd, { hasUI: true, confirm: true });
      await hooks.get("session_start")!({}, ctx);
      const result = await hooks.get("tool_call")!({ toolName: "write", input: { path: "/etc/hosts", content: "x" } }, ctx);
      expect(result).toBeUndefined();
      expect(jevDecisionCalls).toHaveLength(0);
      expect(confirmCalls).toHaveLength(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("shell-confirm transport failure fails closed to the human confirm", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, confirmCalls, ctx } = harness(cwd, {
        hasUI: true,
        confirm: true,
        jevDecision: async () => undefined, // adapter subprocess unavailable
      });
      await hooks.get("session_start")!({}, ctx);
      const result = await hooks.get("tool_call")!({ toolName: "bash", input: { command: "git reset --hard origin/main" } }, ctx);
      expect(result).toBeUndefined();
      expect(confirmCalls).toHaveLength(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("shell-confirm marks the approval handled so jev-gate does not double-prompt", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const marked: string[] = [];
      const original = jev.markShellApprovalHandled;
      jev.markShellApprovalHandled = (id: string) => { marked.push(id); };
      try {
        const { hooks, ctx } = harness(cwd, { hasUI: true, jevDecision: async () => ({}) });
        await hooks.get("session_start")!({}, ctx);
        await hooks.get("tool_call")!({ toolName: "bash", input: { command: "rm -rf node_modules" }, toolCallId: "call-1" }, ctx);
        expect(marked).toContain("call-1");
      } finally {
        jev.markShellApprovalHandled = original;
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("plan-gate Jev routing", () => {
  test("(d) clearly-safe answers auto-approve and arm the anchor", async () => {
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

      // The anchor is armed, so supervision is active without a human reply.
      const settle = await hooks.get("agent_before_settle")!(
        { outcome: "completed", context: { canContinue: true } },
        ctx,
      );
      expect(settle?.continue).toBe(true);
      expect(settle.entries[0].content).toContain("ANCHORED OUTCOME");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
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
      rmSync(cwd, { recursive: true, force: true });
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
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

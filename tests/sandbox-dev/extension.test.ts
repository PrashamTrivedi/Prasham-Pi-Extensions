import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sandboxDev from "../../extensions/sandbox-dev/index.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

function harness(
  cwd: string,
  options: {
    hasUI: boolean;
    input?: Array<string | undefined>;
    selects?: Array<string | undefined>;
    editors?: Array<string | undefined>;
    confirm?: boolean;
    entries?: unknown[];
  } = {
    hasUI: true,
  },
) {
  const hooks = new Map<string, Function>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const appended: Array<{ customType: string; data?: unknown }> = [];
  const notifications: string[] = [];
  const branch: unknown[] = [...(options.entries ?? [])];
  const sent: string[] = [];
  const editorCalls: Array<{ title: string; prefill?: string }> = [];

  const pi: any = {
    on: (name: string, handler: Function) => hooks.set(name, handler),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    appendEntry: (customType: string, data?: unknown) => {
      appended.push({ customType, data });
      branch.push({ type: "custom", customType, data });
    },
    sendUserMessage: (text: string) => sent.push(text),
  };

  const ctx: any = {
    cwd,
    mode: options.hasUI ? "tui" : "print",
    hasUI: options.hasUI,
    ui: {
      setStatus: () => {},
      notify: (message: string) => notifications.push(message),
      input: async () => options.input?.shift(),
      select: async () => options.selects?.shift(),
      editor: async (title: string, prefill?: string) => {
        editorCalls.push({ title, prefill });
        return options.editors?.shift();
      },
      confirm: async () => options.confirm ?? false,
    },
    sessionManager: { getBranch: () => branch },
  };

  sandboxDev(pi);
  return { hooks, tools, commands, appended, notifications, sent, editorCalls, ctx };
}

function tempRepo(task: string): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-sandbox-dev-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  mkdirSync(join(cwd, "taskNotes", task), { recursive: true });
  writeFileSync(
    join(cwd, "taskNotes", task, "taskFindings.md"),
    ["# Add widget", "", "## Original Ask", "Add a turn-count widget to the footer.", "", "## Complexity", "3"].join("\n"),
  );
  return cwd;
}

describe("permission gate", () => {
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

const GO = "g";

describe("explicit plan approval", () => {
  test("refuses to auto-approve without UI", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, tools, appended, ctx } = harness(cwd, { hasUI: false });
      await hooks.get("session_start")!({}, ctx);
      const result = await tools.get("dev_request_approval").execute("id", { task: "add-widget" }, undefined, undefined, ctx);
      expect(result.content[0].text).toContain("NOT APPROVED");
      expect(appended).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("records an approval bound to the plan hash on g", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, tools, appended, ctx } = harness(cwd, { hasUI: true, input: [GO] });
      await hooks.get("session_start")!({}, ctx);
      const result = await tools.get("dev_request_approval").execute("id", { task: "add-widget" }, undefined, undefined, ctx);
      expect(result.content[0].text).toContain("Approved add-widget");
      const approval = appended.find((entry) => entry.customType === "sandbox-dev-approval")?.data as any;
      expect(approval.task).toBe("add-widget");
      expect(approval.outcome).toContain("turn-count widget");
      expect(approval.planHash).toHaveLength(16);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("treats a plain typed message as feedback, verbatim", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, tools, appended, ctx } = harness(cwd, {
        hasUI: true,
        input: ["also cover the empty case with a test"],
      });
      await hooks.get("session_start")!({}, ctx);
      const result = await tools.get("dev_request_approval").execute("id", { task: "add-widget" }, undefined, undefined, ctx);
      expect(result.content[0].text).toContain("NOT APPROVED");
      expect(result.content[0].text).toContain("also cover the empty case with a test");
      expect(result.content[0].text).toContain("Do not implement yet");
      expect(appended).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("strips a t: prefix from feedback", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, tools, ctx } = harness(cwd, { hasUI: true, input: ["t: narrow it to the footer"] });
      await hooks.get("session_start")!({}, ctx);
      const result = await tools.get("dev_request_approval").execute("id", { task: "add-widget" }, undefined, undefined, ctx);
      expect(result.content[0].text).toContain("narrow it to the footer");
      expect(result.content[0].text).not.toContain("t: narrow");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("t alone opens the multi-line feedback editor", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, tools, ctx } = harness(cwd, {
        hasUI: true,
        input: ["t"],
        editors: ["first line\nsecond line"],
      });
      await hooks.get("session_start")!({}, ctx);
      const result = await tools.get("dev_request_approval").execute("id", { task: "add-widget" }, undefined, undefined, ctx);
      expect(result.content[0].text).toContain("first line");
      expect(result.content[0].text).toContain("second line");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("r shows the full plan and returns to the gate", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, tools, appended, editorCalls, ctx } = harness(cwd, {
        hasUI: true,
        input: ["r", GO],
        editors: [undefined],
      });
      await hooks.get("session_start")!({}, ctx);
      const result = await tools.get("dev_request_approval").execute("id", { task: "add-widget" }, undefined, undefined, ctx);
      expect(result.content[0].text).toContain("Approved add-widget");
      expect(editorCalls[0]?.prefill).toContain("Original Ask");
      expect(appended).toHaveLength(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("treats a cancelled prompt as no approval", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, tools, appended, ctx } = harness(cwd, { hasUI: true, input: [undefined] });
      await hooks.get("session_start")!({}, ctx);
      const result = await tools.get("dev_request_approval").execute("id", { task: "add-widget" }, undefined, undefined, ctx);
      expect(result.content[0].text).toContain("cancelled");
      expect(appended).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("/dev-approve routes feedback back to the agent", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, commands, sent, ctx } = harness(cwd, {
        hasUI: true,
        input: ["t: narrow it to the footer only"],
      });
      await hooks.get("session_start")!({}, ctx);
      await commands.get("dev-approve").handler("add-widget", ctx);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain("narrow it to the footer only");
      expect(sent[0]).toContain("not approved");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("/dev-approve starts the implementation after g", async () => {
    const cwd = tempRepo("add-widget");
    try {
      const { hooks, commands, sent, ctx } = harness(cwd, { hasUI: true, input: [GO] });
      await hooks.get("session_start")!({}, ctx);
      await commands.get("dev-approve").handler("add-widget", ctx);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain("/startWork");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("single-outcome anchoring", () => {
  async function approved() {
    const cwd = tempRepo("add-widget");
    const instance = harness(cwd, { hasUI: true, input: [GO] });
    await instance.hooks.get("session_start")!({}, instance.ctx);
    await instance.tools.get("dev_request_approval").execute("id", { task: "add-widget" }, undefined, undefined, instance.ctx);
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
});

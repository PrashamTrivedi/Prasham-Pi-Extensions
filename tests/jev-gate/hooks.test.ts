import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jevGate, { stopPayload, toolResultPayload } from "../../extensions/jev-gate/index.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Register the extension against a fake Pi and hand back the hooks it installed. */
function registeredHooks(): Map<string, unknown> {
  const hooks = new Map<string, unknown>();
  const pi: any = {
    on: (name: string, handler: unknown) => hooks.set(name, handler),
    registerTool: () => {},
    registerCommand: () => {},
    appendEntry: () => {},
    sendMessage: () => {},
    sendUserMessage: () => {},
  };
  jevGate(pi);
  return hooks;
}

/** Register with a fake decision call, capturing every payload the adapter would see. */
function registeredWith(decide: (event: string, payload: any) => Promise<any>, mirrorRoot?: string) {
  const hooks = new Map<string, Function>();
  const pi: any = {
    on: (name: string, handler: Function) => hooks.set(name, handler),
    registerTool: () => {},
    registerCommand: () => {},
    appendEntry: () => {},
    sendMessage: () => {},
    sendUserMessage: () => {},
  };
  jevGate(pi, { decide, ...(mirrorRoot ? { mirrorRoot } : {}) });
  return hooks;
}

function fakeContext(options: { sessionFile?: string; branch?: any[] } = {}) {
  const notified: string[] = [];
  const ctx: any = {
    cwd: "/repo",
    sessionManager: {
      getSessionId: () => "s-1",
      getSessionFile: () => options.sessionFile,
      getBranch: () => options.branch ?? [],
    },
    ui: { notify: (message: string) => notified.push(message) },
  };
  return { ctx, notified };
}

describe("jev-gate ownership", () => {
  test("issues no tool_call decision — sandbox-dev is the single gate", () => {
    const hooks = registeredHooks();
    expect(hooks.has("tool_call")).toBe(false);
  });

  test("keeps the result and stop hooks", () => {
    const hooks = registeredHooks();
    expect(typeof hooks.get("tool_result")).toBe("function");
    expect(typeof hooks.get("agent_before_settle")).toBe("function");
  });
});

describe("jev-gate payloads", () => {
  test("a failed tool result carries tool.error, so failure-triage applies", () => {
    const payload = toolResultPayload(
      { toolName: "bash", input: { command: "false" }, content: [{ type: "text", text: "exit 1" }], isError: true },
      { sessionId: "s-1", cwd: "/repo", transcriptPath: "/tmp/t.jsonl" },
    );
    expect(payload.tool).toMatchObject({ kind: "shell", command: "false", output: "exit 1", error: "exit 1" });
    // A clean result keeps output only: web-search and semantic lint read output, never an error.
    const ok = toolResultPayload(
      { toolName: "read", input: { path: "/repo/a.ts" }, content: [{ type: "text", text: "ok" }] },
      { sessionId: "s-1", cwd: "/repo" },
    );
    expect(ok.tool.kind).toBe("read");
    expect(ok.tool.error).toBeUndefined();
  });

  test("the stop payload mirrors Claude's stop_hook_active", () => {
    expect(stopPayload({ sessionId: "s", cwd: "/r", lastAssistantText: "done", reentry: true }).reentry).toBe(true);
    expect(stopPayload({ sessionId: "s", cwd: "/r", lastAssistantText: "done", reentry: false }).reentry).toBe(false);
  });

  test("a failed result reaches the adapter as tool_failure and a clean one as post_tool", async () => {
    const calls: Array<{ event: string; payload: any }> = [];
    const hooks = registeredWith((event, payload) => { calls.push({ event, payload }); return Promise.resolve({}); });
    const { ctx } = fakeContext();
    await hooks.get("tool_result")!(
      { toolName: "bash", input: { command: "false" }, content: [{ type: "text", text: "exit 1" }], isError: true }, ctx);
    await hooks.get("tool_result")!(
      { toolName: "read", input: { path: "/repo/a.ts" }, content: [{ type: "text", text: "ok" }], isError: false }, ctx);
    expect(calls.map((call) => call.event)).toEqual(["tool_failure", "post_tool"]);
    expect(calls[0]!.payload.tool.error).toBe("exit 1");
    expect(calls[1]!.payload.tool.error).toBeUndefined();
  });

  test("one stop continues once, then reentry stops decisions from looping", async () => {
    const payloads: any[] = [];
    const hooks = registeredWith((event, payload) => {
      payloads.push({ event, ...payload });
      return Promise.resolve(payloads.length === 1 ? { cont: { reason: "finish the work" } } : { notify: ["settled"] });
    });
    const { ctx } = fakeContext();
    const first = await hooks.get("agent_before_settle")!({ outcome: "completed" }, ctx);
    expect(first.continue).toBe(true);
    expect(first.entries.at(-1).content).toBe("finish the work");
    expect(payloads[0].reentry).toBe(false);
    // The continuation settles: same stop chain, so reentry is set and nothing continues again.
    const second = await hooks.get("agent_before_settle")!({ outcome: "completed" }, ctx);
    expect(second.continue).toBeUndefined();
    expect(payloads[1].reentry).toBe(true);
    expect(second.entries[0].content).toBe("settled");
    // A fresh turn starts a fresh chain.
    await hooks.get("agent_before_settle")!({ outcome: "completed" }, ctx);
    expect(payloads[2].reentry).toBe(false);
    // A non-completed settle is not a stop.
    expect(await hooks.get("agent_before_settle")!({ outcome: "aborted" }, ctx)).toBeUndefined();
    expect(payloads).toHaveLength(3);
  });

  test("the payload points at a Claude-shaped mirror with usage tokens", async () => {
    const root = mkdtempSync(join(tmpdir(), "jev-mirror-"));
    const source = join(root, "session.jsonl");
    writeFileSync(source, `${JSON.stringify({ type: "message", message: { role: "user", content: "first ask" } })}\n${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { input: 120_000, output: 10, cacheRead: 5_000 } } })}\n`);
    const payloads: any[] = [];
    const hooks = registeredWith((event, payload) => { payloads.push({ event, ...payload }); return Promise.resolve({}); }, root);
    const { ctx } = fakeContext({ sessionFile: source });
    try {
      await hooks.get("agent_before_settle")!({ outcome: "completed" }, ctx);
      const path = payloads[0].transcriptPath as string;
      expect(path.startsWith(root)).toBe(true);
      const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
      const assistant = JSON.parse(lines[1]!);
      // compact-advisor reads these names; Pi writes input/cacheRead.
      expect(assistant.message.usage.input_tokens).toBe(120_000);
      expect(assistant.message.usage.cache_read_input_tokens).toBe(5_000);
      expect(lines[0]).toContain("first ask");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

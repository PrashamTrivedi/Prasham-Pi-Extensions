import { afterEach, describe, expect, test } from "bun:test";
import btw, { isSubagent } from "../../extensions/btw/index.ts";

function harness() {
  const commands = new Map<string, { description?: string; handler: (args: string, ctx: unknown) => unknown }>();
  const hooks = new Map<string, Function>();
  const pi = {
    registerCommand: (name: string, definition: { description?: string; handler: (args: string, ctx: unknown) => unknown }) => {
      commands.set(name, definition);
    },
    on: (name: string, handler: Function) => {
      hooks.set(name, handler);
    },
  };
  btw(pi as never);
  return { commands, hooks };
}

function context(overrides: Record<string, unknown> = {}) {
  const notices: Array<{ text: string; kind?: string }> = [];
  const ctx = {
    mode: "tui",
    hasUI: true,
    sessionManager: { buildSessionProjection: () => ({ messages: [] }) },
    modelRegistry: {},
    model: undefined,
    scopedModels: [],
    ui: {
      notify: (text: string, kind?: string) => notices.push({ text, kind }),
      custom: () => {
        throw new Error("custom screen must not open in this test");
      },
      setEditorText: () => {},
      getEditorText: () => "",
      setStatus: () => {},
      setWidget: () => {},
    },
    ...overrides,
  };
  return { ctx, notices };
}

afterEach(() => {
  delete process.env.PI_FABRIC_AGENT;
});

describe("isSubagent", () => {
  test("is true only when the Fabric worker marker is present", () => {
    expect(isSubagent({})).toBe(false);
    expect(isSubagent({ PI_FABRIC_AGENT: "agent-id" })).toBe(true);
  });
});

describe("/btw registration", () => {
  test("registers in the main chat", () => {
    const { commands } = harness();
    expect(commands.has("btw")).toBe(true);
    expect(commands.get("btw")?.description).toContain("side chat");
  });

  test("does not register inside a Fabric worker", () => {
    process.env.PI_FABRIC_AGENT = "worker";
    const { commands } = harness();
    expect(commands.size).toBe(0);
  });
});

describe("/btw handler", () => {
  test("non-TUI modes notify instead of opening a screen", async () => {
    const { commands } = harness();
    const { ctx, notices } = context({ mode: "print", hasUI: true });
    await commands.get("btw")!.handler("", ctx);
    expect(notices[0]?.text).toContain("interactive TUI");
  });

  test("/btw send without a side chat notifies", async () => {
    const { commands } = harness();
    const { ctx, notices } = context();
    await commands.get("btw")!.handler("send", ctx);
    expect(notices[0]?.text).toContain("No BTW side chat");
  });

  test("/btw help explains the keys", async () => {
    const { commands } = harness();
    const { ctx, notices } = context();
    await commands.get("btw")!.handler("help", ctx);
    expect(notices[0]?.text).toContain("alt+s");
  });

  test("an empty chat does not open a window", async () => {
    const { commands } = harness();
    const { ctx, notices } = context();
    await commands.get("btw")!.handler("", ctx);
    expect(notices[0]?.text).toContain("at least one message");
  });
});

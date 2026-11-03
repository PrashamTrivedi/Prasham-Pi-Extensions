import { describe, expect, test } from "bun:test";
import jevGate from "../../extensions/jev-gate/index.ts";

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

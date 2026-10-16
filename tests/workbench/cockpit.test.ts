import { describe, expect, test } from "bun:test";
import { buildCockpitLines } from "../../extensions/workbench/cockpit.ts";

describe("buildCockpitLines", () => {
  test("shows context, tokens, usage and decisions", () => {
    const lines = buildCockpitLines({
      percent: 62,
      tokens: 1500,
      usageText: "opencode-go: rolling 2%",
      decisions: ["shell-safety · Bash", "read-budget · Read"],
    });
    expect(lines.join("\n")).toContain("context  62%");
    expect(lines.join("\n")).toContain("tokens   1.5k");
    expect(lines.join("\n")).toContain("opencode-go: rolling 2%");
    expect(lines.join("\n")).toContain("shell-safety · Bash");
  });

  test("surfaces a missing ledger server instead of throwing", () => {
    const lines = buildCockpitLines({ percent: null, tokens: 0, decisions: [], ledgerError: "Unable to connect" });
    expect(lines.join("\n")).toContain("context  ?");
    expect(lines.join("\n")).toContain("ledger: Unable to connect");
  });

  test("shows (none) when there are no decisions and no error", () => {
    const lines = buildCockpitLines({ percent: 10, tokens: 0, decisions: [] });
    expect(lines.join("\n")).toContain("(none)");
    expect(lines.join("\n")).toContain("usage    (unavailable)");
  });
});

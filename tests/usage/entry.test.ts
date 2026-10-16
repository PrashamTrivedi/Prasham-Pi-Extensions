import { describe, expect, test } from "bun:test";
import { missingAuthMessage, shouldReport } from "../../extensions/usage/index.ts";

describe("shouldReport", () => {
  test("reports only opencode-go", () => {
    expect(shouldReport("opencode-go")).toBe(true);
    expect(shouldReport("cloudflare-workers-ai")).toBe(false);
    expect(shouldReport(undefined)).toBe(false);
  });
});

describe("missingAuthMessage", () => {
  test("names the provider, the env var, and a fix", () => {
    const message = missingAuthMessage("opencode-go", "OPENCODE_API_KEY");
    expect(message).toContain("opencode-go");
    expect(message).toContain("OPENCODE_API_KEY");
  });
});

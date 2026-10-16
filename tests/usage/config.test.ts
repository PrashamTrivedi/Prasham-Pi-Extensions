import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_USAGE_CONFIG, loadUsageConfig } from "../../extensions/usage/config.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-mods-usage-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeConfig(dir: string, value: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "usage.config.json"), JSON.stringify(value));
}

describe("loadUsageConfig", () => {
  test("falls back to defaults when no file exists", () => {
    const cwd = join(root, "cwd");
    mkdirSync(cwd, { recursive: true });
    const loaded = loadUsageConfig({ cwd, agentDir: join(root, "agent") });
    expect(loaded.config).toEqual(DEFAULT_USAGE_CONFIG);
    expect(loaded.errors).toEqual([]);
  });

  test("project .pi overrides and merges a partial opencodeGo section", () => {
    const cwd = join(root, "cwd");
    writeConfig(join(cwd, ".pi"), { refreshMinutes: 30, opencodeGo: { keyEnv: "MY_KEY" } });
    const loaded = loadUsageConfig({ cwd, agentDir: join(root, "agent") });
    expect(loaded.config.refreshMinutes).toBe(30);
    expect(loaded.config.opencodeGo.keyEnv).toBe("MY_KEY");
    expect(loaded.config.opencodeGo.baseUrl).toBe(DEFAULT_USAGE_CONFIG.opencodeGo.baseUrl);
  });

  test("clamps refreshMinutes into range", () => {
    const cwd = join(root, "cwd");
    writeConfig(cwd, { refreshMinutes: 0 });
    expect(loadUsageConfig({ cwd, agentDir: join(root, "agent") }).config.refreshMinutes).toBe(1);
    writeConfig(cwd, { refreshMinutes: 9999 });
    expect(loadUsageConfig({ cwd, agentDir: join(root, "agent") }).config.refreshMinutes).toBe(240);
  });

  test("malformed JSON is reported, not thrown, and defaults win", () => {
    const cwd = join(root, "cwd");
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, "usage.config.json"), "{ not json");
    const loaded = loadUsageConfig({ cwd, agentDir: join(root, "agent") });
    expect(loaded.config).toEqual(DEFAULT_USAGE_CONFIG);
    expect(loaded.errors).toHaveLength(1);
  });
});

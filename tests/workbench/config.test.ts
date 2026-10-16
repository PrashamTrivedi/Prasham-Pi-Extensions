import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_WORKBENCH_CONFIG, loadWorkbenchConfig } from "../../extensions/workbench/config.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-mods-workbench-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(dir: string, value: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "workbench.config.json"), JSON.stringify(value));
}

describe("loadWorkbenchConfig", () => {
  test("defaults when no file exists", () => {
    const cwd = join(root, "cwd");
    mkdirSync(cwd, { recursive: true });
    const loaded = loadWorkbenchConfig({ cwd, agentDir: join(root, "agent") });
    expect(loaded.config).toEqual(DEFAULT_WORKBENCH_CONFIG);
  });

  test("merges partial sections and keeps other defaults", () => {
    const cwd = join(root, "cwd");
    write(join(cwd, ".pi"), { pet: { theme: "barca" }, cockpit: { enabled: false } });
    const loaded = loadWorkbenchConfig({ cwd, agentDir: join(root, "agent") });
    expect(loaded.config.pet.theme).toBe("barca");
    expect(loaded.config.pet.enabled).toBe(true);
    expect(loaded.config.cockpit.enabled).toBe(false);
    expect(loaded.config.statusline).toEqual(DEFAULT_WORKBENCH_CONFIG.statusline);
  });

  test("malformed JSON is reported, not thrown", () => {
    const cwd = join(root, "cwd");
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, "workbench.config.json"), "{ nope");
    const loaded = loadWorkbenchConfig({ cwd, agentDir: join(root, "agent") });
    expect(loaded.config).toEqual(DEFAULT_WORKBENCH_CONFIG);
    expect(loaded.errors).toHaveLength(1);
  });
});

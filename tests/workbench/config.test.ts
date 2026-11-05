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

  test("cockpit defaults to compact and clamps maxRows", () => {
    const cwd = join(root, "cwd");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    expect(loadWorkbenchConfig({ cwd, agentDir: join(root, "agent") }).config.cockpit).toEqual({ enabled: true, mode: "compact", maxRows: 8 });
    write(join(cwd, ".pi"), { cockpit: { mode: "full", maxRows: 99 } });
    const loaded = loadWorkbenchConfig({ cwd, agentDir: join(root, "agent") });
    expect(loaded.config.cockpit.mode).toBe("full");
    expect(loaded.config.cockpit.maxRows).toBe(30);
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

describe("hud / deploy / decorate / pet parity flags", () => {
  test("default on, clamped poll interval, bad types fall back", () => {
    const cwd = join(root, "cwd");
    write(join(cwd, ".pi"), {
      hud: { pollSec: 999 },
      deploy: { enabled: false },
      decorate: { enabled: "no" },
      pet: { art: false, signOff: 1 },
    });
    const { config } = loadWorkbenchConfig({ cwd, agentDir: join(root, "agent") });
    expect(config.hud).toEqual({ enabled: true, pollSec: 60 });
    expect(config.deploy.enabled).toBe(false);
    expect(config.decorate.enabled).toBe(true);
    expect(config.pet.art).toBe(false);
    expect(config.pet.signOff).toBe(true);
    expect(config.pet.lines).toBe(true);
  });
});

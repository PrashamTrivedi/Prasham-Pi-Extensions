import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clamp,
  isFiniteNumber,
  isStringArray,
  loadConfig,
  objectValidator,
} from "../../extensions/shared/config.ts";

const defaults = { budget: 8, theme: "auto", badges: true };
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-mods-config-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(dir: string, value: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "workbench.config.json"), JSON.stringify(value));
}

describe("loadConfig", () => {
  test("returns defaults when no files exist", () => {
    const cwd = join(root, "cwd");
    mkdirSync(cwd, { recursive: true });
    const loaded = loadConfig("workbench", { defaults, cwd, agentDir: join(root, "agent") });
    expect(loaded.config).toEqual(defaults);
    expect(loaded.sources).toEqual([]);
    expect(loaded.errors).toEqual([]);
  });

  test("resolves lowest to highest: extension < agent < cwd < .pi", () => {
    const cwd = join(root, "cwd");
    mkdirSync(cwd, { recursive: true });
    write(join(root, "ext"), { budget: 1 });
    write(join(root, "agent"), { budget: 2 });
    write(cwd, { budget: 3 });
    write(join(cwd, ".pi"), { budget: 4 });
    const loaded = loadConfig("workbench", {
      defaults,
      cwd,
      agentDir: join(root, "agent"),
      extensionDir: join(root, "ext"),
    });
    expect(loaded.config.budget).toBe(4);
    expect(loaded.config.theme).toBe("auto");
    expect(loaded.sources).toHaveLength(4);
  });

  test("malformed JSON is reported and ignored, not fatal", () => {
    const cwd = join(root, "cwd");
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, "workbench.config.json"), "{ not json");
    const loaded = loadConfig("workbench", { defaults, cwd, agentDir: join(root, "agent") });
    expect(loaded.config).toEqual(defaults);
    expect(loaded.errors).toHaveLength(1);
  });

  test("a non-object payload is rejected", () => {
    const cwd = join(root, "cwd");
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, "workbench.config.json"), JSON.stringify([1, 2, 3]));
    const loaded = loadConfig("workbench", { defaults, cwd, agentDir: join(root, "agent") });
    expect(loaded.config).toEqual(defaults);
    expect(loaded.errors).toHaveLength(1);
  });

  test("validate rejects a wrong type without throwing", () => {
    const cwd = join(root, "cwd");
    write(cwd, { budget: "nope" });
    const validate = objectValidator({ budget: isFiniteNumber });
    const loaded = loadConfig("workbench", { defaults, cwd, agentDir: join(root, "agent"), validate });
    expect(loaded.config).toEqual(defaults);
    expect(loaded.errors).toHaveLength(1);
  });
});

describe("clamp and guards", () => {
  test("clamp bounds values and normalizes non-finite input", () => {
    expect(clamp(5, 1, 10)).toBe(5);
    expect(clamp(-3, 1, 10)).toBe(1);
    expect(clamp(99, 1, 10)).toBe(10);
    expect(clamp(Number.NaN, 1, 10)).toBe(1);
  });

  test("isStringArray", () => {
    expect(isStringArray(["a", "b"])).toBe(true);
    expect(isStringArray(["a", 1])).toBe(false);
    expect(isStringArray("a")).toBe(false);
  });
});

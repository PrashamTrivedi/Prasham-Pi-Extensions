import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildChildArgs, capturePatch, effectiveRule, requestedRule, resolveConfig } from "../../extensions/fabric/index.ts";

const temporary: string[] = [];
const temp = () => { const path = mkdtempSync(join(tmpdir(), "fabric-test-")); temporary.push(path); return path; };
afterEach(() => { while (temporary.length) rmSync(temporary.pop()!, { recursive: true, force: true }); });

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" }).trim();
}

test("config resolution is portable, ordered, and strict", () => {
  const home = temp();
  const legacy = join(temp(), "config.json");
  writeFileSync(legacy, JSON.stringify({ maxActiveAgents: 2, models: { low: { id: "provider/low", rank: 1 } } }));
  expect(resolveConfig({}, home, legacy).source).toBe("legacy");

  const user = join(home, ".pi", "agent", "pi-fabric.config.json");
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(user, JSON.stringify({ maxActiveAgents: 3, models: {} }));
  expect(resolveConfig({}, home, legacy)).toMatchObject({ source: "user", path: user, config: { maxActiveAgents: 3 } });

  const explicit = join(temp(), "custom.json");
  writeFileSync(explicit, JSON.stringify({ maxActiveAgents: 4, models: { top: { id: "p/top", rank: 9, description: "top" } } }));
  expect(resolveConfig({ PI_FABRIC_CONFIG: explicit }, home, legacy)).toMatchObject({ source: "env", path: explicit, config: { maxActiveAgents: 4 } });
  writeFileSync(explicit, "{");
  expect(() => resolveConfig({ PI_FABRIC_CONFIG: explicit }, home, legacy)).toThrow(/Invalid JSON.*custom\.json/);
  expect(() => resolveConfig({ PI_FABRIC_CONFIG: join(home, "missing") }, home, legacy)).toThrow(/Unable to read Pi Fabric config/);
});

test("empty hierarchy permits only the exact current model; configured ranks permit same or lower", () => {
  const empty = { maxActiveAgents: 6, models: {} };
  expect(effectiveRule(empty, "provider/current")?.[1].id).toBe("provider/current");
  expect(requestedRule(empty, "provider/current", "provider/current")?.[1].rank).toBe(0);
  expect(requestedRule(empty, "provider/current", "current")).toBeUndefined();

  const configured = { maxActiveAgents: 6, models: { high: { id: "p/high", rank: 2 }, low: { id: "p/low", rank: 1 } } };
  const caller = effectiveRule(configured, "p/high")!;
  const child = requestedRule(configured, "p/high", "low")!;
  expect(caller[1].rank).toBeGreaterThanOrEqual(child[1].rank);
  expect(requestedRule(configured, "p/high", "high")?.[1].id).toBe("p/high");
});

test("child args disable discovery and explicitly load the exact Fabric entry", () => {
  const entry = resolve("some/project/node_modules/pkg/extensions/fabric/index.ts");
  const args = buildChildArgs(entry, "provider/model", "do work");
  expect(args).toEqual(["-p", "--no-session", "--approve", "--no-extensions", "--extension", entry, "--model", "provider/model", "--", "do work"]);
  expect(args.filter(value => value === "--extension")).toHaveLength(1);
});

test("patch capture includes committed and untracked changes without changing the worker index", () => {
  const repo = temp();
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "fabric@example.invalid"]);
  git(repo, ["config", "user.name", "Fabric Test"]);
  writeFileSync(join(repo, "tracked.txt"), "base\n");
  git(repo, ["add", "tracked.txt"]); git(repo, ["commit", "-qm", "base"]);
  const baseline = git(repo, ["rev-parse", "HEAD"]);

  writeFileSync(join(repo, "tracked.txt"), "committed change\n");
  git(repo, ["add", "tracked.txt"]); git(repo, ["commit", "-qm", "worker commit"]);
  writeFileSync(join(repo, "new file.txt"), "untracked payload\n");
  writeFileSync(join(repo, "staged.txt"), "staged payload\n");
  git(repo, ["add", "staged.txt"]);
  const indexBefore = readFileSync(join(repo, ".git", "index"));

  const patch = capturePatch(repo, baseline);
  expect(patch).toContain("committed change");
  expect(patch).toContain("new file.txt");
  expect(patch).toContain("untracked payload");
  expect(patch).toContain("staged.txt");
  expect(readFileSync(join(repo, ".git", "index")).equals(indexBefore)).toBe(true);
});

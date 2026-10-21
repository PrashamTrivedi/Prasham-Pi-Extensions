import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildChildArgs, capturePatch, effectiveRule, isGone, liveAgents, readSessionChunk, readTranscript, reconcileRootConfig, requestedRule, resolveConfig, resolveSessionFile, IDLE_GONE_MS, type FabricConfig, type FabricState } from "../../extensions/fabric/index.ts";

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

test("models absent from the hierarchy are unrestricted in both directions", () => {
  const configured = { maxActiveAgents: 6, models: { high: { id: "p/high", rank: 2 }, low: { id: "p/low", rank: 1 } } };
  // An unrecorded caller can delegate to any model.
  const unrecordedCaller = effectiveRule(configured, "p/mystery")!;
  expect(unrecordedCaller[1]).toMatchObject({ id: "p/mystery", rank: Number.MAX_SAFE_INTEGER, description: "unrecorded" });
  expect(requestedRule(configured, "p/mystery", "high")?.[1].rank).toBeLessThanOrEqual(unrecordedCaller[1].rank);
  // An unrecorded child can be spawned by any caller.
  const unrecordedChild = requestedRule(configured, "p/low", "p/mystery")!;
  expect(unrecordedChild[1]).toMatchObject({ id: "p/mystery", rank: 0, description: "unrecorded" });
  expect(unrecordedChild[1].rank).toBeLessThanOrEqual(effectiveRule(configured, "p/low")![1].rank);
  // An empty caller model still resolves to nothing rather than an unranked rule.
  expect(effectiveRule(configured, "")).toBeUndefined();
});

test("a restored root adopts an edited hierarchy and keeps its agents", () => {
  const before: FabricConfig = { maxActiveAgents: 6, models: {} };
  const after: FabricConfig = { maxActiveAgents: 6, models: { high: { id: "p/high", rank: 2 } } };
  const state: FabricState = { rootId: "root", repo: "/repo", createdAt: "t", config: before, agents: {} };
  expect(reconcileRootConfig(state, before)).toBe(state);
  const updated = reconcileRootConfig(state, after);
  expect(updated.config).toEqual(after);
  expect(updated).toMatchObject({ rootId: "root", repo: "/repo", createdAt: "t", agents: {} });
});

test("child args persist a session the parent can replay, and stay ephemeral without one", () => {
  const entry = resolve("some/project/node_modules/pkg/extensions/fabric/index.ts");
  const args = buildChildArgs(entry, "provider/model", "do work", { dir: "/tmp/sessions", id: "agent-1" });
  expect(args).toEqual(["-p", "--session-dir", "/tmp/sessions", "--session-id", "agent-1", "--approve", "--no-extensions", "--extension", entry, "--model", "provider/model", "--", "do work"]);
  expect(args.filter(value => value === "--extension")).toHaveLength(1);
  expect(args).not.toContain("--no-session");
  expect(buildChildArgs(entry, "provider/model", "do work")).toContain("--no-session");
});

test("a run's saved session is found by id suffix, newest first, and a missing dir is harmless", () => {
  const dir = temp();
  writeFileSync(join(dir, "2026-01-01T00-00-00-000Z_older.jsonl"), "{}");
  writeFileSync(join(dir, "2026-01-01T00-00-00-000Z_agent-a.jsonl"), "{\"old\":true}");
  writeFileSync(join(dir, "2026-01-02T00-00-00-000Z_agent-a.jsonl"), "{\"new\":true}");
  writeFileSync(join(dir, "2026-01-03T00-00-00-000Z_agent-ab.jsonl"), "{}");
  expect(resolveSessionFile(dir, "agent-a")).toBe(join(dir, "2026-01-02T00-00-00-000Z_agent-a.jsonl"));
  expect(resolveSessionFile(dir, "missing")).toBeUndefined();
  expect(resolveSessionFile(join(dir, "nope"), "agent-a")).toBeUndefined();
});

test("an agent that stays idle ten minutes is gone, and only terminal agents can go", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  expect(IDLE_GONE_MS).toBe(10 * 60_000);
  expect(isGone({ status: "done", finishedAt: at(11) }, now)).toBe(true);
  expect(isGone({ status: "done", finishedAt: at(9) }, now)).toBe(false);
  expect(isGone({ status: "error", finishedAt: at(10) }, now)).toBe(false);
  expect(isGone({ status: "cancelled", finishedAt: at(30) }, now)).toBe(true);
  // Running, queued, waiting and freshly finished agents never disappear.
  expect(isGone({ status: "running", finishedAt: at(90) }, now)).toBe(false);
  expect(isGone({ status: "queued" }, now)).toBe(false);
  expect(isGone({ status: "done" }, now)).toBe(false);
  const agents = [
    { id: "old", status: "done" as const, finishedAt: at(11) },
    { id: "fresh", status: "done" as const, finishedAt: at(1) },
    { id: "busy", status: "running" as const, finishedAt: at(60) },
  ];
  expect(liveAgents(agents, now).map((agent) => agent.id)).toEqual(["fresh", "busy"]);
  // The sweep is display-only: the state itself is untouched.
  expect(agents).toHaveLength(3);
});

test("transcript reads are bounded and explain truncation or failure", () => {
  const dir = temp();
  const small = join(dir, "small.jsonl");
  writeFileSync(small, "{\"type\":\"session\"}\n");
  expect(readTranscript(small)).toEqual({ text: "{\"type\":\"session\"}\n" });
  const large = join(dir, "large.jsonl");
  writeFileSync(large, "x".repeat(50));
  const truncated = readTranscript(large, 10);
  expect(truncated.text).toHaveLength(10);
  expect(truncated.notice).toContain("truncated");
  const missing = readTranscript(join(dir, "missing.jsonl"));
  expect(missing.text).toBe("");
  expect(missing.notice).toContain("Unable to read");
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

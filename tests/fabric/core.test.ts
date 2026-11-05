import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { altJumpAllowed, altJumpConflicts, buildChildArgs, capturePatch, effectiveRule, isGone, liveAgents, matchAgent, onPath, readChatPad, openTranscriptInEditor, readSessionChunk, readTranscript, reconcileRootConfig, requestedRule, resolveConfig, resolveSessionFile, IDLE_GONE_MS, type FabricConfig, type FabricState } from "../../extensions/fabric/index.ts";

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
  // A failure stays until its transcript is opened, however long ago it stopped.
  expect(isGone({ status: "error", finishedAt: at(10) }, now)).toBe(false);
  expect(isGone({ status: "error", finishedAt: at(10), dismissed: true }, now)).toBe(true);
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

test("transcript reads replay whole lines, keep the tail when capped, and resume tailing", () => {
  const dir = temp();
  const small = join(dir, "small.jsonl");
  writeFileSync(small, "{\"type\":\"session\"}\n");
  const complete = readTranscript(small);
  expect(complete.text).toBe("{\"type\":\"session\"}\n");
  expect(complete.live).toBe(true);
  expect(complete.offset).toBe(Buffer.byteLength(complete.text));
  // A half-written trailing line is not replayed, and the cursor stays at its start.
  writeFileSync(small, "{\"type\":\"session\"}\n{\"half\":1");
  const half = readTranscript(small);
  expect(half.text).toBe("{\"type\":\"session\"}\n");
  expect(half.offset).toBe(Buffer.byteLength(half.text));
  // Above the cap the head is dropped (not the tail), on a whole-line boundary.
  const large = join(dir, "large.jsonl");
  const lines = ["a", "b", "c"].map((text) => `{"t":"${text.repeat(10)}"}\n`).join("");
  writeFileSync(large, lines);
  const tailed = readTranscript(large, 45);
  expect(tailed.text).toBe(`{"t":"${"b".repeat(10)}"}\n{"t":"${"c".repeat(10)}"}\n`);
  expect(tailed.notice).toContain("Showing the last");
  expect(tailed.live).toBe(true);
  expect(tailed.offset).toBe(Buffer.byteLength(lines));
  const missing = readTranscript(join(dir, "missing.jsonl"));
  expect(missing.text).toBe("");
  expect(missing.notice).toContain("Unable to read");
  expect(missing.live).toBe(false);
});

test("the transcript uses Pi's chat padding from the agent settings", () => {
  const dir = temp();
  const home = join(dir, "home");
  expect(readChatPad({}, home)).toBe(1);
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ outputPad: 2 }));
  expect(readChatPad({ PI_CODING_AGENT_DIR: agentDir }, home)).toBe(2);
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ outputPad: 99 }));
  expect(readChatPad({ PI_CODING_AGENT_DIR: agentDir }, home)).toBe(4);
  writeFileSync(join(agentDir, "settings.json"), "{oops");
  expect(readChatPad({ PI_CODING_AGENT_DIR: agentDir }, home)).toBe(1);
});

test("a transcript opens in the editor only when the command is on PATH", () => {
  const dir = temp();
  const empty = { PATH: join(dir, "empty") };
  expect(onPath("zed", empty)).toBe(false);
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const tool = join(bin, "zed");
  writeFileSync(tool, "#!/bin/sh\n", { mode: 0o755 });
  expect(onPath("zed", { PATH: bin })).toBe(true);
  expect(onPath(tool, empty)).toBe(true);
  expect(onPath(join(bin, "missing"), empty)).toBe(false);

  const out = join(dir, "outputs");
  const missing = openTranscriptInEditor({ dir: out, id: "agent-1", markdown: "# run\n" }, { PATH: bin, PI_FABRIC_EDITOR: "absent-editor" });
  expect(readFileSync(join(out, "agent-1.transcript.md"), "utf8")).toBe("# run\n");
  expect(missing).toContain("agent-1.transcript.md");
  expect(missing).toContain("not on PATH");
});

test("an agent fragment resolves by exact label, prefix, then substring", () => {
  const agents = [
    { id: "a1", label: "api-refactor" },
    { id: "a2", label: "rapid-check" },
    { id: "a3", label: "Salvage" },
  ];
  expect(matchAgent(agents, "api")?.id).toBe("a1");
  expect(matchAgent(agents, "API-REFACTOR")?.id).toBe("a1");
  expect(matchAgent(agents, "a2")?.id).toBe("a2");
  expect(matchAgent(agents, "pid")?.id).toBe("a2");   // substring beats nothing, prefix beats substring
  expect(matchAgent(agents, "salvage")?.id).toBe("a3");
  expect(matchAgent(agents, "")).toBeUndefined();
  expect(matchAgent(agents, "zzz")).toBeUndefined();
});

test("Alt+1..9 registers only when no keybinding claims those keys", () => {
  const dir = temp();
  const home = join(dir, "home");
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  expect(altJumpAllowed({}, home)).toBe(true);
  expect(altJumpAllowed({ PI_FABRIC_ALT_JUMP: "0" }, home)).toBe(false);
  expect(altJumpConflicts(["alt+1", "alt+2"], { a: "alt+9", b: ["alt+2", "ctrl+shift+n"] })).toEqual(["alt+2"]);
  expect(altJumpConflicts(["alt+1"], "not an object")).toEqual([]);
  const keybindings = join(agentDir, "keybindings.json");
  writeFileSync(keybindings, JSON.stringify({ "app.session.new": ["alt+1", "ctrl+shift+n"] }));
  expect(altJumpAllowed({ PI_CODING_AGENT_DIR: agentDir }, home)).toBe(false);
  writeFileSync(keybindings, JSON.stringify({ "app.session.new": "alt+left" }));
  expect(altJumpAllowed({ PI_CODING_AGENT_DIR: agentDir }, home)).toBe(true);
  // A broken keybindings file cannot prove the keys are free, so the feature stays off.
  writeFileSync(keybindings, "{oops");
  expect(altJumpAllowed({ PI_CODING_AGENT_DIR: agentDir }, home)).toBe(false);
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

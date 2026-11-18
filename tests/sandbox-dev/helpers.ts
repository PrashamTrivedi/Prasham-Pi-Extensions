import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sandboxDev, { jev } from "../../extensions/sandbox-dev/index.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PLAN = ["# Add widget", "", "## Original Ask", "Add a turn-count widget to the footer.", "", "## Complexity", "3"].join(
  "\n",
);

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export type HarnessOptions = {
  hasUI: boolean;
  confirm?: boolean;
  branch?: unknown[];
  jevDecision?: (eventName: string, payload: any) => Promise<any>;
  askJev?: (state: any, questions: any) => Promise<any>;
};

/**
 * The default decision-server answers: plan-safety questions fail closed (so the human gate is
 * presented), validator questions pass. Tests that need a failure pass their own stub.
 */
export function defaultAnswers(questions: Record<string, unknown>): { answers: Record<string, unknown>; model: string; inputTokens: number } {
  const answers: Record<string, unknown> = {};
  for (const id of Object.keys(questions ?? {})) {
    answers[id] = { type: "noul", noul: id === "not_run_matters" ? 0.1 : 0.9 };
  }
  if ("safe_autoproceed" in answers) {
    answers.safe_autoproceed = { type: "noul", noul: 0.1 };
    answers.irreversible = { type: "noul", noul: 0.9 };
    answers.scope_risk = { type: "noul", noul: 0.9 };
  }
  return { answers, model: "test", inputTokens: 0 };
}

export function harness(cwd: string, options: HarnessOptions = { hasUI: true }) {
  const hooks = new Map<string, Function>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const appended: Array<{ customType: string; data?: unknown }> = [];
  const notifications: string[] = [];
  const sent: string[] = [];
  const messages: Array<{ customType: string; content: string }> = [];
  const confirmCalls: string[] = [];
  const jevDecisionCalls: string[] = [];
  const askJevCalls: Array<{ state: any; questions: any }> = [];
  const branch = options.branch ?? [];

  const pi: any = {
    on: (name: string, handler: Function) => hooks.set(name, handler),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    appendEntry: (customType: string, data?: unknown) => appended.push({ customType, data }),
    sendMessage: (message: { customType: string; content: string }) => messages.push(message),
    sendUserMessage: (text: string) => sent.push(text),
  };

  const ctx: any = {
    cwd,
    mode: options.hasUI ? "tui" : "print",
    hasUI: options.hasUI,
    ui: {
      setStatus: () => {},
      notify: (message: string) => notifications.push(message),
      input: async () => undefined,
      select: async () => undefined,
      editor: async () => undefined,
      confirm: async (_title: string, message: string) => {
        confirmCalls.push(message);
        return options.confirm ?? false;
      },
    },
    sessionManager: { getBranch: () => branch, getSessionId: () => "test-session" },
  };

  // No subprocess, no network: stub the Jev bridge.
  jev.runJevDecision = options.jevDecision ?? (async () => ({ gate: { action: "ask", reason: "test: uncertain" } }));
  jev.askJev = options.askJev ?? (async (_state: any, questions: any) => defaultAnswers(questions));

  const baseRunDecision = jev.runJevDecision;
  jev.runJevDecision = async (eventName: string, payload: any) => {
    jevDecisionCalls.push(eventName);
    return baseRunDecision(eventName, payload);
  };
  const baseAskJev = jev.askJev;
  jev.askJev = async (state: any, questions: any) => {
    askJevCalls.push({ state, questions });
    return baseAskJev(state, questions);
  };

  sandboxDev(pi);
  return { hooks, tools, commands, appended, notifications, sent, messages, confirmCalls, jevDecisionCalls, askJevCalls, ctx };
}

/** A task directory without git: enough to present the gate and write goals. */
export function tempRepo(task: string): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-sandbox-dev-"));
  mkdirSync(join(cwd, "taskNotes", task), { recursive: true });
  writeFileSync(join(cwd, "taskNotes", task, "taskFindings.md"), PLAN);
  return cwd;
}

const REVIEW = ["# Review passes", "", "Pass 1: 2 findings", "Pass 2: 0 findings"].join("\n");

export type CompleteRepoOptions = {
  task?: string;
  /** Copy a prepared taskNotes/<task>/ directory (for example the `88-skills-commands-import` fixture). */
  fixtureTask?: string;
  /** Skip `git push`, to exercise the `pushed` miss. */
  noPush?: boolean;
  /** Mark the task as frontend or both, to exercise the artifacts list. */
  mode?: "backend" | "frontend" | "both";
};

/**
 * A repo that satisfies the complete-stage deterministic checks: artifacts, a conventional
 * one-line HEAD commit, a test file in `currentCommitHash..HEAD`, and a pushed branch.
 */
export function completeRepo(options: CompleteRepoOptions = {}): string {
  const task = options.task ?? "add-widget";
  const cwd = mkdtempSync(join(tmpdir(), "pi-sandbox-dev-repo-"));
  const dir = join(cwd, "taskNotes", task);
  mkdirSync(dir, { recursive: true });

  if (options.fixtureTask) {
    cpSync(join(import.meta.dir, "..", "fixtures", "taskNotes", options.fixtureTask), dir, { recursive: true });
  } else {
    writeFileSync(join(dir, "taskFindings.md"), PLAN);
  }
  writeFileSync(join(dir, "taskWalkthrough.md"), `# Walkthrough\n\nRun npm test to verify ${task}.\n`);
  writeFileSync(join(dir, "review-passes.md"), REVIEW);
  if (options.mode !== "frontend") writeFileSync(join(dir, "backend-validation.md"), "# Backend validation\n\nexit 0\n");
  if (options.mode === "frontend" || options.mode === "both") {
    writeFileSync(join(dir, "frontend-validation.md"), "# Frontend validation\n\nexit 0\n");
  }
  writeFileSync(join(dir, "currentCommitHash"), "0000000000000000000000000000000000000000\n");

  writeFileSync(join(cwd, "widget.ts"), "export const widget = 1;\n");
  git(cwd, ["init", "-q"]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "Test"]);
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-qm", "✨ feat: Start the task"]);

  writeFileSync(join(dir, "currentCommitHash"), `${git(cwd, ["rev-parse", "HEAD"])}\n`);
  mkdirSync(join(cwd, "tests"), { recursive: true });
  writeFileSync(
    join(cwd, "tests", "widget.test.ts"),
    ['import { expect, test } from "bun:test";', 'test("widget", () => expect(1).toBe(1));', ""].join("\n"),
  );
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-qm", "✅ test: Cover the widget"]);

  if (!options.noPush) {
    const origin = `${cwd}-origin.git`;
    git(cwd, ["init", "--bare", "-q", origin]);
    git(cwd, ["remote", "add", "origin", origin]);
    const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    git(cwd, ["push", "-q", "-u", "origin", branch]);
  }
  return cwd;
}

export function cleanup(cwd: string): void {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(`${cwd}-origin.git`, { recursive: true, force: true });
}

export function readTaskFile(cwd: string, task: string, file: string): string {
  return readFileSync(join(cwd, "taskNotes", task, file), "utf8");
}

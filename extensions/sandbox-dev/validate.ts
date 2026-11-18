/**
 * Stage validators for `sandbox-dev`: deterministic facts first (fs/git), then the decision
 * server for judgement. Nothing here writes, commits, pushes, or deploys; a failing check only
 * produces a named miss the model (or a waiver) has to answer.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  GOAL_FILE,
  JEV_PASS,
  NON_WAIVABLE,
  applyWaivers,
  criterionQuestions,
  criterionScores,
  extractCriteria,
  isOneLineConventionalCommit,
  requiredArtifacts,
  terminalReviewLine,
  type CriterionScore,
  type Miss,
  type Stage,
  type Waiver,
  type WorkMode,
} from "./stage.ts";
import { extractOutcome } from "./state.ts";

export type Answers = Record<string, unknown>;
export type AskJev = (state: unknown, questions: Record<string, unknown>) => Promise<{ answers?: Answers }>;

export interface CheckDeps {
  askJev: AskJev;
}

export interface Facts {
  goal: string;
  plan: string;
  outcome: string;
  diffStat: string;
  fileLines: Record<string, number>;
  headCommit: string;
  evidence: string;
  criteria: string[];
}

export interface WorkVerdict {
  ok: boolean;
  misses: Miss[];
}

export interface CompleteVerdict {
  ok: boolean;
  misses: Miss[];
  waived: Waiver[];
  criteria: CriterionScore[];
}

const GIT_TIMEOUT_MS = 5000;
const TASK_RE = /^[A-Za-z0-9._-]+$/;
const START_HASH_RE = /^[0-9a-f]{7,40}$/i;

/** Run git in `cwd`; `undefined` on any failure (not a repo, no commits, timeout). */
export function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function isGitRepo(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

function taskPath(task: string, file: string): string | undefined {
  return TASK_RE.test(task) ? `taskNotes/${task}/${file}` : undefined;
}

export function readTaskFile(cwd: string, task: string, file: string): string | undefined {
  const path = taskPath(task, file);
  if (!path) return undefined;
  try {
    return readFileSync(join(cwd, path), "utf8");
  } catch {
    return undefined;
  }
}

/** Byte size of a task file, 0 when missing. */
export function fileSize(cwd: string, task: string, file: string): number {
  const path = taskPath(task, file);
  if (!path) return 0;
  try {
    return statSync(join(cwd, path)).size;
  } catch {
    return 0;
  }
}

function lineCount(cwd: string, task: string, file: string): number {
  const text = readTaskFile(cwd, task, file);
  if (!text) return 0;
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  return lines.length;
}

/** Lines worth sending to the decision server as evidence (exit codes, test summaries). */
export function evidenceLines(text: string, limit = 40): string {
  const relevant =
    /(exit(?:ed)?\s*(?:code|status)?\s*[:= ]?\s*\d|\b\d+\s+(?:pass|fail|failed|failing)\b|tests?\b.*\b\d|\bPASS\b|\bFAIL\b|✓|✗|error TS\d+)/;
  const lines = (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && relevant.test(line));
  return lines.slice(-limit).join("\n").slice(0, 6000);
}

/** Facts the decision server judges: the goal, the diff, the artifacts, the echoed evidence. */
export function collectFacts(cwd: string, task: string, turns: string, mode: WorkMode): Facts {
  const plan = readTaskFile(cwd, task, "taskFindings.md") ?? "";
  const goal = readTaskFile(cwd, task, GOAL_FILE) ?? "";
  const fileLines: Record<string, number> = {};
  for (const file of ["taskFindings.md", GOAL_FILE, ...requiredArtifacts(mode)]) {
    fileLines[file] = lineCount(cwd, task, file);
  }
  // The work may be committed (completeWork commits at the end): judge the committed range since
  // currentCommitHash first, then anything still uncommitted, so neither is invisible.
  const start = (readTaskFile(cwd, task, "currentCommitHash") ?? "").trim();
  const committed = START_HASH_RE.test(start) ? git(cwd, ["diff", "--stat", `${start}..HEAD`]) : undefined;
  const working = git(cwd, ["diff", "--stat", "HEAD"]);
  const diffStat = [committed, working].filter((part): part is string => Boolean(part && part.trim())).join("\n");
  return {
    goal,
    plan,
    outcome: extractOutcome(plan),
    diffStat: diffStat || "(no diff since currentCommitHash)",
    fileLines,
    headCommit: git(cwd, ["log", "-1", "--format=%B"]) ?? "(no commit)",
    evidence: evidenceLines(turns),
    criteria: extractCriteria(plan),
  };
}

/** True for paths that look like test files, without needing a per-language convention. */
export function isTestFile(path: string): boolean {
  return /(^|\/)(?:__tests__|tests?)\//i.test(path) || /\.(?:test|spec)\.[a-z0-9]+$/i.test(path);
}

/**
 * Paths that resolve outside the repository root. Relative paths are resolved against `cwd`, so a
 * diff entry can never point the validator at a file elsewhere on disk.
 */
export function pathsOutsideRoot(cwd: string, paths: string[]): string[] {
  const root = resolve(cwd);
  const outside: string[] = [];
  for (const raw of paths) {
    const path = (raw ?? "").trim();
    if (!path) continue;
    if (isAbsolute(path)) {
      outside.push(path);
      continue;
    }
    const rel = relative(root, resolve(root, path));
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) outside.push(path);
  }
  return outside;
}

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0] ?? "";
}

/** fs/git checks only. The work stage checks the goal and the plan; complete checks artifacts. */
export function deterministicChecks(input: {
  cwd: string;
  task: string;
  stage: Stage;
  mode: WorkMode;
  goal: string;
  plan: string;
}): Miss[] {
  const misses: Miss[] = [];
  const planPath = `taskNotes/${input.task}/taskFindings.md`;
  if (!input.plan.trim()) misses.push({ check: "plan", detail: `${planPath} is missing or empty` });
  if (!input.goal.trim()) misses.push({ check: "goal", detail: `taskNotes/${input.task}/${GOAL_FILE} is missing or empty` });
  const repo = isGitRepo(input.cwd);
  if (input.stage !== "complete") return misses;

  for (const file of requiredArtifacts(input.mode)) {
    if (fileSize(input.cwd, input.task, file) === 0) {
      misses.push({ check: "files", detail: `taskNotes/${input.task}/${file} is missing or empty` });
    }
  }
  const review = readTaskFile(input.cwd, input.task, "review-passes.md");
  if (review?.trim() && !terminalReviewLine(review)) {
    misses.push({
      check: "review-passes",
      detail: "review-passes.md does not end with `0 findings` | `cap (5 passes)` | `escalated`",
    });
  }
  if (!repo) return misses;

  const message = git(input.cwd, ["log", "-1", "--format=%B"]);
  if (message === undefined) {
    misses.push({ check: "commit", detail: "no commit found (git log -1 failed)" });
  } else if (!isOneLineConventionalCommit(message)) {
    misses.push({
      check: "commit",
      detail: `HEAD commit is not a one-line conventional subject: ${firstLine(message).slice(0, 120)}`,
    });
  }

  const upstream = git(input.cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (!upstream) {
    misses.push({ check: "pushed", detail: "the branch has no upstream; push it" });
  } else {
    const count = git(input.cwd, ["rev-list", "--count", "@{u}..HEAD"]);
    const ahead = count === undefined ? undefined : Number(count);
    if (ahead === undefined || !Number.isFinite(ahead) || ahead > 0) {
      misses.push({
        check: "pushed",
        detail: ahead === undefined ? `could not compare HEAD with ${upstream}` : `the branch is ${ahead} commit(s) ahead of ${upstream}`,
      });
    }
  }

  const start = (readTaskFile(input.cwd, input.task, "currentCommitHash") ?? "").trim();
  if (!START_HASH_RE.test(start)) {
    misses.push({ check: "tests-in-diff", detail: "currentCommitHash is missing or not a commit hash" });
  } else {
    const changed = (git(input.cwd, ["diff", "--name-only", `${start}..HEAD`]) ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!changed.some(isTestFile)) {
      misses.push({
        check: "tests-in-diff",
        detail: `no test file changed between ${start.slice(0, 8)} and HEAD`,
      });
    }
  }

  const statusPaths = (git(input.cwd, ["status", "--porcelain", "--untracked-files=all"]) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim());
  const diffPaths = (git(input.cwd, ["diff", "--name-only", "HEAD"]) ?? "").split("\n").filter(Boolean);
  const outside = pathsOutsideRoot(input.cwd, [...statusPaths, ...diffPaths]);
  if (outside.length > 0) {
    misses.push({ check: "diff-in-repo", detail: `paths outside the repository root: ${outside.slice(0, 5).join(", ")}` });
  }
  return misses;
}

const WORK_QUESTIONS = {
  plan_followed: {
    type: "noul",
    instructions:
      "Given the approved plan and the goal, does the diff implement the plan faithfully without scope drift?",
  },
  work_finished: {
    type: "noul",
    instructions:
      "Given the goal, the diff, and the evidence, is the work described by the goal finished (including tests for the behavior)?",
  },
} as const;

const COMPLETE_QUESTIONS = {
  evidence_echoed: {
    type: "noul",
    instructions:
      "Do the transcript evidence lines show the build/typecheck/test commands' exit codes with 0 failures (not a claim without output)?",
  },
  plan_followed: {
    type: "noul",
    instructions:
      "Given the plan, the diff stat, the artifact line counts, and the HEAD commit, is the task completed and the plan followed?",
  },
  not_run_matters: {
    type: "noul",
    instructions:
      "Do any of the evidence items marked 'not run' matter for the Original Ask (i.e. the task cannot be considered done without them)?",
  },
} as const;

function jevState(facts: Facts, notRun: string[] = []): Record<string, unknown> {
  return {
    goal: facts.goal.slice(0, 6000),
    plan: facts.plan.slice(0, 6000),
    outcome: facts.outcome.slice(0, 4000),
    diffStat: facts.diffStat.slice(0, 3000),
    fileLines: facts.fileLines,
    headCommit: facts.headCommit.slice(0, 500),
    evidence: facts.evidence,
    criteria: facts.criteria,
    notRun,
  };
}

function noul(answers: Answers, id: string): number | undefined {
  const answer = answers[id] as { noul?: unknown } | undefined;
  return typeof answer?.noul === "number" ? answer.noul : undefined;
}

function below(score: number | undefined): string {
  return typeof score === "number" ? score.toFixed(2) : "no answer";
}

async function ask(
  deps: CheckDeps,
  state: Record<string, unknown>,
  questions: Record<string, unknown>,
): Promise<Answers | undefined> {
  try {
    const result = await deps.askJev(state, questions);
    return result?.answers ?? {};
  } catch {
    return undefined;
  }
}

/** Work stage: the plan's ask is implemented and finished, judged on facts + transcript. */
export async function validateWork(input: {
  cwd: string;
  task: string;
  mode: WorkMode;
  facts: Facts;
  deps: CheckDeps;
}): Promise<WorkVerdict> {
  const misses = deterministicChecks({
    cwd: input.cwd,
    task: input.task,
    stage: "work",
    mode: input.mode,
    goal: input.facts.goal,
    plan: input.facts.plan,
  });
  if (misses.length > 0) return { ok: false, misses };

  const answers = await ask(input.deps, jevState(input.facts), WORK_QUESTIONS);
  if (!answers) {
    return { ok: false, misses: [{ check: "semantics", detail: "decision server unavailable; staying in the work stage" }] };
  }
  const semantic: Miss[] = [];
  const followed = noul(answers, "plan_followed");
  if (followed === undefined || followed < JEV_PASS) {
    semantic.push({ check: "plan_followed", detail: `plan-follow confidence ${below(followed)} is below ${JEV_PASS}` });
  }
  const finished = noul(answers, "work_finished");
  if (finished === undefined || finished < JEV_PASS) {
    semantic.push({ check: "work_finished", detail: `work-finished confidence ${below(finished)} is below ${JEV_PASS}` });
  }
  return { ok: semantic.length === 0, misses: semantic };
}

/**
 * Complete stage: artifacts + one-line commit + pushed + tests in the diff, then the decision
 * server on echoed evidence, the plan, every acceptance criterion, and the not-run items.
 */
export async function validateComplete(input: {
  cwd: string;
  task: string;
  mode: WorkMode;
  stage: Stage;
  facts: Facts;
  notRun: string[];
  waive?: Waiver[];
  deps: CheckDeps;
}): Promise<CompleteVerdict> {
  const misses = deterministicChecks({
    cwd: input.cwd,
    task: input.task,
    stage: "complete",
    mode: input.mode,
    goal: input.facts.goal,
    plan: input.facts.plan,
  });
  if (input.stage !== "complete") {
    misses.push({ check: "stage", detail: `still in the ${input.stage} stage; call dev_stage { "to": "complete" } first` });
  }

  const criteria = input.facts.criteria;
  const questions: Record<string, unknown> = { ...COMPLETE_QUESTIONS, ...criterionQuestions(criteria) };
  if (input.notRun.length === 0) delete questions.not_run_matters;

  const answers = await ask(input.deps, jevState(input.facts, input.notRun), questions);
  const scores = answers ? criterionScores(criteria, answers) : criteria.map((criterion) => ({ criterion, score: 0 }));
  if (!answers) {
    misses.push({ check: "semantics", detail: "decision server unavailable; cannot pass" });
  } else {
    const echoed = noul(answers, "evidence_echoed");
    if (echoed === undefined || echoed < JEV_PASS) {
      misses.push({ check: "evidence", detail: `evidence-echoed confidence ${below(echoed)} is below ${JEV_PASS}` });
    }
    const followed = noul(answers, "plan_followed");
    if (followed === undefined || followed < JEV_PASS) {
      misses.push({ check: "plan_followed", detail: `plan-follow confidence ${below(followed)} is below ${JEV_PASS}` });
    }
    scores.forEach((score, index) => {
      if (score.score < JEV_PASS) {
        misses.push({ check: `criterion_${index + 1}`, detail: `criterion not evidenced: ${score.criterion}` });
      }
    });
    if (input.notRun.length > 0) {
      const matters = noul(answers, "not_run_matters");
      if (matters === undefined || matters >= JEV_PASS) {
        misses.push({ check: "not_run", detail: `not-run items may matter: ${input.notRun.join("; ")}` });
      }
    }
  }

  const waivable = (input.waive ?? []).filter((item) => !NON_WAIVABLE.has(item.check));
  const { remaining, waived } = applyWaivers(misses, waivable);
  return { ok: remaining.length === 0, misses: remaining, waived, criteria: scores };
}

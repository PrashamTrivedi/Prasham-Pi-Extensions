/**
 * Stage-goal logic for `sandbox-dev`: the goal IS the stage.
 *
 * One live goal at a time, written to `taskNotes/<task>/goal.md` and re-injected every turn. Every
 * function here is deterministic and side-effect free, so the template, parser, and validator
 * rules are testable without fs, git, or the decision server.
 */

import { extractSection } from "./state.ts";

export type Stage = "work" | "complete";
export type WorkMode = "backend" | "frontend" | "both";

export const GOAL_FILE = "goal.md";
export const STAGE_ENTRY = "sandbox-dev-stage";
export const STAGE_MESSAGE = "sandbox-dev-stage-switch";
/** Consecutive validator failures per stage before the run stops and asks a human. */
export const MAX_STAGE_FAILURES = 3;
/** Cap on acceptance criteria sent to the decision server (one question each). */
export const MAX_CRITERIA = 8;
/** A noul at or above this counts as a pass. */
export const JEV_PASS = 0.6;
/**
 * Misses a model-authored waiver cannot bypass: an unreachable decision server must never pass,
 * and skipping the work stage is exactly the failure the stage goals exist to prevent.
 */
export const NON_WAIVABLE = new Set(["semantics", "stage"]);

export interface Miss {
  check: string;
  detail: string;
}

export interface Waiver {
  check: string;
  reason: string;
}

export interface CriterionScore {
  criterion: string;
  score: number;
}

/** `/^\s*g(\s*:\s*(.*))?\s*$/is` from the spec: bare `g` dominates, `g: note` is optional. */
const GATE_RE = /^\s*g(?:\s*:\s*(.*))?\s*$/is;

/**
 * A gate reply is an approval only for `g` / `g: <note>`. `t: …`, `r`, and anything else leave
 * the gate open. The caller still checks that the input came from the human.
 */
export function parseGateReply(text: string): { approve: boolean; note?: string } {
  const match = GATE_RE.exec(text ?? "");
  if (!match) return { approve: false };
  const note = (match[1] ?? "").trim();
  return note ? { approve: true, note } : { approve: true };
}

export function taskFindingFile(task: string): string {
  return `taskNotes/${task}/taskFindings.md`;
}

/** The work goal written at `g` and re-injected until the stage switch. */
export function workGoal(input: { task: string; outcome: string; note?: string }): string {
  const plan = taskFindingFile(input.task);
  const lines = [
    `From ${plan}, implement the task mentioned below... with added tests, read and`,
    `follow approved plan from ${plan} rigorously. Once you are done, call`,
    `dev_stage { "to": "complete" }.`,
    "",
    "# Task",
    input.outcome.trim(),
  ];
  if (input.note && input.note.trim()) lines.push("", "## Human note", input.note.trim());
  return `${lines.join("\n")}\n`;
}

/** The complete goal written by `dev_stage` and re-injected until `dev_outcome_met`. */
export function completeGoal(input: {
  task: string;
  outcome: string;
  completeWorkPath: string;
  mode: WorkMode;
}): string {
  const plan = taskFindingFile(input.task);
  const lines = [
    "Verify that current software builds successfully without error, then verify task is completed",
    `and the plan is followed from ${plan}. If it is, verify new tests are added to`,
    "validate the behavior. And confirm all the files and evidence mentioned in the skill are",
    `present in the given format. Follow ${input.completeWorkPath} (review loop, security review,`,
    "one-line commit, push). Then call dev_outcome_met.",
    "",
    "# Task",
    input.outcome.trim(),
    "",
    "## Files present",
    ...requiredArtifacts(input.mode).map((file) => `- \`taskNotes/${input.task}/${file}\``),
    "- optional: task evidence per the branch rules / Parakh availability (never blocks)",
  ];
  return `${lines.join("\n")}\n`;
}

const MODE_RE = /^\s*(?:work\s+)?mode\s*[:=]\s*(backend|frontend|both)\b/im;

/** Explicit `work mode: …` / `mode: …` wins (human note first), otherwise backend. */
export function detectMode(planText: string, note?: string): WorkMode {
  for (const text of [note ?? "", planText ?? ""]) {
    const match = MODE_RE.exec(text);
    if (match) return match[1].toLowerCase() as WorkMode;
  }
  return "backend";
}

/** Artifacts the complete stage requires, by work mode. */
export function requiredArtifacts(mode: WorkMode): string[] {
  const files = ["taskWalkthrough.md", "review-passes.md", "currentCommitHash"];
  if (mode === "backend" || mode === "both") files.push("backend-validation.md");
  if (mode === "frontend" || mode === "both") files.push("frontend-validation.md");
  return files;
}

const COMMIT_TYPES = "feat|fix|docs|refactor|style|perf|test|chore|wip|remove|hotfix|security";

/** `emoji type: subject`, with or without a variation selector / ZWJ sequence (🧑‍💻 chore). */
export const COMMIT_SUBJECT_RE = new RegExp(
  `^\\p{Extended_Pictographic}(?:\\uFE0F|\\u200D\\p{Extended_Pictographic})*\\s+(?:${COMMIT_TYPES}):\\s+\\S.*$`,
  "u",
);

/** A commit message is acceptable only when it is exactly one conventional subject line. */
export function isOneLineConventionalCommit(message: string): boolean {
  const lines = (message ?? "").trim().split(/\r?\n/).map((line) => line.trim());
  if (lines.length !== 1 || lines[0] === "") return false;
  return COMMIT_SUBJECT_RE.test(lines[0]);
}

export const REVIEW_TERMINAL_RE = /^(0 findings|cap \(5 passes\)|escalated)$/i;

/**
 * The terminal line of `review-passes.md`: the last non-empty line, tolerating a markdown bullet
 * or backticks. Anything else means the review loop did not record how it ended.
 */
export function terminalReviewLine(text: string): string | null {
  const lines = (text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1]
    .replace(/^[-*+]\s+/, "")
    .replace(/`/g, "")
    .trim()
    // "Pass 4: 0 findings" is the natural way to write it; the verdict is what matters.
    .replace(/^pass\s+\d+\s*[:.)-]\s*/i, "")
    .trim();
  return REVIEW_TERMINAL_RE.test(last) ? last : null;
}

/**
 * Split misses into the ones still blocking and the ones a waiver covers. A waiver only counts
 * with a non-empty reason; an empty reason is ignored, so it cannot silently pass.
 */
export function applyWaivers(
  misses: Miss[],
  waive: Waiver[] | undefined,
): { remaining: Miss[]; waived: Waiver[] } {
  const usable = (waive ?? []).filter((item) => typeof item?.check === "string" && (item.reason ?? "").trim() !== "");
  const waived: Waiver[] = [];
  const remaining: Miss[] = [];
  for (const miss of misses) {
    const waiver = usable.find((item) => item.check === miss.check);
    if (waiver) waived.push({ check: waiver.check, reason: waiver.reason.trim() });
    else remaining.push(miss);
  }
  return { remaining, waived };
}

export function bumpFailure(failures: number): { failures: number; escalate: boolean } {
  const next = failures + 1;
  return { failures: next, escalate: next >= MAX_STAGE_FAILURES };
}

/**
 * Acceptance criteria are the checklist/numbered items of `## Acceptance Criteria`. They become
 * one decision-server question each (the server has no structured-map answer type).
 */
export function extractCriteria(plan: string): string[] {
  const section = extractSection(plan ?? "", /acceptance criteria/i);
  if (!section) return [];
  const items: string[] = [];
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)(.+)$/.exec(line);
    if (match) items.push(match[1].trim());
  }
  return items.slice(0, MAX_CRITERIA);
}

/** One `noul` question per criterion: "does the evidence prove this?". */
export function criterionQuestions(criteria: string[]): Record<string, { type: "noul"; instructions: string }> {
  const questions: Record<string, { type: "noul"; instructions: string }> = {};
  criteria.slice(0, MAX_CRITERIA).forEach((criterion, index) => {
    questions[`criterion_${index + 1}`] = {
      type: "noul",
      instructions: `Does the transcript evidence prove this acceptance criterion: ${criterion}`,
    };
  });
  return questions;
}

export function criterionScores(criteria: string[], answers: Record<string, unknown>): CriterionScore[] {
  return criteria.slice(0, MAX_CRITERIA).map((criterion, index) => {
    const answer = answers[`criterion_${index + 1}`] as { noul?: unknown } | undefined;
    const score = typeof answer?.noul === "number" ? answer.noul : 0;
    return { criterion, score };
  });
}

/** The per-turn goal injection. The goal text is the stage; it must never be paraphrased. */
export function goalMessage(input: {
  goal: string;
  stage: Stage;
  turn: number;
  budget: number;
  failures: number;
}): string {
  const heading = input.stage === "work" ? "LIVE WORK GOAL" : "LIVE COMPLETE GOAL";
  return [
    `${heading} (unchanged, do not widen) · turn ${input.turn}/${input.budget} · validator failures ${input.failures}/${MAX_STAGE_FAILURES}`,
    "",
    input.goal.trim(),
    "",
    "Only this goal is in scope. If it needs a different outcome, stop and report that a new plan is needed.",
  ].join("\n");
}

/** Human-readable verification record appended to goal.md by `dev_outcome_met`. */
export function verificationBlock(input: {
  criteria: CriterionScore[];
  misses: Miss[];
  waived: Waiver[];
  notRun: string[];
}): string {
  const lines = ["## Verification (extension)"];
  if (input.criteria.length === 0) lines.push("- no acceptance criteria in the plan");
  for (const item of input.criteria) lines.push(`- ${item.score.toFixed(2)} ${item.criterion}`);
  lines.push("", "## Waived");
  if (input.waived.length === 0) lines.push("- none");
  for (const item of input.waived) lines.push(`- \`${item.check}\`: ${item.reason}`);
  lines.push("", "## Not run");
  if (input.notRun.length === 0) lines.push("- none");
  for (const item of input.notRun) lines.push(`- ${item}`);
  lines.push("", "## Outstanding");
  if (input.misses.length === 0) lines.push("- none");
  for (const miss of input.misses) lines.push(`- \`${miss.check}\`: ${miss.detail}`);
  return lines.join("\n");
}

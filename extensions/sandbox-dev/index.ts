import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BUDGET } from "./policy.ts";
import { extractOutcome } from "./state.ts";
import {
  GOAL_FILE,
  MAX_STAGE_FAILURES,
  STAGE_ENTRY,
  STAGE_MESSAGE,
  bumpFailure,
  completeGoal,
  detectMode,
  goalMessage,
  parseGateReply,
  taskFindingFile,
  verificationBlock,
  workGoal,
  type Miss,
  type Stage,
  type Waiver,
  type WorkMode,
} from "./stage.ts";
import {
  collectFacts,
  validateComplete,
  validateWork,
  type AskJev,
  type CompleteVerdict,
} from "./validate.ts";
import * as jevModule from "../shared/jev.ts";
import { mapToolCall } from "../shared/tool-call.ts";

/**
 * Mutable bridge so tests can stub the Jev calls without spawning a subprocess or hitting the
 * network. Production uses the real functions captured from `../shared/jev.ts`.
 */
export const jev = {
  runJevDecision: jevModule.runJevDecision,
  askJev: jevModule.askJev,
};

/** The decision server, read through the mutable bridge so tests can swap it per case. */
const askJev: AskJev = (state, questions) => jev.askJev(state, questions);
const deps = { askJev };

const PLAN_SAFETY_QUESTIONS = {
  irreversible: {
    type: "noul",
    instructions:
      "Would implementing this plan perform an irreversible or hard-to-undo action (data deletion, schema migration, force push, publish, credential change) that needs human review?",
  },
  scope_risk: {
    type: "noul",
    instructions:
      "Does the plan touch authentication, secrets, or schema, or go materially beyond its stated scope, in a way that needs human judgment?",
  },
  safe_autoproceed: {
    type: "noul",
    instructions:
      "Is it safe for the agent to implement this plan fully autonomously without a human reviewing it first?",
  },
} as const;

const STATUS_KEY = "sandbox-dev";
const OUTCOME_ENTRY = "sandbox-dev-outcome";
const GATE_MESSAGE = "sandbox-dev-gate";
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMPLETE_WORK_PATH = join(PACKAGE_ROOT, "commands", "completeWork.md");
const GATE_HINT = "[g]o · [t]weak: <feedback> · [r]eject/show full plan";

interface PlanAnchor {
  task: string;
  outcome: string;
  budget: number;
}

interface Anchor extends PlanAnchor {
  /** The live goal: the plan's Original Ask wrapped in the stage template. Never paraphrased. */
  goal: string;
  /** The human's `g: <note>`, if the approval carried one. */
  note?: string;
  stage: Stage;
  mode: WorkMode;
  /** Consecutive validator failures in the current stage. */
  failures: number;
  /** Three failures in one stage: stop and hand the decision back to the human. */
  escalated: boolean;
  met: boolean;
  /** The turn budget ran out. Distinct from `met`: the outcome was never declared satisfied. */
  exhausted: boolean;
  notRun: string[];
  waived: Waiver[];
  criteria: CompleteVerdict["criteria"];
}

export default function sandboxDev(pi: ExtensionAPI) {
  /** Armed by approval (human `g`, `/dev-approve`, or the Jev-safe auto-approve). */
  let anchor: Anchor | undefined;
  /** Present once the gate is shown; the outcome comes from the plan it read. */
  let pendingAnchor: PlanAnchor | undefined;
  let turnsUsed = 0;
  /** Tool calls sent to the decision server, calls it approved, and prompts the human saw. */
  let judged = 0;
  let serverApproved = 0;
  let prompted = 0;

  const status = (ctx: ExtensionContext, text: string | undefined) => {
    if (ctx.mode === "tui" || ctx.mode === "rpc") ctx.ui.setStatus(STATUS_KEY, text);
  };

  const sessionId = (ctx: ExtensionContext): string => {
    try { return ctx.sessionManager.getSessionId(); } catch { return "unknown"; }
  };

  /** The before/after instrument: how much the decision server settles, and how much reaches me. */
  const policyLine = () => `policy: ${judged} judged, ${serverApproved} server-approved, ${prompted} prompted`;

  const renderStatus = (ctx: ExtensionContext) => {
    const active = anchor ?? pendingAnchor;
    if (!active) {
      status(ctx, undefined);
      return;
    }
    const label = !anchor
      ? "awaiting approval"
      : anchor.met
        ? "outcome met"
        : anchor.exhausted
          ? "budget exhausted"
          : anchor.escalated
            ? "escalated"
            : `${anchor.stage} · turn ${turnsUsed}/${anchor.budget} · fails ${anchor.failures}/${MAX_STAGE_FAILURES}`;
    status(ctx, `sandbox-dev · ${active.task} · ${label}`);
  };

  const readPlan = (cwd: string, task: string): { text: string } | undefined => {
    if (!/^[A-Za-z0-9._-]+$/.test(task)) return undefined;
    try {
      return { text: readFileSync(join(cwd, "taskNotes", task, "taskFindings.md"), "utf8") };
    } catch {
      return undefined;
    }
  };

  /** goal.md is a temporary copy of the live goal; only the extension writes it. */
  const writeGoal = (cwd: string, task: string, text: string): boolean => {
    if (!/^[A-Za-z0-9._-]+$/.test(task)) return false;
    try {
      writeFileSync(join(cwd, "taskNotes", task, GOAL_FILE), text, "utf8");
      return true;
    } catch {
      return false;
    }
  };

  /**
   * The single approval path: `g` / `g: note`, `/dev-approve`, and the Jev-safe auto-approve all
   * land here, so every anchored run has a written work goal. A model-called tool cannot reach it.
   */
  const approve = (ctx: ExtensionContext, task: string, note?: string): boolean => {
    const plan = readPlan(ctx.cwd, task);
    if (!plan) return false;
    const outcome = extractOutcome(plan.text);
    if (!outcome) return false;
    const mode = detectMode(plan.text, note);
    const goal = workGoal({ task, outcome, note });
    if (!writeGoal(ctx.cwd, task, goal)) return false;
    anchor = {
      task,
      outcome,
      budget: BUDGET,
      goal,
      note,
      stage: "work",
      mode,
      failures: 0,
      escalated: false,
      met: false,
      exhausted: false,
      notRun: [],
      waived: [],
      criteria: [],
    };
    pendingAnchor = undefined;
    turnsUsed = 0;
    pi.appendEntry(STAGE_ENTRY, { task, stage: "work", note, mode, at: Date.now() });
    renderStatus(ctx);
    return true;
  };

  /** Present the gate in the chat. The human's reply is the record; the extension records nothing. */
  const presentGate = (ctx: ExtensionContext, task: string, outcome: string) => {
    pendingAnchor = { task, outcome, budget: BUDGET };
    pi.sendMessage(
      {
        customType: GATE_MESSAGE,
        display: true,
        content: [
          `**sandbox-dev gate** · plan \`${task}\``,
          "",
          `Reply in this chat: ${GATE_HINT}.`,
          "The transcript is the record: implementation starts only after the human approves here.",
        ].join("\n"),
      },
      { triggerTurn: false },
    );
    renderStatus(ctx);
  };

  const notApproved = (text: string) => ({
    content: [{ type: "text" as const, text: `NOT APPROVED. ${text}` }],
    details: {},
  });

  const toolText = (text: string) => ({
    content: [{ type: "text" as const, text }],
    details: {},
  });

  const renderMisses = (misses: Miss[]): string => misses.map((miss) => `- ${miss.check}: ${miss.detail}`).join("\n");

  /** Count a validator failure; at the cap the run stops and asks the human. */
  const recordFailure = (ctx: ExtensionContext, misses: Miss[]): boolean => {
    if (!anchor) return true;
    const next = bumpFailure(anchor.failures);
    anchor.failures = next.failures;
    if (next.escalate) {
      anchor.escalated = true;
      pi.appendEntry(STAGE_ENTRY, { task: anchor.task, stage: anchor.stage, escalated: true, misses, at: Date.now() });
      ctx.ui.notify(
        `sandbox-dev: ${anchor.stage} validator failed ${MAX_STAGE_FAILURES} times in a row; escalated to you.`,
        "warning",
      );
    }
    renderStatus(ctx);
    return next.escalate;
  };

  /** The spec's "stay in stage, notify": an unreachable server is visible, not just a miss line. */
  const notifySemantics = (ctx: ExtensionContext, misses: Miss[]) => {
    if (misses.some((miss) => miss.check === "semantics")) {
      ctx.ui.notify(`sandbox-dev: decision server unavailable; staying in the ${anchor?.stage ?? "current"} stage.`, "warning");
    }
  };

  const escalationNote = () =>
    `ESCALATED: ${MAX_STAGE_FAILURES} validator failures in the ${anchor?.stage ?? "current"} stage. Stop and report what is still missing; the human decides how to proceed.`;

  // --- Human input: the gate is written by the human's reply, never by a tool -----------------

  pi.on("input", async (event, ctx) => {
    // A typed prompt is `interactive`; `extension` is pi.sendUserMessage and `rpc` is an API
    // caller. Only the human in the TUI approves with `g`. Everything else flows unchanged.
    if (event.source !== "interactive" || !pendingAnchor) return;
    const reply = parseGateReply(event.text);
    if (!reply.approve) return;
    const task = pendingAnchor.task;
    if (!approve(ctx, task, reply.note)) {
      ctx.ui.notify(`sandbox-dev: could not read taskNotes/${task}/taskFindings.md; the gate stays open.`, "warning");
      return;
    }
    ctx.ui.notify(`sandbox-dev: approved ${task}; work goal written to taskNotes/${task}/${GOAL_FILE}.`, "info");
    // The `g` stays in the transcript as the approval record the model reads.
    return { action: "continue" as const };
  });

  pi.on("session_start", async (_event, ctx) => {
    anchor = undefined;
    pendingAnchor = undefined;
    turnsUsed = 0;
    judged = 0;
    serverApproved = 0;
    prompted = 0;
    // Resume: regenerate the goal from the plan + artifacts, never from goal.md. A stage entry is
    // the only persisted state; an escalated run is not resurrected.
    const saved = lastStageEntry(ctx);
    if (saved) {
      const plan = readPlan(ctx.cwd, saved.task);
      const outcome = plan ? extractOutcome(plan.text) : "";
      if (plan && outcome) {
        const mode = detectMode(plan.text, saved.note);
        const goal =
          saved.stage === "complete"
            ? completeGoal({ task: saved.task, outcome, completeWorkPath: COMPLETE_WORK_PATH, mode })
            : workGoal({ task: saved.task, outcome, note: saved.note });
        writeGoal(ctx.cwd, saved.task, goal);
        anchor = {
          task: saved.task,
          outcome,
          budget: BUDGET,
          goal,
          note: saved.note,
          stage: saved.stage,
          mode,
          failures: 0,
          escalated: false,
          met: false,
          exhausted: false,
          notRun: [],
          waived: [],
          criteria: [],
        };
      }
    }
    renderStatus(ctx);
  });

  // Tell the model where the procedure files live, the live goal, and that a gate reply is its to read.
  pi.on("before_agent_start", async (event) => {
    const gate = pendingAnchor
      ? `\n\nsandbox-dev: a plan gate is open for "${pendingAnchor.task}". The human replies in this chat; read their reply. Implement only if they approve. If they ask for a change, revise taskNotes/${pendingAnchor.task}/taskFindings.md and call dev_request_approval again.`
      : "";
    const live =
      anchor && !anchor.met
        ? `\n\nsandbox-dev ${goalMessage({ goal: anchor.goal, stage: anchor.stage, turn: turnsUsed, budget: anchor.budget, failures: anchor.failures })}`
        : "";
    return {
      systemPrompt: `${event.systemPrompt}${gate}${live}\n\nsandbox-dev procedure files (absolute paths): ${["codePlanner", "startWork", "completeWork"]
        .map((name) => join(PACKAGE_ROOT, "commands", `${name}.md`))
        .join(", ")}.`,
    };
  });

  // --- Target 1: the decision server judges every tool call --------------------------------

  /**
   * One tool call, one decision-server question. Approval runs the call untouched; anything else —
   * a reject, an "ask", or an unreachable server — becomes exactly one plain yes/no prompt that the
   * human can override. Nothing is blocked by policy and nothing is remembered between calls.
   */
  const judgeCall = async (event: { toolName: string; input: unknown }, ctx: ExtensionContext) => {
    const input = event.input as unknown as Record<string, unknown>;
    judged += 1;

    const verdicts = await jev.runJevDecision("pre_tool", {
      sessionId: sessionId(ctx),
      cwd: ctx.cwd,
      transcriptPath: process.env.PI_SESSION_FILE,
      tool: mapToolCall(event.toolName, input),
    });

    let reason = "the decision server is unavailable";
    if (verdicts !== undefined) {
      for (const note of verdicts.notify ?? []) ctx.ui.notify(note, "info");
      // Apply the rewrite before judging, so an approved call runs the rewritten input either way.
      if (verdicts.rewrite) {
        Object.assign(input, verdicts.rewrite.input);
        ctx.ui.notify(`sandbox-dev: ${verdicts.rewrite.note}`, "info");
      }
      // Approval is silent: the tool call itself is the feedback, and a line per read would be noise.
      if (!verdicts.gate) {
        serverApproved += 1;
        return undefined;
      }
      reason = verdicts.gate.reason;
    }

    if (!ctx.hasUI) {
      return { block: true, reason: `sandbox-dev: ${reason}; no UI to confirm, failing closed` };
    }
    prompted += 1;
    const preview = JSON.stringify(input).slice(0, 300);
    const approved = await ctx.ui.confirm("sandbox-dev permission", `${event.toolName}: ${reason}\n\n${preview}`);
    return approved ? undefined : { block: true, reason: "sandbox-dev: denied by you" };
  };

  pi.on("tool_call", async (event, ctx) => {
    // The gate machinery already asks the server about the plan; judging these would ask twice.
    if (event.toolName === "dev_request_approval" || event.toolName === "dev_outcome_met" || event.toolName === "dev_stage") {
      return;
    }
    return judgeCall(event, ctx);
  });

  // `user_bash` is deliberately not judged: it is a command the human typed, not a tool call.

  // --- Target 2: the plan gate, conversational ---------------------------------------------

  /** Ask Jev whether the plan is safe to implement autonomously. Any failure fails closed. */
  const planLooksSafe = async (ctx: ExtensionContext, planText: string, task: string): Promise<boolean> => {
    try {
      const result = await jev.askJev(
        { plan: planText.slice(0, 8000), task, cwd: ctx.cwd },
        PLAN_SAFETY_QUESTIONS,
      );
      const noul = (id: string): number | undefined => {
        const answer = result.answers?.[id];
        return typeof answer?.noul === "number" ? answer.noul : undefined;
      };
      const safeAutoproceed = noul("safe_autoproceed");
      const irreversible = noul("irreversible");
      const scopeRisk = noul("scope_risk");
      return (
        typeof safeAutoproceed === "number" && safeAutoproceed >= 0.6 &&
        typeof irreversible === "number" && irreversible < 0.5 &&
        typeof scopeRisk === "number" && scopeRisk < 0.5
      );
    } catch {
      return false;
    }
  };

  pi.registerTool({
    name: "dev_request_approval",
    label: "Dev Plan Approval",
    description:
      "Read taskNotes/<task>/taskFindings.md from disk and append the plan gate to the chat. The human answers there (g / t: <feedback> / r) and the transcript is the record. Do not implement until the human has approved in the chat.",
    promptSnippet: "Present the plan gate in the chat",
    parameters: Type.Object({
      task: Type.String({ description: "The taskNotes directory name for this plan." }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, { task }, _signal, _update, ctx) {
      const plan = readPlan(ctx.cwd, task);
      if (!plan) return notApproved(`No plan at taskNotes/${task}/taskFindings.md. Run /codePlanner first.`);
      const outcome = extractOutcome(plan.text);
      if (!outcome) return notApproved(`taskNotes/${task}/taskFindings.md has no "Original Ask" section to anchor.`);
      if (await planLooksSafe(ctx, plan.text, task)) {
        if (approve(ctx, task)) {
          ctx.ui.notify(`sandbox-dev: auto-approved ${task} (Jev: safe)`, "info");
          pi.sendMessage(
            {
              customType: GATE_MESSAGE,
              display: true,
              content: `sandbox-dev: plan ${task} auto-approved by Jev (safe). The work goal is in \`taskNotes/${task}/${GOAL_FILE}\`; implementation is authorized.`,
            },
            { triggerTurn: false },
          );
          return toolText(
            `Auto-approved ${task} (Jev judged it safe). The work goal is in taskNotes/${task}/${GOAL_FILE}; proceed with implementation (startWork). Call dev_stage { "to": "complete" } when the work and its tests are done.`,
          );
        }
      }
      presentGate(ctx, task, outcome);
      return toolText(`Gate presented for ${task} in the chat. Stop here; implement only after the human replies there and approves.`);
    },
  });

  pi.registerCommand("dev-approve", {
    description: "Approve a plan explicitly and start the anchored implementation",
    handler: async (args, ctx) => {
      const task = args.trim() || pendingAnchor?.task || anchor?.task || "";
      if (!task) {
        ctx.ui.notify("Usage: /dev-approve <task-directory>", "warning");
        return;
      }
      if (!readPlan(ctx.cwd, task)) {
        ctx.ui.notify(`No plan at taskNotes/${task}/taskFindings.md. Run /codePlanner first.`, "warning");
        return;
      }
      if (!approve(ctx, task)) {
        ctx.ui.notify(`taskNotes/${task}/taskFindings.md has no "Original Ask" section to anchor.`, "warning");
        return;
      }
      ctx.ui.notify(`Approved ${task}. Work goal written; outcome anchored.`, "info");
      pi.sendUserMessage(`/startWork taskNotes/${task}/taskFindings.md, mode: autonomous`, { expandPromptTemplates: true });
    },
  });

  // --- Target 3: stage goals ----------------------------------------------------------------

  pi.registerTool({
    name: "dev_stage",
    label: "Stage Goal",
    description:
      'Switch the anchored sandbox-dev run to the next stage goal. Only "work" -> "complete" exists; the work validator must pass first, otherwise this returns NOT READY with the misses.',
    promptSnippet: "Switch the anchored run to the complete stage goal",
    parameters: Type.Object({
      task: Type.Optional(Type.String({ description: "Anchored task directory; defaults to the active anchor." })),
      to: Type.String({ description: 'The target stage. Only "complete" is supported.' }),
    }),
    async execute(_toolCallId, { task, to }, _signal, _update, ctx) {
      if (!anchor) return toolText(`NOT READY: no anchored outcome. Present the plan gate and get the human's "g" first.`);
      const target = (task ?? "").trim() || anchor.task;
      if (target !== anchor.task) {
        return toolText(`NOT READY: no anchored outcome for "${target}"; the anchor is "${anchor.task}".`);
      }
      if (to !== "complete") return toolText(`NOT READY: unsupported stage "${to}". Only "complete" is supported.`);
      if (anchor.stage === "complete") {
        return toolText(`Already in the complete stage. Follow ${COMPLETE_WORK_PATH}, then call dev_outcome_met.`);
      }
      if (anchor.escalated) return toolText(escalationNote());

      const facts = collectFacts(ctx.cwd, anchor.task, recentTurns(ctx), anchor.mode);
      const verdict = await validateWork({ cwd: ctx.cwd, task: anchor.task, mode: anchor.mode, facts, deps });
      if (!verdict.ok) {
        notifySemantics(ctx, verdict.misses);
        const escalated = recordFailure(ctx, verdict.misses);
        return toolText(
          `NOT READY:\n${renderMisses(verdict.misses)}${escalated ? `\n\n${escalationNote()}` : "\n\nFix these, then call dev_stage again."}`,
        );
      }

      anchor.failures = 0;
      anchor.stage = "complete";
      anchor.goal = completeGoal({
        task: anchor.task,
        outcome: anchor.outcome,
        completeWorkPath: COMPLETE_WORK_PATH,
        mode: anchor.mode,
      });
      if (!writeGoal(ctx.cwd, anchor.task, anchor.goal)) {
        ctx.ui.notify(`sandbox-dev: could not write taskNotes/${anchor.task}/${GOAL_FILE}; the in-memory goal is still active.`, "warning");
      }
      turnsUsed = 0;
      pi.appendEntry(STAGE_ENTRY, { task: anchor.task, stage: "complete", note: anchor.note, mode: anchor.mode, at: Date.now() });
      pi.sendMessage(
        {
          customType: STAGE_MESSAGE,
          display: true,
          content: [
            `**sandbox-dev stage → complete** · \`${anchor.task}\``,
            "",
            `The work goal is complete. The live goal is now the completion goal in \`taskNotes/${anchor.task}/${GOAL_FILE}\`;`,
            `follow ${COMPLETE_WORK_PATH} (review loop, security review, one-line commit, push), then call dev_outcome_met.`,
          ].join("\n"),
        },
        { triggerTurn: false },
      );
      renderStatus(ctx);
      return toolText(
        `Stage: complete. The complete goal is in taskNotes/${anchor.task}/${GOAL_FILE}. Follow ${COMPLETE_WORK_PATH}, then call dev_outcome_met with evidence and not_run.`,
      );
    },
  });

  pi.registerTool({
    name: "dev_outcome_met",
    label: "Outcome Met",
    description:
      "Declare that the anchored outcome is satisfied. Runs the complete validator (artifacts, one-line commit, push, tests in the diff, decision server) and records met only when it passes or every miss is waived. Evidence must be raw transcript output.",
    promptSnippet: "Declare the anchored outcome met with evidence",
    parameters: Type.Object({
      task: Type.String({ description: "The taskNotes directory name for the anchored outcome." }),
      evidence: Type.String({ description: "Raw transcript-visible evidence, e.g. exit codes and test summary lines." }),
      not_run: Type.Array(Type.String(), { description: "Evidence items that were not run. Required; may be empty." }),
      waive: Type.Optional(
        Type.Array(
          Type.Object({
            check: Type.String({ description: "Check id from the NOT READY list (files, review-passes, commit, pushed, tests-in-diff, diff-in-repo, evidence, plan_followed, criterion_N, not_run). `semantics` and `stage` cannot be waived." }),
            reason: Type.String({ description: "Why the miss is acceptable. Required; an empty reason does not waive." }),
          }),
        ),
      ),
    }),
    async execute(_toolCallId, { task, evidence, not_run, waive }, _signal, _update, ctx) {
      if (!anchor || anchor.task !== task) {
        return toolText(`No active anchored outcome for "${task}".`);
      }
      const notRun = (not_run ?? []).map((item) => item.trim()).filter(Boolean);
      const facts = collectFacts(ctx.cwd, task, recentTurns(ctx), anchor.mode);
      const verdict = await validateComplete({
        cwd: ctx.cwd,
        task,
        mode: anchor.mode,
        stage: anchor.stage,
        facts,
        notRun,
        waive,
        deps,
      });

      anchor.criteria = verdict.criteria;
      anchor.waived = verdict.waived;
      anchor.notRun = notRun;
      if (
        !writeGoal(
          ctx.cwd,
          task,
          `${anchor.goal.trim()}\n\n${verificationBlock({ criteria: verdict.criteria, misses: verdict.misses, waived: verdict.waived, notRun })}`,
        )
      ) {
        ctx.ui.notify(`sandbox-dev: could not write taskNotes/${task}/${GOAL_FILE} with the verification record.`, "warning");
      }
      pi.appendEntry(OUTCOME_ENTRY, {
        task,
        met: verdict.ok,
        evidence,
        not_run: notRun,
        waive: waive ?? [],
        criteria: verdict.criteria,
        misses: verdict.misses,
        waived: verdict.waived,
        at: Date.now(),
      });

      if (!verdict.ok) {
        notifySemantics(ctx, verdict.misses);
        const escalated = recordFailure(ctx, verdict.misses);
        renderStatus(ctx);
        return toolText(
          `NOT READY:\n${renderMisses(verdict.misses)}\n\nNothing was recorded as met. Fix the misses, or waive each one with a reason.${escalated ? `\n\n${escalationNote()}` : ""}`,
        );
      }

      anchor.met = true;
      anchor.exhausted = false;
      anchor.failures = 0;
      renderStatus(ctx);
      return toolText(
        `Outcome marked met for ${task}. ${verdict.waived.length} waived, ${notRun.length} not run; the criterion map is in taskNotes/${task}/${GOAL_FILE}.`,
      );
    },
  });

  pi.on("agent_before_settle", async (event, ctx) => {
    if (event.outcome !== "completed") return;
    const active = anchor;
    if (!active || active.met || !event.context.canContinue) return;

    if (active.escalated) {
      return {
        continue: false,
        entries: [{ type: "custom_message", customType: STAGE_MESSAGE, display: true, content: escalationNote() }],
      };
    }

    if (turnsUsed >= active.budget) {
      active.exhausted = true;
      renderStatus(ctx);
      ctx.ui.notify(`sandbox-dev: outcome budget exhausted (${active.budget} turns). Stopping.`, "warning");
      return {
        entries: [
          {
            type: "custom_message",
            customType: GATE_MESSAGE,
            display: true,
            content: `OUTCOME BUDGET EXHAUSTED (${active.budget} turns). Stop and report what the outcome still needs; do not continue.`,
          },
        ],
      };
    }

    turnsUsed += 1;
    renderStatus(ctx);
    const turns = turnsFromMessages(event.context.llmMessages);
    const facts = collectFacts(ctx.cwd, active.task, turns, active.mode);

    if (active.stage === "work") {
      const verdict = await validateWork({ cwd: ctx.cwd, task: active.task, mode: active.mode, facts, deps });
      if (!verdict.ok) {
        notifySemantics(ctx, verdict.misses);
        const escalated = recordFailure(ctx, verdict.misses);
        return continueWith(
          [
            `VALIDATOR NOT READY · stage work · failure ${active.failures}/${MAX_STAGE_FAILURES}`,
            "",
            renderMisses(verdict.misses),
            "",
            escalated ? escalationNote() : goalMessage({ goal: active.goal, stage: active.stage, turn: turnsUsed, budget: active.budget, failures: active.failures }),
          ].join("\n"),
          escalated,
        );
      }
      active.failures = 0;
      return continueWith(
        [
          goalMessage({ goal: active.goal, stage: active.stage, turn: turnsUsed, budget: active.budget, failures: active.failures }),
          "",
          `The work validator passed. Call dev_stage { "to": "complete" } to switch to the completion goal.`,
        ].join("\n"),
        false,
      );
    }

    const verdict = await validateComplete({
      cwd: ctx.cwd,
      task: active.task,
      mode: active.mode,
      stage: active.stage,
      facts,
      notRun: active.notRun,
      waive: active.waived,
      deps,
    });
    if (!verdict.ok) {
      notifySemantics(ctx, verdict.misses);
      const escalated = recordFailure(ctx, verdict.misses);
      return continueWith(
        [
          `VALIDATOR NOT READY · stage complete · failure ${active.failures}/${MAX_STAGE_FAILURES}`,
          "",
          renderMisses(verdict.misses),
          "",
          escalated ? escalationNote() : goalMessage({ goal: active.goal, stage: active.stage, turn: turnsUsed, budget: active.budget, failures: active.failures }),
        ].join("\n"),
        escalated,
      );
    }
    active.failures = 0;
    return continueWith(
      [
        goalMessage({ goal: active.goal, stage: active.stage, turn: turnsUsed, budget: active.budget, failures: active.failures }),
        "",
        "The complete validator passed. Call dev_outcome_met with the raw evidence, not_run (may be empty), and waive for anything you cannot fix.",
      ].join("\n"),
      false,
    );
  });

  /** A failure message continues the run; the third consecutive one hands the decision to the human. */
  function continueWith(content: string, escalate: boolean) {
    return {
      continue: !escalate,
      entries: [
        {
          type: "custom_message" as const,
          customType: STAGE_MESSAGE,
          display: true,
          content,
        },
      ],
    };
  }

  pi.registerCommand("dev-status", {
    description: "Show the anchored stage goal and its turn budget",
    handler: async (_args, ctx) => {
      const active = anchor ?? pendingAnchor;
      if (!active) {
        ctx.ui.notify(`sandbox-dev: no plan gate or anchored outcome.\n${policyLine()}`, "info");
        return;
      }
      if (!anchor) {
        ctx.ui.notify(`sandbox-dev: awaiting the human's approval for ${active.task}.\n${policyLine()}`, "warning");
        return;
      }
      const lines = [
        policyLine(),
        "",
        `task: ${anchor.task}`,
        `stage: ${anchor.stage}`,
        `met: ${anchor.met}`,
        `exhausted: ${anchor.exhausted}`,
        `escalated: ${anchor.escalated}`,
        `validator failures: ${anchor.failures}/${MAX_STAGE_FAILURES}`,
        `turn: ${turnsUsed}/${anchor.budget}`,
        `goal: taskNotes/${anchor.task}/${GOAL_FILE}`,
        `waived: ${anchor.waived.length}`,
        `not run: ${anchor.notRun.length}`,
        `criteria: ${anchor.criteria.length}`,
        "",
        anchor.goal.split("\n").slice(0, 6).join("\n"),
      ].join("\n");
      ctx.ui.notify(lines, anchor.met ? "info" : "warning");
    },
  });

  pi.registerCommand("dev-reset", {
    description: "Clear the in-session gate and anchor",
    handler: async (_args, ctx) => {
      anchor = undefined;
      pendingAnchor = undefined;
      turnsUsed = 0;
      judged = 0;
      serverApproved = 0;
      prompted = 0;
      renderStatus(ctx);
      ctx.ui.notify("sandbox-dev: gate and anchor cleared for this session.", "info");
    },
  });
}

/** The last non-escalated stage entry on the session branch, used to regenerate on resume. */
function lastStageEntry(
  ctx: ExtensionContext,
): { task: string; stage: Stage; note?: string } | undefined {
  try {
    const entries = ctx.sessionManager.getBranch();
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index] as {
        type?: string;
        customType?: string;
        data?: { task?: unknown; stage?: unknown; note?: unknown; escalated?: unknown };
      };
      if (entry.type !== "custom") continue;
      // A met outcome entry sits after its stage entry: the run finished, do not resurrect it.
      if (entry.customType === OUTCOME_ENTRY && (entry.data as { met?: unknown } | undefined)?.met === true) return undefined;
      if (entry.customType !== STAGE_ENTRY) continue;
      const data = entry.data ?? {};
      if (typeof data.task !== "string") continue;
      if (data.stage !== "work" && data.stage !== "complete") continue;
      if (data.escalated === true) continue;
      return {
        task: data.task,
        stage: data.stage,
        note: typeof data.note === "string" ? data.note : undefined,
      };
    }
  } catch {
    // No session manager (or no branch yet): nothing to resume.
  }
  return undefined;
}

/** Last few assistant turns from the session branch, for the facts handed to the decision server. */
function recentTurns(ctx: ExtensionContext): string {
  try {
    return turnsFromEntries(ctx.sessionManager.getBranch());
  } catch {
    return "";
  }
}

function turnsFromEntries(entries: readonly unknown[]): string {
  const texts: string[] = [];
  for (const entry of entries.slice(-24)) {
    const record = entry as { type?: string; message?: { role?: string; content?: unknown } };
    if (record.type !== "message" || record.message?.role !== "assistant") continue;
    texts.push(...messageText(record.message.content));
  }
  return texts.slice(-6).join("\n").slice(-8000);
}

function turnsFromMessages(messages: readonly unknown[] | undefined): string {
  const texts: string[] = [];
  for (const message of (messages ?? []).slice(-24)) {
    const record = message as { role?: string; content?: unknown };
    if (record.role !== "assistant") continue;
    texts.push(...messageText(record.content));
  }
  return texts.slice(-6).join("\n").slice(-8000);
}

function messageText(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content) {
    const record = block as { type?: string; text?: unknown };
    if (record.type === "text" && typeof record.text === "string") texts.push(record.text);
  }
  return texts;
}

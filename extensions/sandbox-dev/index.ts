import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, classifyToolCall, isImplementation, isShellConfirm, type PolicyCall } from "./policy.ts";
import { anchorMessage, extractOutcome } from "./state.ts";
import * as jevModule from "../shared/jev.ts";

/**
 * Mutable bridge so tests can stub the Jev calls without spawning a subprocess or hitting the
 * network. Production uses the real functions captured from `../shared/jev.ts`.
 */
export const jev = {
  runJevDecision: jevModule.runJevDecision,
  markShellApprovalHandled: jevModule.markShellApprovalHandled,
  askJev: jevModule.askJev,
};

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
const ANCHOR_MESSAGE = "sandbox-dev-anchor";
const GATE_MESSAGE = "sandbox-dev-gate";
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE_HINT = "[g]o · [t]weak: <feedback> · [r]eject/show full plan";

interface PlanAnchor {
  task: string;
  outcome: string;
  budget: number;
}
interface Anchor extends PlanAnchor {
  met: boolean;
  /** The turn budget ran out. Distinct from `met`: the outcome was never declared satisfied. */
  exhausted: boolean;
}

export default function sandboxDev(pi: ExtensionAPI) {
  const config = DEFAULT_CONFIG;
  /** Armed once implementation starts. Supervision is keyed on this, not on approval. */
  let anchor: Anchor | undefined;
  /** Present once the gate is shown; the outcome comes from the plan it read. */
  let pendingAnchor: PlanAnchor | undefined;
  let turnsUsed = 0;

  const status = (ctx: ExtensionContext, text: string | undefined) => {
    if (ctx.mode === "tui" || ctx.mode === "rpc") ctx.ui.setStatus(STATUS_KEY, text);
  };

  const sessionId = (ctx: ExtensionContext): string => {
    try { return ctx.sessionManager.getSessionId(); } catch { return "unknown"; }
  };

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
          : `turn ${turnsUsed}/${anchor.budget}`;
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

  /** Present the gate in the chat. The human's reply is the record; the extension records nothing. */
  const presentGate = (ctx: ExtensionContext, task: string, outcome: string) => {
    pendingAnchor = { task, outcome, budget: config.budget };
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

  const armAnchor = (ctx: ExtensionContext) => {
    if (!pendingAnchor) return;
    anchor = { ...pendingAnchor, met: false, exhausted: false };
    pendingAnchor = undefined;
    turnsUsed = 0;
    renderStatus(ctx);
  };

  const notApproved = (text: string) => ({
    content: [{ type: "text" as const, text: `NOT APPROVED. ${text}` }],
    details: {},
  });

  pi.on("session_start", async (_event, ctx) => {
    anchor = undefined;
    pendingAnchor = undefined;
    turnsUsed = 0;
    renderStatus(ctx);
  });

  // Tell the model where the procedure files live, and that a gate reply is its to read.
  pi.on("before_agent_start", async (event) => {
    const gate = pendingAnchor
      ? `\n\nsandbox-dev: a plan gate is open for "${pendingAnchor.task}". The human replies in this chat; read their reply. Implement only if they approve. If they ask for a change, revise taskNotes/${pendingAnchor.task}/taskFindings.md and call dev_request_approval again.`
      : "";
    return {
      systemPrompt: `${event.systemPrompt}${gate}\n\nsandbox-dev procedure files (absolute paths): ${["codePlanner", "startWork", "completeWork"]
        .map((name) => join(PACKAGE_ROOT, "prompts", `${name}.md`))
        .join(", ")}.`,
    };
  });

  // --- Target 1: permission floor ----------------------------------------------------------

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "dev_request_approval" || event.toolName === "dev_outcome_met") return;
    const input = event.input as unknown as Record<string, unknown>;
    const call: PolicyCall = { toolName: event.toolName, input };

    // The first source mutation after the gate marks the start of implementation; arm supervision.
    if (pendingAnchor && isImplementation(call, ctx.cwd)) armAnchor(ctx);

    const decision = classifyToolCall(call, ctx.cwd, config);
    if (decision.verdict === "allow") return;
    if (decision.verdict === "deny") {
      if (isShellConfirm(call)) jev.markShellApprovalHandled(event.toolCallId);
      ctx.ui.notify(`sandbox-dev denied ${event.toolName}: ${decision.reason}`, "error");
      return { block: true, reason: `sandbox-dev: ${decision.reason}` };
    }
    // Shell confirmations are Jev-resolvable: safe commands auto-approve, risky ones ask.
    if (isShellConfirm(call)) {
      jev.markShellApprovalHandled(event.toolCallId);
      const verdicts = await jev.runJevDecision("pre_tool", {
        sessionId: sessionId(ctx),
        cwd: ctx.cwd,
        tool: {
          kind: "shell",
          command: String(input.command ?? ""),
          description: String(input.description ?? ""),
        },
      });
      // `undefined` means Jev was unavailable — fail closed by falling through to the human confirm.
      if (verdicts !== undefined) {
        const gate = verdicts.gate;
        if (gate?.action === "deny") {
          return { block: true, reason: `sandbox-dev: ${gate.reason}` };
        }
        if (gate?.action !== "ask") {
          ctx.ui.notify(`sandbox-dev: auto-approved ${event.toolName} (Jev: safe)`, "info");
          return;
        }
      }
    }
    if (!ctx.hasUI) {
      return { block: true, reason: `sandbox-dev: ${decision.reason}; no UI to confirm, failing closed` };
    }
    const preview = JSON.stringify(input).slice(0, 500);
    const confirmed = await ctx.ui.confirm("sandbox-dev permission", `${event.toolName}: ${decision.reason}\n\n${preview}`);
    return confirmed ? undefined : { block: true, reason: "sandbox-dev: denied by user" };
  });

  pi.on("user_bash", async (event, ctx) => {
    const call: PolicyCall = { toolName: "bash", input: { command: event.command } };
    const decision = classifyToolCall(call, ctx.cwd, config);
    if (decision.verdict === "allow") return;
    const block = (output: string) => ({ result: { output, exitCode: 1, cancelled: false, truncated: false } });
    if (decision.verdict === "deny") return block(`sandbox-dev blocked: ${decision.reason}`);
    if (!ctx.hasUI) return block(`sandbox-dev: ${decision.reason}; no UI to confirm, failing closed`);
    const confirmed = await ctx.ui.confirm("sandbox-dev permission", event.command);
    return confirmed ? undefined : block("sandbox-dev: denied by user");
  });

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
        pendingAnchor = { task, outcome, budget: config.budget };
        armAnchor(ctx);
        ctx.ui.notify(`sandbox-dev: auto-approved ${task} (Jev: safe)`, "info");
        pi.sendMessage(
          {
            customType: GATE_MESSAGE,
            display: true,
            content: `sandbox-dev: plan ${task} auto-approved by Jev (safe). Implementation is authorized; the outcome is anchored.`,
          },
          { triggerTurn: false },
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Auto-approved ${task} (Jev judged it safe). The outcome is anchored — proceed with implementation (startWork).`,
            },
          ],
          details: {},
        };
      }
      presentGate(ctx, task, outcome);
      return {
        content: [
          {
            type: "text" as const,
            text: `Gate presented for ${task} in the chat. Stop here; implement only after the human replies there and approves.`,
          },
        ],
        details: {},
      };
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
      const plan = readPlan(ctx.cwd, task);
      if (!plan) {
        ctx.ui.notify(`No plan at taskNotes/${task}/taskFindings.md. Run /codePlanner first.`, "warning");
        return;
      }
      const outcome = extractOutcome(plan.text);
      if (!outcome) {
        ctx.ui.notify(`taskNotes/${task}/taskFindings.md has no "Original Ask" section to anchor.`, "warning");
        return;
      }
      pendingAnchor = { task, outcome, budget: config.budget };
      armAnchor(ctx);
      ctx.ui.notify(`Approved ${task}. Outcome anchored.`, "info");
      pi.sendUserMessage(`/startWork taskNotes/${task}/taskFindings.md, mode: autonomous`, { expandPromptTemplates: true });
    },
  });

  // --- Target 3: single-outcome anchoring --------------------------------------------------

  pi.registerTool({
    name: "dev_outcome_met",
    label: "Outcome Met",
    description:
      "Declare that the anchored outcome is satisfied, with raw evidence visible in the transcript (exit codes, test summary lines). Stops the anchored run. Do not call it for partial progress.",
    promptSnippet: "Declare the anchored outcome met with evidence",
    parameters: Type.Object({
      task: Type.String({ description: "The taskNotes directory name for the anchored outcome." }),
      evidence: Type.String({ description: "Raw transcript-visible evidence, e.g. exit codes and test summary lines." }),
    }),
    async execute(_toolCallId, { task, evidence }, _signal, _update, ctx) {
      if (!anchor || anchor.task !== task) {
        return { content: [{ type: "text", text: `No active anchored outcome for "${task}".` }], details: {} };
      }
      anchor.met = true;
      anchor.exhausted = false;
      pi.appendEntry(OUTCOME_ENTRY, { task, met: true, evidence, at: Date.now() });
      renderStatus(ctx);
      return { content: [{ type: "text", text: `Outcome marked met for ${task}. Evidence recorded.` }], details: {} };
    },
  });

  pi.on("agent_before_settle", async (event, ctx) => {
    if (event.outcome !== "completed") return;
    const active = anchor;
    if (!active || active.met || !event.context.canContinue) return;

    if (turnsUsed >= active.budget) {
      active.exhausted = true;
      renderStatus(ctx);
      ctx.ui.notify(`sandbox-dev: outcome budget exhausted (${active.budget} turns). Stopping.`, "warning");
      return {
        entries: [
          {
            type: "custom_message",
            customType: ANCHOR_MESSAGE,
            display: true,
            content: `OUTCOME BUDGET EXHAUSTED (${active.budget} turns). Stop and report what the outcome still needs; do not continue.`,
          },
        ],
      };
    }

    turnsUsed += 1;
    renderStatus(ctx);
    return {
      continue: true,
      entries: [
        { type: "custom_message", customType: ANCHOR_MESSAGE, display: true, content: anchorMessage(active, turnsUsed) },
      ],
    };
  });

  pi.registerCommand("dev-status", {
    description: "Show the active anchored outcome and its turn budget",
    handler: async (_args, ctx) => {
      const active = anchor ?? pendingAnchor;
      if (!active) {
        ctx.ui.notify("sandbox-dev: no plan gate or anchored outcome.", "info");
        return;
      }
      if (!anchor) {
        ctx.ui.notify(`sandbox-dev: awaiting the human's approval for ${active.task}.`, "warning");
        return;
      }
      const lines = [
        `task: ${anchor.task}`,
        `met: ${anchor.met}`,
        `exhausted: ${anchor.exhausted}`,
        `turn: ${turnsUsed}/${anchor.budget}`,
        "",
        anchor.outcome,
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
      renderStatus(ctx);
      ctx.ui.notify("sandbox-dev: gate and anchor cleared for this session.", "info");
    },
  });
}

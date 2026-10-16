import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, agentDir } from "./config.ts";
import { DEFAULT_CONFIG, classifyToolCall, type SandboxDevConfig } from "./rules.ts";
import {
  anchorMessage,
  countAnchorContinuations,
  extractOutcome,
  findLatestApproval,
  hashPlan,
  isOutcomeMet,
  type ApprovalRecord,
} from "./state.ts";

const STATUS_KEY = "sandbox-dev";
const APPROVAL_ENTRY = "sandbox-dev-approval";
const OUTCOME_ENTRY = "sandbox-dev-outcome";
const ANCHOR_MESSAGE = "sandbox-dev-anchor";
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE_HINT = "[g]o · [t]weak: <feedback> · [r]eject/show full plan";

interface Anchor extends ApprovalRecord {
  met: boolean;
}

export default function sandboxDev(pi: ExtensionAPI) {
  let config: SandboxDevConfig = DEFAULT_CONFIG;
  let anchor: Anchor | undefined;
  let turnsUsed = 0;

  const status = (ctx: ExtensionContext, text: string | undefined) => {
    if (ctx.mode === "tui" || ctx.mode === "rpc") ctx.ui.setStatus(STATUS_KEY, text);
  };

  const renderStatus = (ctx: ExtensionContext) => {
    if (!anchor) {
      status(ctx, undefined);
      return;
    }
    const label = anchor.met ? "outcome met" : `turn ${turnsUsed}/${anchor.budget}`;
    status(ctx, `sandbox-dev · ${anchor.task} · ${label}`);
  };

  const readPlan = (cwd: string, task: string): { text: string } | undefined => {
    if (!/^[A-Za-z0-9._-]+$/.test(task)) return undefined;
    try {
      return { text: readFileSync(join(cwd, "taskNotes", task, "taskFindings.md"), "utf8") };
    } catch {
      return undefined;
    }
  };

  /** Read the plan from disk, then present the go / tweak / show gate and arm the outcome anchor.
   *  `go` approves; `tweak` returns the human's feedback verbatim; `show` re-reads the full plan. */
  const approve = async (
    task: string,
    ctx: ExtensionContext,
  ): Promise<{ ok: boolean; message: string; feedback?: string; cancelled?: boolean; record?: ApprovalRecord }> => {
    const plan = readPlan(ctx.cwd, task);
    if (!plan) {
      return { ok: false, message: `No plan at taskNotes/${task}/taskFindings.md. Run /codePlanner first.` };
    }
    const outcome = extractOutcome(plan.text);
    if (!outcome) {
      return { ok: false, message: `taskNotes/${task}/taskFindings.md has no "Original Ask" section to anchor.` };
    }
    const record: ApprovalRecord = {
      task,
      planHash: hashPlan(plan.text),
      outcome,
      budget: config.budget,
      approvedAt: Date.now(),
    };
    if (!ctx.hasUI) {
      return { ok: false, message: `No UI available; refusing to auto-approve. Plan (${record.planHash}):\n\n${plan.text}` };
    }

    // The original typed gate: [g]o · [t]weak: <feedback> · [r]eject/show full plan.
    for (;;) {
      const answer = await ctx.ui.input(`Plan ${task} (plan ${record.planHash}) - ${GATE_HINT}`);
      if (answer === undefined || answer === null) {
        return { ok: false, cancelled: true, message: "Approval cancelled; the plan is unchanged. Do not implement." };
      }
      const reply = String(answer).trim();
      if (!reply) continue;
      const lower = reply.toLowerCase();
      if (["g", "go", "yes", "y"].includes(lower)) {
        pi.appendEntry(APPROVAL_ENTRY, record);
        anchor = { ...record, met: false };
        turnsUsed = 0;
        renderStatus(ctx);
        return { ok: true, message: `Approved ${task} (plan ${record.planHash}). Outcome anchored.`, record };
      }
      if (["r", "reject", "show", "plan"].includes(lower)) {
        await ctx.ui.editor(`Full plan: taskNotes/${task}/taskFindings.md (close to return to the gate)`, plan.text);
        continue;
      }
      // Anything else is feedback: `t: …`, `tweak: …`, `t` alone (multi-line editor), or a plain message.
      let feedback: string;
      if (["t", "tweak"].includes(lower)) {
        const edited = await ctx.ui.editor("Feedback to fold into the plan (Esc to go back):", "");
        if (edited === undefined) continue;
        feedback = edited.trim();
      } else {
        feedback = reply.replace(/^(t|tweak)\s*:\s*/i, "").trim();
      }
      if (!feedback) continue;
      return { ok: false, feedback, message: `Not approved. The human replied with feedback instead of \`g\`: ${feedback}` };
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    const loaded = loadConfig(ctx.cwd, agentDir());
    config = loaded.config;
    if (loaded.errors.length > 0) {
      ctx.ui.notify(`sandbox-dev config ignored: ${loaded.errors.join("; ")}`, "warning");
    }
    const entries = ctx.sessionManager.getBranch();
    const record = findLatestApproval(entries);
    if (record && !isOutcomeMet(entries, record.task)) {
      anchor = { ...record, met: false };
      turnsUsed = countAnchorContinuations(entries);
    } else {
      anchor = undefined;
      turnsUsed = 0;
    }
    renderStatus(ctx);
  });

  // Tell the model where the native procedure files live, so it can read them from any cwd.
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\nsandbox-dev procedure files (absolute paths): ${["codePlanner", "startWork", "completeWork"]
      .map((name) => join(PACKAGE_ROOT, "prompts", `${name}.md`))
      .join(", ")}.`,
  }));

  // --- Target 1: minimal permission model -------------------------------------------------

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "dev_request_approval" || event.toolName === "dev_outcome_met") return;
    const input = event.input as unknown as Record<string, unknown>;
    const decision = classifyToolCall({ toolName: event.toolName, input }, config, ctx.cwd);
    if (decision.verdict === "allow") return;
    if (decision.verdict === "deny") {
      ctx.ui.notify(`sandbox-dev denied ${event.toolName}: ${decision.reason}`, "error");
      return { block: true, reason: `sandbox-dev: ${decision.reason}` };
    }
    if (!ctx.hasUI) {
      return { block: true, reason: `sandbox-dev: ${decision.reason}; no UI to confirm, failing closed` };
    }
    const preview = JSON.stringify(input).slice(0, 500);
    const confirmed = await ctx.ui.confirm("sandbox-dev permission", `${event.toolName}: ${decision.reason}\n\n${preview}`);
    return confirmed ? undefined : { block: true, reason: "sandbox-dev: denied by user" };
  });

  pi.on("user_bash", async (event, ctx) => {
    const decision = classifyToolCall({ toolName: "bash", input: { command: event.command } }, config, ctx.cwd);
    if (decision.verdict === "allow") return;
    const block = (output: string) => ({ result: { output, exitCode: 1, cancelled: false, truncated: false } });
    if (decision.verdict === "deny") return block(`sandbox-dev blocked: ${decision.reason}`);
    if (!ctx.hasUI) return block(`sandbox-dev: ${decision.reason}; no UI to confirm, failing closed`);
    const confirmed = await ctx.ui.confirm("sandbox-dev permission", event.command);
    return confirmed ? undefined : block("sandbox-dev: denied by user");
  });

  // --- Target 2: explicit plan approval ----------------------------------------------------

  pi.registerTool({
    name: "dev_request_approval",
    label: "Dev Plan Approval",
    description:
      "Read taskNotes/<task>/taskFindings.md from disk and present the typed plan gate: `g` (go/approve), `t: <feedback>` or `t` (tweak - the human's feedback returns to you verbatim), `r` (reject/show the full plan, then choose again). Call this at the plan checkpoint before any implementation. Only `g` approves.",
    promptSnippet: "Request explicit human approval for a plan",
    parameters: Type.Object({
      task: Type.String({ description: "The taskNotes directory name for this plan." }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, { task }, _signal, _update, ctx) {
      const result = await approve(task, ctx);
      let text = result.ok ? result.message : `NOT APPROVED. ${result.message}`;
      if (result.feedback) {
        text += `\n\nRevise taskNotes/${task}/taskFindings.md to address that feedback, re-run the digest, then call dev_request_approval again. Do not implement yet.`;
      }
      return { content: [{ type: "text", text }], details: result.record };
    },
  });

  pi.registerCommand("dev-approve", {
    description: "Approve a plan (typed confirmation) and start the anchored implementation",
    handler: async (args, ctx) => {
      const task = args.trim() || anchor?.task || "";
      if (!task) {
        ctx.ui.notify("Usage: /dev-approve <task-directory>", "warning");
        return;
      }
      const result = await approve(task, ctx);
      ctx.ui.notify(result.message, result.ok ? "info" : "warning");
      if (result.ok) {
        pi.sendUserMessage(`/startWork taskNotes/${task}/taskFindings.md, mode: autonomous`, {
          deliverAs: "followUp",
          expandPromptTemplates: true,
        });
      } else if (result.feedback) {
        pi.sendUserMessage(
          `Plan ${task} was not approved. Fold this human feedback into taskNotes/${task}/taskFindings.md, then re-run the Phase 2 digest and request approval again: ${result.feedback}`,
          { deliverAs: "followUp" },
        );
      }
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
      active.met = true;
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
      if (!anchor) {
        ctx.ui.notify("sandbox-dev: no active anchored outcome.", "info");
        return;
      }
      const lines = [
        `task: ${anchor.task} (plan ${anchor.planHash})`,
        `met: ${anchor.met}`,
        `turn: ${turnsUsed}/${anchor.budget}`,
        "",
        anchor.outcome,
      ].join("\n");
      ctx.ui.notify(lines, anchor.met ? "info" : "warning");
    },
  });

  pi.registerCommand("dev-reset", {
    description: "Clear the in-session anchor (session entries are preserved)",
    handler: async (_args, ctx) => {
      anchor = undefined;
      turnsUsed = 0;
      renderStatus(ctx);
      ctx.ui.notify("sandbox-dev: anchor cleared for this session.", "info");
    },
  });
}

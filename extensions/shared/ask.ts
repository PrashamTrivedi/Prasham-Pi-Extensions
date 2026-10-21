/**
 * ask — the shared AskUserQuestion interaction. One entry point for the
 * `ask_user_question` tool and the Duck/Brainstorm wrappers.
 *
 * Dispatches on the session mode:
 *   - tui        -> the shared questionnaire modal (runQuestionnaire)
 *   - rpc        -> per-question select()/input() dialogs
 *   - json/print -> never blocks; returns asked:false so the caller proceeds
 *                   with stated assumptions or stops for the next human turn.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  runQuestionnaire,
  type QuestionnaireAnswer,
  type QuestionnaireQuestion,
} from "./questionnaire.ts";

/** Claude-Code parity: at most four questions, at most four options each. */
export const ASK_MAX_QUESTIONS = 4;
export const ASK_MAX_OPTIONS = 4;
export const ASK_HEADER_MAX = 12;

/** The "Type something." escape shown when a question allows free text. */
export const ASK_CUSTOM_LABEL = "Type something.";

export interface AskOutcome {
  /** False only when there is no interactive UI to ask in (json/print). */
  asked: boolean;
  /** True when the human dismissed the dialog (Esc / cancel). */
  cancelled: boolean;
  reason?: "no UI" | "no questions";
  answers: QuestionnaireAnswer[];
  questions: QuestionnaireQuestion[];
}

/**
 * Clamp untrusted model-supplied questions to the documented limits and fill
 * defaults (`id` -> qN, `label` -> QN, `allowOther` -> true). Pure.
 */
export function normalizeQuestions(questions: QuestionnaireQuestion[]): QuestionnaireQuestion[] {
  return questions.slice(0, ASK_MAX_QUESTIONS).map((question, index) => {
    const options = (question.options ?? []).slice(0, ASK_MAX_OPTIONS).map((option) => ({
      label: option.label,
      ...(option.description ? { description: option.description } : {}),
    }));
    return {
      id: question.id.trim() || `q${index + 1}`,
      label: (question.label ?? "").trim().slice(0, ASK_HEADER_MAX) || `Q${index + 1}`,
      prompt: question.prompt.trim(),
      options,
      allowOther: question.allowOther !== false,
    };
  });
}

/** RPC fallback: one select() (or input()) dialog per question, in order. */
async function askViaDialogs(ctx: ExtensionContext, questions: QuestionnaireQuestion[]): Promise<AskOutcome> {
  const answers: QuestionnaireAnswer[] = [];
  for (const question of questions) {
    const labels = question.options.map((option) => option.label);
    if (question.allowOther) labels.push(ASK_CUSTOM_LABEL);
    const picked = await ctx.ui.select(question.prompt, labels);
    if (picked === undefined) return { asked: true, cancelled: true, answers, questions };
    if (picked === ASK_CUSTOM_LABEL) {
      const value = await ctx.ui.input(question.prompt);
      if (value === undefined) return { asked: true, cancelled: true, answers, questions };
      const label = value.trim() || "(no response)";
      answers.push({ id: question.id, value: label, label, wasCustom: true });
    } else {
      const index = labels.indexOf(picked);
      answers.push({ id: question.id, value: picked, label: picked, wasCustom: false, index: index + 1 });
    }
  }
  return { asked: true, cancelled: false, answers, questions };
}

/**
 * Present `questions` and resolve with the outcome. Never throws on missing UI;
 * headless sessions receive `{ asked: false, reason: "no UI" }` so the caller
 * can decide whether to ask in prose or proceed.
 */
export async function askUserQuestions(
  ctx: ExtensionContext,
  questions: QuestionnaireQuestion[],
): Promise<AskOutcome> {
  const normalized = normalizeQuestions(questions);
  if (normalized.length === 0) {
    return { asked: false, cancelled: false, reason: "no questions", answers: [], questions: [] };
  }
  if (ctx.mode === "tui") {
    const answers = await runQuestionnaire(ctx, normalized);
    if (answers === undefined) return { asked: true, cancelled: true, answers: [], questions: normalized };
    return { asked: true, cancelled: false, answers, questions: normalized };
  }
  if (ctx.hasUI) return askViaDialogs(ctx, normalized);
  return { asked: false, cancelled: false, reason: "no UI", answers: [], questions: normalized };
}

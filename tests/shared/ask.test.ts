import { describe, expect, test } from "bun:test";
import {
  ASK_HEADER_MAX,
  ASK_MAX_OPTIONS,
  ASK_MAX_QUESTIONS,
  askUserQuestions,
  normalizeQuestions,
} from "../../extensions/shared/ask.ts";
import type { QuestionnaireQuestion } from "../../extensions/shared/questionnaire.ts";

const q = (over: Partial<QuestionnaireQuestion> = {}): QuestionnaireQuestion => ({
  id: "q1",
  label: "Scope",
  prompt: "Pick a scope",
  options: [{ label: "A" }, { label: "B" }],
  allowOther: true,
  ...over,
});

describe("normalizeQuestions", () => {
  test("clamps questions to the max", () => {
    const many = Array.from({ length: 6 }, (_, index) => q({ id: `q${index}`, prompt: `p${index}` }));
    expect(normalizeQuestions(many)).toHaveLength(ASK_MAX_QUESTIONS);
  });

  test("clamps options to the max", () => {
    const manyOptions = q({
      options: Array.from({ length: 6 }, (_, index) => ({ label: `o${index}` })),
    });
    expect(normalizeQuestions([manyOptions])[0]!.options).toHaveLength(ASK_MAX_OPTIONS);
  });

  test("fills defaults and truncates the header", () => {
    const [normalized] = normalizeQuestions([
      { id: "", label: "A".repeat(30), prompt: "  hi  ", options: [], allowOther: false },
    ]);
    expect(normalized!.id).toBe("q1");
    expect(normalized!.label).toHaveLength(ASK_HEADER_MAX);
    expect(normalized!.prompt).toBe("hi");
    expect(normalized!.allowOther).toBe(false);
  });
});

describe("askUserQuestions", () => {
  test("returns asked:false in headless mode without touching the UI", async () => {
    const ctx = {
      mode: "print",
      hasUI: false,
      ui: { select: () => { throw new Error("the UI must not be opened headless"); } },
    } as never;
    expect(await askUserQuestions(ctx, [q()])).toMatchObject({ asked: false, cancelled: false, reason: "no UI" });
  });

  test("returns asked:false for an empty question list", async () => {
    const ctx = { mode: "tui", hasUI: true, ui: { custom: () => { throw new Error("no UI"); } } } as never;
    expect(await askUserQuestions(ctx, [])).toMatchObject({ asked: false, reason: "no questions" });
  });

  test("rpc path resolves selections via ctx.ui.select", async () => {
    const ctx = { mode: "rpc", hasUI: true, ui: { select: async () => "B" } } as never;
    const outcome = await askUserQuestions(ctx, [q()]);
    expect(outcome.asked).toBe(true);
    expect(outcome.cancelled).toBe(false);
    expect(outcome.answers[0]).toMatchObject({ id: "q1", value: "B", label: "B", wasCustom: false });
  });

  test("rpc cancel (select returns undefined) marks cancelled", async () => {
    const ctx = { mode: "rpc", hasUI: true, ui: { select: async () => undefined } } as never;
    expect(await askUserQuestions(ctx, [q()])).toMatchObject({ asked: true, cancelled: true });
  });
});

import { describe, expect, test } from "bun:test";
import { composeDuckAnswers, toQuestionnaireQuestions } from "../../extensions/duck/answers.ts";
import { parseDuckQuestions } from "../../extensions/duck/questions.ts";

const question = (overrides: Record<string, unknown> = {}) => ({
  header: "Scope",
  question: "How wide is this?",
  options: [{ label: "Narrow" }, { label: "Wide", description: "more work" }],
  allowOther: true,
  ...overrides,
});

describe("parseDuckQuestions", () => {
  test("parses a bare JSON array", () => {
    const result = parseDuckQuestions(JSON.stringify([question()]));
    expect(result.ok).toBe(true);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]).toMatchObject({ id: "q1", header: "Scope", allowOther: true });
    expect(result.questions[0]!.options).toEqual([{ label: "Narrow" }, { label: "Wide", description: "more work" }]);
  });

  test("tolerates a fenced array wrapped in prose", () => {
    const text = `Here you go:\n\`\`\`json\n${JSON.stringify([question()])}\n\`\`\`\nThanks!`;
    expect(parseDuckQuestions(text).ok).toBe(true);
  });

  test("ignores brackets inside strings while scanning", () => {
    const text = `note [ignore me] ${JSON.stringify([question({ question: "A [bracketed] question?" })])}`;
    const result = parseDuckQuestions(text);
    expect(result.questions[0]!.question).toBe("A [bracketed] question?");
  });

  test("caps the count at four and options at four", () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      question({ header: `H${index}`, options: Array.from({ length: 6 }, (_, option) => ({ label: `o${option}` })) }),
    );
    const result = parseDuckQuestions(JSON.stringify(many));
    expect(result.questions).toHaveLength(4);
    expect(result.questions[0]!.options).toHaveLength(4);
  });

  test("truncates the header and defaults allowOther", () => {
    const result = parseDuckQuestions(JSON.stringify([question({ header: "a very long header", allowOther: undefined })]));
    expect(result.questions[0]!.header).toHaveLength(12);
    expect(result.questions[0]!.allowOther).toBe(true);
  });

  test("honours allowOther false and drops options that cannot be used", () => {
    const result = parseDuckQuestions(JSON.stringify([question({ allowOther: false, options: [{ label: "" }, "nope"] })]));
    expect(result.questions[0]!.allowOther).toBe(false);
    expect(result.questions[0]!.options).toEqual([]);
  });

  test("returns an empty result for prose, an empty array, or items with no question", () => {
    expect(parseDuckQuestions("no json here")).toEqual({ questions: [], ok: false });
    expect(parseDuckQuestions("[]")).toEqual({ questions: [], ok: false });
    expect(parseDuckQuestions("[{header:'x'}]")).toEqual({ questions: [], ok: false });
  });
});

describe("answers", () => {
  test("maps questions to questionnaire tabs and composes the block", () => {
    const questions = parseDuckQuestions(JSON.stringify([question({ header: "Scope" })])).questions;
    const tabs = toQuestionnaireQuestions(questions);
    expect(tabs[0]).toMatchObject({ id: "q1", label: "Scope", prompt: "How wide is this?" });

    const block = composeDuckAnswers(questions, [
      { id: "q1", value: "Wide", label: "Wide", wasCustom: false, index: 2 },
    ]);
    expect(block).toContain("**Duck answers**");
    expect(block).toContain("- **Scope**: Wide");
  });

  test("marks a typed answer and skips unanswered questions", () => {
    const questions = parseDuckQuestions(JSON.stringify([question(), question({ header: "Second" })])).questions;
    const block = composeDuckAnswers(questions, [{ id: "q1", value: "custom", label: "custom", wasCustom: true }]);
    expect(block).toContain("- **Scope**: (wrote) custom");
    expect(block).not.toContain("Second");
  });
});

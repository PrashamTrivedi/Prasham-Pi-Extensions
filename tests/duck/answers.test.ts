import { describe, expect, test } from "bun:test";
import { toAskQuestions } from "../../extensions/duck/answers.ts";
import type { DuckQuestion } from "../../extensions/duck/questions.ts";

const question: DuckQuestion = {
  id: "q1",
  header: "Scope",
  question: "How wide?",
  options: [{ label: "Narrow", description: "One module" }, { label: "Wide" }],
  allowOther: true,
};

describe("toAskQuestions", () => {
  test("maps header -> label and question -> prompt", () => {
    const [mapped] = toAskQuestions([question]);
    expect(mapped).toEqual({
      id: "q1",
      label: "Scope",
      prompt: "How wide?",
      options: [{ label: "Narrow", description: "One module" }, { label: "Wide" }],
      allowOther: true,
    });
  });

  test("drops descriptions when absent", () => {
    const bare: DuckQuestion = { id: "q1", header: "Q1", question: "x?", options: [{ label: "A" }], allowOther: false };
    expect(toAskQuestions([bare])[0]!.options).toEqual([{ label: "A" }]);
    expect(toAskQuestions([bare])[0]!.allowOther).toBe(false);
  });
});

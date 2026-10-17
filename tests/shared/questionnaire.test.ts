import { expect, test } from "bun:test";
import { runQuestionnaire } from "../../extensions/shared/questionnaire.ts";

const question = { id: "q1", label: "Q1", prompt: "Pick one", options: [{ label: "A" }], allowOther: true };

test("returns undefined outside tui mode without touching the UI", async () => {
  const ctx = {
    mode: "print",
    ui: {
      custom: () => {
        throw new Error("the UI must not be opened outside TUI mode");
      },
    },
  } as never;
  expect(await runQuestionnaire(ctx, [question])).toBeUndefined();
});

test("returns undefined for an empty question list", async () => {
  const ctx = {
    mode: "tui",
    ui: {
      custom: () => {
        throw new Error("the UI must not be opened with no questions");
      },
    },
  } as never;
  expect(await runQuestionnaire(ctx, [])).toBeUndefined();
});

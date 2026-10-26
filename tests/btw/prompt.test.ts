import { describe, expect, test } from "bun:test";
import {
  buildBtwQuestion,
  buildBtwSystemPrompt,
  buildSummaryPrompt,
  buildSummarySystemPrompt,
  renderSideChat,
  type BtwSideMessage,
} from "../../extensions/btw/prompt.ts";

const side: BtwSideMessage[] = [
  { role: "user", text: "What did we change?" },
  { role: "assistant", text: "The parser now skips thinking blocks [m2]." },
  { role: "user", text: "Any risk?" },
  { role: "assistant", text: "Only the transcript budget [m4]." },
];

describe("buildBtwSystemPrompt", () => {
  test("states the transcript-only contract and the refusal phrase", () => {
    const prompt = buildBtwSystemPrompt();
    expect(prompt).toContain("ONLY from the MAIN CHAT TRANSCRIPT");
    expect(prompt).toContain("Not in this chat");
    expect(prompt).toContain("Cite the transcript block");
    expect(prompt).not.toContain("SYSTEM PROMPT");
  });
});

describe("buildBtwQuestion", () => {
  test("separates the transcript, prior side chat, and current question", () => {
    const prompt = buildBtwQuestion({
      transcript: "[m1] User\nHello",
      side: side.slice(0, 2),
      question: "What about tests?",
    });
    expect(prompt).toContain("<main-chat-transcript>");
    expect(prompt).toContain("[m1] User\nHello");
    expect(prompt).toContain("<btw-side-chat>");
    expect(prompt).toContain("Q: What did we change?");
    expect(prompt).toContain("<question>\nWhat about tests?\n</question>");
  });

  test("renders an empty transcript and empty side chat explicitly", () => {
    const prompt = buildBtwQuestion({ transcript: "  ", side: [], question: "Anything?" });
    expect(prompt).toContain("(empty)");
    expect(prompt).toContain("(none)");
  });
});

describe("renderSideChat", () => {
  test("renders Q/A in order", () => {
    expect(renderSideChat(side)).toContain("Q: What did we change?");
    expect(renderSideChat(side)).toContain("A: Only the transcript budget [m4].");
  });

  test("drops the oldest entries and says so when bounded", () => {
    const text = renderSideChat(side, 100);
    expect(text).toContain("older side-chat message(s) omitted");
    expect(text).toContain("Only the transcript budget");
  });
});

describe("buildSummaryPrompt", () => {
  test("asks for a title and bullets from the side chat only", () => {
    const prompt = buildSummaryPrompt(side);
    expect(prompt).toContain("TITLE:");
    expect(prompt).toContain("Use only the side chat");
    expect(prompt).toContain("Q: Any risk?");
    expect(prompt).not.toContain("MAIN CHAT TRANSCRIPT");
  });

  test("the summary system prompt stays inside the side chat", () => {
    expect(buildSummarySystemPrompt()).toContain("Use only the provided side chat");
  });
});

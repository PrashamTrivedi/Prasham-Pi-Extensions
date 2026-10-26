import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderBtwView, type BtwTheme, type BtwViewInput } from "../../extensions/btw/view.ts";
import type { BtwSideMessage } from "../../extensions/btw/prompt.ts";

const theme: BtwTheme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

const messages: BtwSideMessage[] = [
  { role: "user", text: "What changed in the parser?" },
  { role: "assistant", text: "It now skips thinking blocks and cites turns. [m2]" },
];

function input(overrides: Partial<BtwViewInput> = {}): BtwViewInput {
  return {
    model: "opencode-go/beam-free",
    messages,
    streaming: false,
    inputLines: [" > ask something"],
    offset: 0,
    ...overrides,
  };
}

describe("renderBtwView", () => {
  test("renders exactly the requested height and width", () => {
    const result = renderBtwView(input(), theme, 80, 30);
    expect(result.lines.length).toBe(30);
    expect(result.lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
    expect(result.lines[0]).toContain("◆ BTW · side chat");
    expect(result.lines[0]).toContain("opencode-go/beam-free");
    expect(result.lines.join("\n")).toContain("You");
    expect(result.lines.join("\n")).toContain("BTW");
    expect(result.lines.join("\n")).toContain("alt+s summary");
  });

  test("shows the side-chat prompt when empty", () => {
    const result = renderBtwView(input({ messages: [] }), theme, 60, 20);
    expect(result.lines.join("\n")).toContain("Ask anything about this chat");
  });

  test("shows the streaming caret on the last answer", () => {
    const result = renderBtwView(input({ streaming: true }), theme, 80, 20);
    expect(result.lines.join("\n")).toContain("▍");
  });

  test("shows a truncation or model notice in the footer", () => {
    const result = renderBtwView(input({ notice: "Transcript truncated: 3 older block(s) omitted." }), theme, 100, 20);
    expect(result.lines.join("\n")).toContain("Transcript truncated");
  });

  test("scrolls a long body and reports the maximum offset", () => {
    const many: BtwSideMessage[] = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      text: `message ${index} `.repeat(12),
    }));
    const top = renderBtwView(input({ messages: many, offset: 0 }), theme, 80, 24);
    expect(top.maxOffset).toBeGreaterThan(0);
    expect(top.lines.join("\n")).toContain("message 0");
    const bottom = renderBtwView(input({ messages: many, offset: top.maxOffset }), theme, 80, 24);
    expect(bottom.lines.join("\n")).toContain("message 19");
  });

  test("narrow terminals stay within the width", () => {
    const result = renderBtwView(input({ model: "a-very-long-provider/a-very-long-model-name" }), theme, 24, 18);
    expect(result.lines.length).toBe(18);
    expect(result.lines.every((line) => visibleWidth(line) <= 24)).toBe(true);
  });

  test("terminal escapes in chat text are stripped", () => {
    const result = renderBtwView(
      input({ messages: [{ role: "assistant", text: "a\x1b[31mred\x1b[0mb" }] }),
      theme,
      80,
      20,
    );
    const text = result.lines.join("\n");
    expect(text).toContain("aredb");
    expect(text).not.toContain("\x1b");
  });

  test("an error is shown under the answer", () => {
    const result = renderBtwView(
      input({ messages: [{ role: "assistant", text: "partial", error: "rate limited" }] }),
      theme,
      80,
      20,
    );
    expect(result.lines.join("\n")).toContain("[error: rate limited]");
  });

  test("sizes the body around the editor lines", () => {
    const result = renderBtwView(input({ inputLines: ["1", "2", "3", "4", "5", "6"] }), theme, 80, 30);
    expect(result.bodyRows).toBe(30 - 2 - 6 - 2);
    expect(result.lines.length).toBe(30);
  });
});

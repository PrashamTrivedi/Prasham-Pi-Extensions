import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderBtwPanel, renderBtwView, type BtwTheme, type BtwViewInput } from "../../extensions/btw/view.ts";
import type { BtwSideMessage } from "../../extensions/btw/prompt.ts";

const theme: BtwTheme = {
  fg: (_color, text) => text,
  bg: (_color, text) => text,
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
    expect(result.lines.join("\n")).toContain("What changed in the parser?");
    expect(result.lines.join("\n")).toContain("It now skips thinking blocks");
    expect(result.lines.join("\n")).toContain("alt+s summary");
  });

  test("renders message bodies as markdown like the main chat", () => {
    const result = renderBtwView(
      input({
        messages: [
          { role: "user", text: "## What changed?\n\nA **bold** question with `code`." },
          { role: "assistant", text: "## Answer\n\n- one\n- two\n\n```ts\nconst x = 1;\n```" },
        ],
      }),
      theme,
      80,
      30,
    );
    // Another test file may have initialized Pi's theme, so code blocks can carry
    // syntax-highlight colors; compare on plain text.
    const text = result.lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    expect(text).toContain("What changed?");
    expect(text).not.toContain("## What changed?");
    expect(text).toContain("bold");
    expect(text).not.toContain("**bold**");
    expect(text).toContain("Answer");
    expect(text).not.toContain("## Answer");
    expect(text).toContain("- one");
    expect(text).toContain("const x = 1;");
  });

  test("reuses a finished message's render and follows edits", () => {
    const calls: string[] = [];
    const recording: BtwTheme = {
      fg: (color, value) => {
        if (color.startsWith("md")) calls.push(color);
        return value;
      },
      bg: (_color, value) => value,
      bold: (text) => text,
    };
    const messages: BtwSideMessage[] = [{ role: "assistant", text: "## First" }];
    renderBtwView(input({ messages }), recording, 60, 20);
    const afterFirst = calls.length;
    renderBtwView(input({ messages }), recording, 60, 20);
    expect(calls.length).toBe(afterFirst);
    const edited = renderBtwView(input({ messages: [{ role: "assistant", text: "## Second" }] }), recording, 60, 20);
    expect(edited.lines.join("\n")).toContain("Second");
  });

  test("paints user messages with the main chat's message colors", () => {
    const calls: string[] = [];
    const recording: BtwTheme = {
      fg: (color, value) => {
        calls.push(`fg:${color}`);
        return value;
      },
      bg: (color, value) => {
        calls.push(`bg:${color}`);
        return value;
      },
      bold: (text) => text,
    };
    renderBtwView(
      input({ messages: [{ role: "user", text: "plain question" }, { role: "assistant", text: "# Heading" }] }),
      recording,
      60,
      20,
    );
    expect(calls).toContain("bg:userMessageBg");
    expect(calls).toContain("fg:userMessageText");
    expect(calls).toContain("fg:mdHeading");
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

describe("renderBtwPanel", () => {
  test("renders a framed, background-filled panel at exactly width × height", () => {
    const result = renderBtwPanel(input(), theme, 80, 24);
    expect(result.lines.length).toBe(24);
    expect(result.lines.every((line) => visibleWidth(line) === 80)).toBe(true);
    const text = result.lines.join("\n");
    expect(text).toContain("╭");
    expect(text).toContain("╰");
    expect(text).toContain("◆ BTW · side chat");
    expect(text).toContain("opencode-go/beam-free");
    expect(text).toContain("What changed in the parser?");
    expect(text).toContain("alt+s summary");
  });

  test("keeps the editor inside the frame", () => {
    const result = renderBtwPanel(input({ inputLines: [" > ask something"] }), theme, 80, 24);
    expect(result.lines.join("\n")).toContain("> ask something");
  });

  test("scrolls the transcript but keeps the editor fixed", () => {
    const many: BtwSideMessage[] = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      text: `message ${index} `.repeat(12),
    }));
    const top = renderBtwPanel(input({ messages: many, inputLines: [" > still here"], offset: 0 }), theme, 80, 30);
    expect(top.maxOffset).toBeGreaterThan(0);
    expect(top.lines.join("\n")).toContain("message 0");
    expect(top.lines.join("\n")).toContain("> still here");
    // The footer always shows the visible range, so scrolling is visibly working.
    expect(top.lines.join("\n")).toMatch(/1-\d+\/\d+/);
    const bottom = renderBtwPanel(
      input({ messages: many, inputLines: [" > still here"], offset: top.maxOffset }),
      theme,
      80,
      30,
    );
    expect(bottom.lines.join("\n")).toContain("message 19");
    expect(bottom.lines.join("\n")).toContain("> still here");
    expect(bottom.lines.join("\n")).not.toContain(" 1-");
  });

  test("shows the streaming caret and a notice in the footer", () => {
    const result = renderBtwPanel(
      input({ streaming: true, notice: "Transcript truncated: 2 older blocks omitted." }),
      theme,
      100,
      24,
    );
    expect(result.lines.join("\n")).toContain("▍");
    expect(result.lines.join("\n")).toContain("Transcript truncated");
  });

  test("survives a tiny panel without dropping the input", () => {
    const result = renderBtwPanel(input({ inputLines: [" > tiny", "second"] }), theme, 60, 8);
    expect(result.lines.length).toBe(8);
    expect(result.lines.every((line) => visibleWidth(line) === 60)).toBe(true);
    expect(result.lines.join("\n")).toContain("tiny");
  });
});

import { describe, expect, test } from "bun:test";
import type { TUI } from "@earendil-works/pi-tui";
import { BtwScreen, type BtwEditor, type BtwScreenState } from "../../extensions/btw/screen.ts";
import type { BtwTheme } from "../../extensions/btw/view.ts";

const theme: BtwTheme = { fg: (_color, text) => text, bold: (text) => text };

class FakeEditor implements BtwEditor {
  focused = false;
  text = "";
  onSubmit?: (text: string) => void;
  onChange?: (text: string) => void;
  invalidate(): void {}
  render(): string[] {
    return [`> ${this.text}`];
  }
  handleInput(data: string): void {
    if (data === "\r") {
      const value = this.text;
      this.text = "";
      this.onSubmit?.(value);
      return;
    }
    this.text += data;
    this.onChange?.(this.text);
  }
  getText(): string {
    return this.text;
  }
  setText(text: string): void {
    this.text = text;
  }
}

function harness(overrides: Partial<BtwScreenState> = {}) {
  const state: BtwScreenState = {
    model: "opencode-go/beam-free",
    messages: [{ role: "assistant", text: "The parser skips thinking. [m2]" }],
    streaming: false,
    ...overrides,
  };
  let renders = 0;
  const tui = { terminal: { rows: 30, columns: 80 }, requestRender: () => { renders += 1; } } as unknown as TUI;
  const editor = new FakeEditor();
  const asked: string[] = [];
  let summaries = 0;
  let closes = 0;
  const screen = new BtwScreen({
    tui,
    theme,
    state,
    editor,
    onAsk: (question) => asked.push(question),
    onSummary: () => { summaries += 1; },
    onClose: () => { closes += 1; },
  });
  return { screen, state, editor, asked, summaries: () => summaries, closes: () => closes, renders: () => renders };
}

describe("BtwScreen", () => {
  test("forwards focus to the editor", () => {
    const { screen, editor } = harness();
    screen.focused = true;
    expect(editor.focused).toBe(true);
    screen.focused = false;
    expect(editor.focused).toBe(false);
  });

  test("Enter asks the trimmed question and clears the editor", () => {
    const { screen, editor, asked, renders } = harness();
    editor.text = "  What about tests?  ";
    screen.handleInput("\r");
    expect(asked).toEqual(["What about tests?"]);
    expect(editor.text).toBe("");
    expect(renders()).toBeGreaterThan(0);
  });

  test("an empty or streaming question is ignored", () => {
    const { screen, editor, asked } = harness();
    editor.text = "   ";
    screen.handleInput("\r");
    expect(asked).toEqual([]);
    const streaming = harness({ streaming: true });
    streaming.editor.text = "question";
    streaming.screen.handleInput("\r");
    expect(streaming.asked).toEqual([]);
  });

  test("alt+s asks for a summary when an answer exists", () => {
    const { screen, summaries } = harness();
    screen.handleInput("\x1bs");
    expect(summaries()).toBe(1);
  });

  test("alt+s without an answer sets a status instead", () => {
    const { screen, state, summaries } = harness({ messages: [] });
    screen.handleInput("\x1bs");
    expect(summaries()).toBe(0);
    expect(state.status).toBe("Nothing to summarize yet.");
  });

  test("Escape closes", () => {
    const { screen, closes } = harness();
    screen.handleInput("\u001b");
    expect(closes()).toBe(1);
  });

  test("renders the full window height and forwards editor lines", () => {
    const { screen, editor } = harness();
    editor.text = "typed question";
    const lines = screen.render(80);
    expect(lines.length).toBe(27);
    expect(lines.join("\n")).toContain("typed question");
  });

  test("PageDown moves the body and PageUp returns", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      text: `message ${index} `.repeat(12),
    }));
    const { screen } = harness({ messages: many });
    screen.render(80);
    const bottom = screen.getState();
    expect(bottom.maxOffset).toBeGreaterThan(0);
    expect(bottom.offset).toBe(bottom.maxOffset);
    screen.handleInput("\x1b[5~");
    const up = screen.getState();
    expect(up.offset).toBeLessThan(bottom.maxOffset);
    expect(up.follow).toBe(false);
    screen.handleInput("\x1b[6~");
    expect(screen.getState().offset).toBeGreaterThan(up.offset);
  });
});

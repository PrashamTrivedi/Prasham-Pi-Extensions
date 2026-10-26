/**
 * The BTW full-window component. Rendering lives in `view.ts`; this file owns the
 * editor, keys, height fitting, and asking the controller for a new answer.
 */
import {
  Editor,
  Key,
  matchesKey,
  type Component,
  type EditorTheme,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import { windowHeight } from "../shared/full-screen.ts";
import type { BtwSideMessage } from "./prompt.ts";
import { renderBtwView, type BtwTheme } from "./view.ts";

/** Shared mutable state between the command controller and the screen. */
export interface BtwScreenState {
  model: string;
  messages: BtwSideMessage[];
  streaming: boolean;
  status?: string;
  notice?: string;
}

/** Minimal editor surface, so keys can be tested without a real terminal. */
export interface BtwEditor {
  focused: boolean;
  render(width: number): string[];
  handleInput(data: string): void;
  getText(): string;
  setText(text: string): void;
  invalidate?(): void;
  onSubmit?: (text: string) => void;
  onChange?: (text: string) => void;
}

export interface BtwScreenOptions {
  tui: TUI;
  theme: BtwTheme;
  state: BtwScreenState;
  onAsk: (question: string) => void;
  onSummary: () => void;
  onClose: () => void;
  /** Test seam; production creates a Pi `Editor`. */
  editor?: BtwEditor;
  /** Rows of the input editor kept visible; the cursor sits at the bottom. */
  maxInputRows?: number;
}

export class BtwScreen implements Component, Focusable {
  private readonly tui: TUI;
  private readonly theme: BtwTheme;
  private readonly state: BtwScreenState;
  private readonly onAsk: BtwScreenOptions["onAsk"];
  private readonly onSummary: BtwScreenOptions["onSummary"];
  private readonly onClose: BtwScreenOptions["onClose"];
  private readonly editor: BtwEditor;
  private readonly maxInputRows: number;
  private offset = 0;
  private follow = true;
  private lastMaxOffset = 0;
  private lastBodyRows = 0;

  constructor(options: BtwScreenOptions) {
    this.tui = options.tui;
    this.theme = options.theme;
    this.state = options.state;
    this.onAsk = options.onAsk;
    this.onSummary = options.onSummary;
    this.onClose = options.onClose;
    this.maxInputRows = Math.max(1, options.maxInputRows ?? 5);
    this.editor = options.editor ?? new Editor(this.tui, editorTheme(options.theme), { paddingX: 1 });
    this.editor.onSubmit = (value) => this.submit(value);
    this.editor.onChange = () => this.tui.requestRender();
  }

  get focused(): boolean {
    return this.editor.focused;
  }

  set focused(value: boolean) {
    this.editor.focused = value;
  }

  invalidate(): void {
    this.editor.invalidate?.();
  }

  /** Test/diagnostic snapshot of the scroll state. */
  getState(): { offset: number; follow: boolean; maxOffset: number; bodyRows: number } {
    return { offset: this.offset, follow: this.follow, maxOffset: this.lastMaxOffset, bodyRows: this.lastBodyRows };
  }

  /** Redraw after the controller mutates `state`. */
  refresh(): void {
    this.invalidate();
    this.tui.requestRender();
  }

  private submit(value: string): void {
    const question = value.trim();
    if (!question || this.state.streaming) return;
    this.editor.setText("");
    this.follow = true;
    this.offset = Number.MAX_SAFE_INTEGER;
    this.onAsk(question);
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.onClose();
      return;
    }
    if (matchesKey(data, Key.alt("s"))) {
      if (!this.state.streaming && this.state.messages.some((message) => message.role === "assistant" && message.text.trim())) {
        this.onSummary();
      } else {
        this.state.status = "Nothing to summarize yet.";
        this.refresh();
      }
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.follow = false;
      this.offset = Math.max(0, this.offset - Math.max(1, this.lastBodyRows - 2));
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.offset = Math.min(this.lastMaxOffset, this.offset + Math.max(1, this.lastBodyRows - 2));
      this.follow = this.offset >= this.lastMaxOffset;
      this.tui.requestRender();
      return;
    }
    this.editor.handleInput(data);
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const height = windowHeight(this.tui.terminal.rows);
    const rendered = this.editor.render(width);
    const inputLines = rendered.length > this.maxInputRows ? rendered.slice(-this.maxInputRows) : rendered;
    const view = renderBtwView(
      {
        model: this.state.model,
        messages: this.state.messages,
        streaming: this.state.streaming,
        status: this.state.status,
        notice: this.state.notice,
        inputLines,
        offset: this.follow ? Number.MAX_SAFE_INTEGER : this.offset,
      },
      this.theme,
      width,
      height,
    );
    this.lastMaxOffset = view.maxOffset;
    this.lastBodyRows = view.bodyRows;
    this.offset = this.follow ? view.maxOffset : Math.min(this.offset, view.maxOffset);
    return view.lines;
  }
}

function editorTheme(theme: BtwTheme): EditorTheme {
  return {
    borderColor: (text) => theme.fg("border", text),
    selectList: {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    },
  };
}

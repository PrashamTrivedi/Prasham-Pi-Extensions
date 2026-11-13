/**
 * The BTW side-chat overlay component. Rendering lives in `view.ts`; this file owns
 * the editor, keys, height fitting, and asking the controller for a new answer.
 */
import {
  Editor,
  Key,
  matchesKey,
  type Component,
  type EditorTheme,
  type Focusable,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { narrowHeight, panelHeight } from "./layout.ts";
import type { BtwSideMessage } from "./prompt.ts";
import { renderBtwPanel, renderBtwView, type BtwTheme } from "./view.ts";

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
  /** Full-width narrow overlay or the docked side panel. Default: full. */
  mode?: "full" | "panel";
  /** Rows to render. Defaults to `narrowHeight` (full) or `panelHeight` (panel). */
  height?: (rows: number) => number;
  /** Test seam; production creates a Pi `Editor`. */
  editor?: BtwEditor;
  /** Rows of the input editor kept visible; the cursor sits at the bottom. */
  maxInputRows?: number;
}

export class BtwScreen implements Component, Focusable {
  /**
   * The fullscreen viewport must never take PageUp/PageDown or the wheel for the
   * main chat while this screen is focused; they belong to the side chat.
   */
  readonly capturesViewportInput = true;
  private readonly tui: TUI;
  private readonly theme: BtwTheme;
  private readonly state: BtwScreenState;
  private readonly onAsk: BtwScreenOptions["onAsk"];
  private readonly onSummary: BtwScreenOptions["onSummary"];
  private readonly onClose: BtwScreenOptions["onClose"];
  private readonly mode: "full" | "panel";
  private readonly heightOf: (rows: number) => number;
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
    this.mode = options.mode ?? "full";
    this.heightOf = options.height ?? (this.mode === "panel" ? panelHeight : narrowHeight);
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

  /**
   * Scroll the transcript by `lines` (positive scrolls towards newer rows).
   * Pauses following until the bottom is reached again.
   */
  private scrollBy(lines: number): void {
    const max = this.lastMaxOffset;
    const from = this.follow ? max : this.offset;
    const next = Math.min(max, Math.max(0, from + lines));
    this.offset = next;
    this.follow = next >= max;
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
      this.scrollBy(-Math.max(1, this.lastBodyRows - 2));
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.scrollBy(Math.max(1, this.lastBodyRows - 2));
      return;
    }
    this.editor.handleInput(data);
    this.tui.requestRender();
  }

  /**
   * The overlay swallows wheel events that hit it, so without this handler a wheel
   * over the panel does nothing at all. Consume it and scroll the transcript.
   */
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "wheel") return undefined;
    const delta = event.wheelDelta ?? 0;
    if (delta !== 0) this.scrollBy(delta);
    return { handled: true, focus: true };
  }

  render(width: number): string[] {
    const height = this.heightOf(this.tui.terminal.rows);
    // The panel frame consumes two borders and one leading space per row.
    const contentWidth = this.mode === "panel" ? Math.max(1, width - 3) : width;
    const rendered = this.editor.render(contentWidth);
    const inputLines = rendered.length > this.maxInputRows ? rendered.slice(-this.maxInputRows) : rendered;
    const payload = {
      model: this.state.model,
      messages: this.state.messages,
      streaming: this.state.streaming,
      status: this.state.status,
      notice: this.state.notice,
      inputLines,
      offset: this.follow ? Number.MAX_SAFE_INTEGER : this.offset,
    };
    const view = this.mode === "panel"
      ? renderBtwPanel(payload, this.theme, width, height)
      : renderBtwView(payload, this.theme, width, height);
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

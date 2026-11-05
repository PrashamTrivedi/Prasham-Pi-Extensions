/**
 * The agent transcript rendered with Pi's own chat components.
 *
 * Pi exports the exact components its interactive window uses —
 * `UserMessageComponent`, `AssistantMessageComponent`, `ToolExecutionComponent` —
 * plus the built-in tool definitions that carry their renderers. Replaying a saved
 * session through them is what makes the agent view look like the window it came
 * from: markdown, thinking runs, bash/read/edit renderers, the same padding and
 * spacing. The previous hand-rolled renderer showed literal `**markdown**`, raw
 * JSON tool arguments, and a `thinking` label, which is why it looked wrong.
 *
 * The transcript is built once per session line and re-rendered only when the
 * width or a reading toggle changes, so following a live run stays cheap.
 */
import { Text, type Component, type MarkdownTheme, type TUI } from "@earendil-works/pi-tui";
import {
  AssistantMessageComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  getMarkdownTheme,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";

/** Pi's `<assistant>` scrollback zones mean nothing inside a custom screen. */
const ZONE = /\x1b\]133;[ABC]\x07/g;

/** Strips OSC 133 prompt-zone markers from a rendered line. */
export function stripZoneMarkers(line: string): string {
  return ZONE.test(line) ? line.replace(ZONE, "") : line;
}

/** The built-in tool definitions (and their renderers) for one working directory. */
export function builtinToolRenderers(cwd: string): Map<string, ToolRenderers> {
  const renderers = new Map<string, ToolRenderers>();
  const factories = [
    createReadToolDefinition,
    createBashToolDefinition,
    createEditToolDefinition,
    createWriteToolDefinition,
    createFindToolDefinition,
    createGrepToolDefinition,
    createLsToolDefinition,
  ];
  for (const factory of factories) {
    try {
      const definition = factory(cwd) as ToolRenderers & { name?: string };
      if (definition?.name) renderers.set(definition.name, definition);
    } catch {
      // A missing cwd or unsupported shell only costs the custom renderer; the
      // fallback still shows the call and its output.
    }
  }
  return renderers;
}

export interface NativeTranscriptOptions {
  /** Working directory the tool renderers resolve paths against (the agent's worktree). */
  cwd: string;
  ui: TUI;
  /** Pi's chat padding; `outputPad` in the agent settings (default 1). */
  outputPad?: number;
  hideThinking?: boolean;
  /** Tool output expanded (Pi's ctrl+o state). Default: collapsed previews. */
  expanded?: boolean;
  /** Fabric's own tools, whose renderers live in the extension. */
  renderers?: ReadonlyMap<string, ToolRenderers>;
  markdownTheme?: MarkdownTheme;
}

interface Block {
  component: Component;
  /** Set on a tool block so `e` can jump to a failed result. */
  error?: boolean;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const block = part as { type?: string; text?: string; mimeType?: string };
      if (block?.type === "text" && typeof block.text === "string") return block.text;
      if (block?.type === "image") return `[image ${block.mimeType ?? "attached"}]`;
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

function parseLine(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const entry = JSON.parse(trimmed) as unknown;
    return entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Replays session lines into Pi's components. `apply` is incremental: the pane
 * feeds only the lines it has not seen, exactly like the live tail reader.
 */
export class NativeTranscript {
  private readonly cwd: string;
  private readonly ui: TUI;
  private readonly outputPad: number;
  private readonly renderers: ReadonlyMap<string, ToolRenderers>;
  private readonly markdownTheme: MarkdownTheme;
  private blocks: Block[] = [];
  private tools = new Map<string, Block>();
  private cache?: { width: number; lines: string[]; errors: number[] };
  private hideThinking: boolean;
  private expanded: boolean;

  constructor(options: NativeTranscriptOptions) {
    this.cwd = options.cwd;
    this.ui = options.ui;
    this.outputPad = options.outputPad ?? 1;
    this.renderers = options.renderers ?? builtinToolRenderers(options.cwd);
    this.markdownTheme = options.markdownTheme ?? getMarkdownTheme();
    this.hideThinking = options.hideThinking ?? false;
    this.expanded = options.expanded ?? false;
  }

  /** Applies the complete lines of a session chunk. */
  apply(text: string): void {
    if (!text) return;
    for (const line of text.split("\n")) this.applyLine(line);
  }

  private push(component: Component, extra: Omit<Block, "component"> = {}): Block {
    const block: Block = { component, ...extra };
    this.blocks.push(block);
    this.cache = undefined;
    return block;
  }

  private applyLine(line: string): void {
    const entry = parseLine(line);
    if (!entry) return;
    if (entry.type === "branch_summary" && typeof entry.summary === "string") {
      try { this.push(new BranchSummaryMessageComponent({ role: "branchSummary", summary: entry.summary } as never, this.markdownTheme, this.outputPad)); }
      catch { this.push(new Text(entry.summary, 0, 0)); }
      return;
    }
    if (entry.type === "compaction" && typeof entry.summary === "string") {
      try { this.push(new CompactionSummaryMessageComponent({ role: "compactionSummary", summary: entry.summary } as never, this.markdownTheme, this.outputPad)); }
      catch { this.push(new Text(entry.summary, 0, 0)); }
      return;
    }
    if (entry.type !== "message") return;
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") return;
    if (message.role === "user") {
      const text = textOf(message.content);
      if (text) this.push(new UserMessageComponent(text, this.markdownTheme, this.outputPad));
      return;
    }
    if (message.role === "assistant") {
      const assistant = new AssistantMessageComponent(message as never, this.hideThinking, this.markdownTheme, undefined, this.outputPad);
      this.push(assistant);
      const content = Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>) : [];
      for (const part of content) {
        if (part?.type !== "toolCall" || typeof part.name !== "string") continue;
        const id = typeof part.id === "string" ? part.id : "";
        const tool = new ToolExecutionComponent(
          part.name,
          id,
          part.arguments,
          { showImages: false, outputPad: this.outputPad },
          this.renderers.get(part.name),
          this.ui,
          this.cwd,
        );
        tool.setExpanded(this.expanded);
        this.tools.set(id, this.push(tool));
      }
      // Pi shows an errored or aborted turn on its last tool card.
      if ((message.stopReason === "error" || message.stopReason === "aborted") && this.tools.size > 0) {
        const last = [...this.tools.values()].at(-1);
        const text = message.stopReason === "aborted" ? "Operation aborted" : String(message.errorMessage ?? "Error");
        (last?.component as ToolExecutionComponent | undefined)?.updateResult({ content: [{ type: "text", text }], isError: true });
        if (last) { last.error = true; this.cache = undefined; }
      }
      return;
    }
    if (message.role === "toolResult") {
      const id = typeof message.toolCallId === "string" ? message.toolCallId : "";
      const block = this.tools.get(id);
      const tool = block?.component as ToolExecutionComponent | undefined;
      if (!tool) return;
      const content = Array.isArray(message.content) ? (message.content as Array<{ type: string; text?: string }>) : [];
      tool.updateResult({ content, details: message.details, isError: message.isError === true });
      tool.markExecutionStarted();
      tool.setArgsComplete();
      if (message.isError === true && block) { block.error = true; this.cache = undefined; }
    }
  }

  /** Flat body lines at `width`, from the same components the live chat uses. */
  render(width: number): string[] {
    const usable = Math.max(1, width);
    if (this.cache?.width === usable) return this.cache.lines;
    const lines: string[] = [];
    const errors: number[] = [];
    for (const block of this.blocks) {
      const start = lines.length;
      let rendered: string[];
      try {
        rendered = block.component.render(usable);
      } catch (error) {
        rendered = [error instanceof Error ? `[render error: ${error.message}]` : "[render error]"];
      }
      for (const line of rendered) lines.push(stripZoneMarkers(line));
      if (block.error) errors.push(start);
    }
    this.cache = { width: usable, lines, errors };
    return lines;
  }

  /** Body line indices where a failed tool result starts, for `e`. */
  errorLines(): number[] {
    return [...(this.cache?.errors ?? [])];
  }

  get componentCount(): number {
    return this.blocks.length;
  }

  /** `t`: Pi's own hide-thinking switch. */
  setHideThinking(hide: boolean): void {
    this.hideThinking = hide;
    for (const block of this.blocks) {
      if (block.component instanceof AssistantMessageComponent) block.component.setHideThinkingBlock(hide);
    }
    this.cache = undefined;
  }

  /** `r`: Pi's ctrl+o tool expansion. */
  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    for (const block of this.blocks) {
      if (block.component instanceof ToolExecutionComponent) block.component.setExpanded(expanded);
    }
    this.cache = undefined;
  }

  invalidate(): void {
    this.cache = undefined;
    for (const block of this.blocks) {
      try { block.component.invalidate(); } catch { /* a component without state */ }
    }
  }
}

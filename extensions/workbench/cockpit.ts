/**
 * cockpit — a docked widget above the editor showing context, tokens, provider
 * usage, and recent Jev decisions. It reserves layout space instead of floating over
 * the transcript (DeepSeek Pro reviewed the docking change). The ledger is read over
 * HTTP via `shared/ledger.ts`, which lazily auto-starts the Bun server on first use.
 *
 * Presentation goes through `shared/panel.ts`. The widget has no `visible(width)`
 * gate, so it collapses to a single summary line below 60 columns (compact mode: a colored usage line plus up to 2 HUD cards), and its refresh
 * fetches the ledger and provider usage concurrently behind an in-flight guard so
 * bursts of `tool_result` cannot stall it.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { recentCalls } from "../shared/ledger.ts";
import { meter, renderPanel, type PanelTheme } from "../shared/panel.ts";
import type { ProviderUsage, UsageWindow } from "../shared/usage.ts";
import { fetchOpencodeGoUsage } from "../usage/opencode-go.ts";
import type { WorkbenchConfig } from "./config.ts";
import { hudFeed } from "./hud.ts";
import { age, STATUS_GLYPH, type HudCard, type HudSnapshot, type HudStatus } from "./hud-logic.ts";
import { formatTokens, tokenTotals } from "./stats.ts";

export interface CockpitInput {
  percent: number | null;
  tokens: number;
  /** Structured provider usage; rendered as per-window meters when present. */
  usage?: ProviderUsage;
  /** Fallback segment for providers that report no windows. */
  usageText?: string;
  decisions: string[];
  ledgerError?: string;
  /** Active model label for the title bar, e.g. `opencode-go/m`. */
  model?: string;
  /** HUD feed snapshot; the HUD block is omitted when undefined (feature off). */
  hud?: HudSnapshot;
}

export type CockpitRow =
  | { kind: "label"; text: string }
  | { kind: "meter"; percent: number | null; text: string }
  | { kind: "window"; window: UsageWindow }
  | { kind: "text"; text: string }
  | { kind: "error"; text: string }
  | { kind: "hud"; text: string; card: HudCard; ageText: string }
  | { kind: "hud-line"; text: string }
  | { kind: "hud-progress"; text: string; percent: number };

/** Card lines are cut to the narrow-column budget (34 chars). */
export const HUD_LINE_CHARS = 34;
export const HUD_TITLE_CHARS = 24;

const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

export interface CockpitSections {
  right?: string;
  rows: CockpitRow[];
  footer: string;
}

/** Compact reset label (`3h`, `2d`, `now`), or undefined when absent/invalid. */
export function formatReset(resetsAt: string | undefined, now: number = Date.now()): string | undefined {
  if (resetsAt === undefined) return undefined;
  const at = Date.parse(resetsAt);
  if (!Number.isFinite(at)) return undefined;
  const delta = at - now;
  if (delta <= 0) return "now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const HUD_COLOR: Record<HudStatus, "accent" | "success" | "warning" | "error" | "dim"> = {
  running: "accent",
  ok: "success",
  warn: "warning",
  error: "error",
  idle: "dim",
};

/** Pure, ANSI-free section model of the cockpit body. */
export function buildCockpitSections(input: CockpitInput): CockpitSections {
  const rows: CockpitRow[] = [
    { kind: "label", text: "CONTEXT" },
    { kind: "meter", percent: input.percent, text: `${formatTokens(input.tokens)} tok` },
    { kind: "label", text: "USAGE" },
  ];

  if (input.usage && input.usage.windows.length > 0) {
    for (const window of input.usage.windows) rows.push({ kind: "window", window });
    if (input.usage.tokensToday) {
      rows.push({
        kind: "text",
        text: `${input.usage.tokensToday.input} in / ${input.usage.tokensToday.output} out today`,
      });
    }
    if (typeof input.usage.usdMtd === "number") {
      rows.push({ kind: "text", text: `$${input.usage.usdMtd.toFixed(2)} MTD` });
    }
    if (input.usage.note) rows.push({ kind: "text", text: input.usage.note });
  } else if (input.usage?.error) {
    rows.push({ kind: "error", text: input.usage.error });
  } else {
    rows.push({ kind: "text", text: input.usageText ?? "(unavailable)" });
  }

  if (input.hud) {
    rows.push({ kind: "label", text: `HUD${input.hud.stale > 0 ? ` · ${input.hud.stale} stale` : ""}` });
    if (input.hud.cards.length === 0) rows.push({ kind: "text", text: "no feeds: hud set <source> --status running" });
    for (const card of input.hud.cards) {
      rows.push({ kind: "hud", text: card.title, card, ageText: age(input.hud.at - card.updatedAt) });
      if (card.progress !== null) rows.push({ kind: "hud-progress", text: `${Math.round(card.progress)}%`, percent: card.progress });
      for (const line of card.lines) rows.push({ kind: "hud-line", text: clip(line, HUD_LINE_CHARS) });
    }
  }

  rows.push({ kind: "label", text: "RECENT DECISIONS" });
  if (input.ledgerError) {
    rows.push({ kind: "error", text: `ledger: ${input.ledgerError}` });
  } else if (input.decisions.length === 0) {
    rows.push({ kind: "text", text: "(none)" });
  } else {
    for (const decision of input.decisions) rows.push({ kind: "text", text: `• ${decision}` });
  }

  return {
    right: input.model,
    rows,
    footer: input.hud ? "/cockpit to hide · /hud <source> for detail" : "/cockpit to hide · refreshes each turn",
  };
}

/** Compose the cockpit panel at `width`. */
export function renderCockpitPanel(
  theme: PanelTheme,
  width: number,
  input: CockpitInput,
  now: number = Date.now(),
  maxRows: number = Number.POSITIVE_INFINITY,
): string[] {
  const sections = buildCockpitSections(input);
  const rendered = sections.rows.map((row): string => {
    switch (row.kind) {
      case "label":
        return theme.fg("accent", row.text);
      case "meter":
        return `  ${meter(theme, row.percent, 18)}  ${theme.fg("dim", row.text)}`;
      case "window": {
        const reset = formatReset(row.window.resetsAt, now);
        const label = theme.fg("muted", row.window.label.padEnd(7));
        const suffix = reset ? theme.fg("dim", ` · resets ${reset}`) : "";
        return `  ${label} ${meter(theme, row.window.percent, 10)}${suffix}`;
      }
      case "text":
        return row.text.length === 0 ? "" : theme.fg("muted", `  ${row.text}`);
      case "error":
        return theme.fg("error", `  ${row.text}`);
      case "hud":
        return `${theme.fg(HUD_COLOR[row.card.status], STATUS_GLYPH[row.card.status])} ${clip(row.card.title, HUD_TITLE_CHARS)} ${theme.fg("dim", row.ageText)}`;
      case "hud-progress":
        return `  ${meter(theme, row.percent, 14)}`;
      case "hud-line":
        return row.text.startsWith("✗")
          ? theme.fg("error", `  ${row.text}`)
          : row.text.startsWith("!")
            ? theme.fg("warning", `  ${row.text}`)
            : theme.fg("muted", `  ${row.text}`);
    }
  });
  const body =
    rendered.length > maxRows
      ? [...rendered.slice(0, maxRows - 1), theme.fg("dim", `  +${rendered.length - (maxRows - 1)} more · /cockpit compact`)]
      : rendered;
  return renderPanel(theme, width, {
    title: "◈ cockpit",
    right: sections.right,
    body,
    footer: sections.footer,
  }).lines;
}

export type CockpitViewMode = "compact" | "full";

/** Narrow (<60 cols) single line: context, tokens, every usage window, HUD attention. */
export function renderCockpitStrip(theme: PanelTheme, width: number, input: CockpitInput): string[] {
  const percent = input.percent === null ? "?" : `${Math.round(input.percent)}%`;
  const windows = input.usage?.windows.map((window) => `${window.label} ${window.percent ?? "?"}%`) ?? [];
  const usage = windows.length > 0 ? ` · ${windows.join(" · ")}` : input.usage?.error ? " · usage error" : "";
  const attention = input.hud?.cards.filter((card) => card.status === "error" || card.status === "warn").length ?? 0;
  const hud = input.hud && input.hud.cards.length > 0 ? ` · hud ${input.hud.cards.length}${attention > 0 ? ` (${attention}!)` : ""}` : "";
  const last = input.decisions[0] && width >= 80 ? ` · ${input.decisions[0]}` : "";
  return [truncateToWidth(theme.fg("accent", "◈ ") + theme.fg("muted", `ctx ${percent} · ${formatTokens(input.tokens)} tok${usage}${hud}${last}`), Math.max(1, width))];
}

const pressureColor = (percent: number): "success" | "warning" | "error" => (percent < 50 ? "success" : percent < 80 ? "warning" : "error");

/** Threshold-colored percentage; `?` (dim) when unknown. */
function pct(theme: PanelTheme, percent: number | null | undefined): string {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return theme.fg("dim", "?");
  return theme.fg(pressureColor(percent), `${Math.round(percent)}%`);
}

const HUD_FIRST_LINE_CHARS = 48;
const COMPACT_MAX_CARDS = 2;
const CARD_PRIORITY: Record<HudStatus, number> = { error: 0, warn: 1, running: 2, idle: 3, ok: 4 };

/** Colored usage line: context % plus each provider window; `usage ?` when usage errored. */
export function renderCompactUsageLine(theme: PanelTheme, width: number, input: CockpitInput): string {
  const sep = theme.fg("dim", " · ");
  const segments = [`${theme.fg("muted", "ctx")} ${pct(theme, input.percent)}`];
  for (const window of input.usage?.windows ?? []) segments.push(`${theme.fg("muted", window.label)} ${pct(theme, window.percent)}`);
  if (input.usage && input.usage.windows.length === 0 && input.usage.error) segments.push(theme.fg("dim", "usage ?"));
  return truncateToWidth(theme.fg("accent", "◈ ") + segments.join(sep), Math.max(1, width));
}

/** Compact view: the colored usage line, then up to 2 newest HUD cards, one line each. */
export function renderCockpitCompact(theme: PanelTheme, width: number, input: CockpitInput, now: number = Date.now()): string[] {
  const lines = [renderCompactUsageLine(theme, width, input)];
  const cards = [...(input.hud?.cards ?? [])]
    .sort((a, b) => b.updatedAt - a.updatedAt || CARD_PRIORITY[a.status] - CARD_PRIORITY[b.status])
    .slice(0, COMPACT_MAX_CARDS);
  const at = input.hud?.at ?? now;
  for (const card of cards) {
    const first = card.lines[0]?.trim();
    const detail = first ? ` ${theme.fg("muted", clip(first, HUD_FIRST_LINE_CHARS))}` : "";
    lines.push(
      truncateToWidth(
        `${theme.fg(HUD_COLOR[card.status], STATUS_GLYPH[card.status])} ${clip(card.title, HUD_TITLE_CHARS)}${detail} ${theme.fg("dim", age(at - card.updatedAt))}`,
        Math.max(1, width),
      ),
    );
  }
  return lines;
}

/**
 * Docked widget lines. Widgets get no `visible(width)` gate, so a full panel would
 * consume rows on a narrow terminal: compact mode and widths below 60 columns collapse
 * to one line, and the full panel is capped at `maxRows` body rows.
 */
export function renderCockpitWidget(
  theme: PanelTheme,
  width: number,
  input: CockpitInput,
  now: number = Date.now(),
  view: { mode: CockpitViewMode; maxRows: number } = { mode: "full", maxRows: Number.POSITIVE_INFINITY },
): string[] {
  if (width < 60) return renderCockpitStrip(theme, width, input);
  if (view.mode === "compact") return renderCockpitCompact(theme, width, input, now);
  return renderCockpitPanel(theme, width, input, now, view.maxRows);
}

const WIDGET_KEY = "cockpit";

export function registerCockpit(pi: ExtensionAPI, getConfig: () => WorkbenchConfig): void {
  let visible = false;
  let mode: CockpitViewMode | undefined;
  const viewMode = (): CockpitViewMode => mode ?? getConfig().cockpit.mode;
  let requestRender: (() => void) | undefined;
  let context: ExtensionContext | undefined;
  let latest: CockpitInput = { percent: null, tokens: 0, decisions: [] };
  let refreshing = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const hudOn = (): boolean => getConfig().hud.enabled;

  /** Cheap: re-read the HUD drop dir only (no ledger / usage fetch) and repaint. */
  const pollHud = (): void => {
    if (!visible || !context || !hudOn()) return;
    const ctx = context;
    try {
      latest = { ...latest, hud: hudFeed.poll((message, level) => ctx.ui.notify(message, level)) };
      requestRender?.();
    } catch {
      // A bad feed must never break the cockpit.
    }
  };

  const fetchUsage = async (ctx: ExtensionContext): Promise<ProviderUsage | undefined> => {
    if (ctx.model?.provider !== "opencode-go") return undefined;
    try {
      const key = await ctx.modelRegistry.getApiKeyForProvider("opencode-go");
      // With no key, `fetchOpencodeGoUsage` reports the missing env var itself.
      return await fetchOpencodeGoUsage(key ? { apiKey: key } : {});
    } catch (error) {
      // Never reject: the failure must show as a usage row, not an unhandled rejection.
      return {
        provider: "opencode-go",
        windows: [],
        error: error instanceof Error ? error.message : "usage unavailable",
      };
    }
  };

  const refresh = async (): Promise<void> => {
    if (!context || refreshing) return;
    refreshing = true;
    const ctx = context;
    try {
      // Ledger and usage are independent; fetch them concurrently and keep the
      // previous snapshot rendered until both settle.
      const [ledger, usage] = await Promise.all([recentCalls(5), fetchUsage(ctx)]);
      const percent = ctx.getContextUsage()?.percent ?? null;
      const tokens = tokenTotals(ctx.sessionManager.getEntries());
      const hud = hudOn() ? hudFeed.poll((message, level) => ctx.ui.notify(message, level)) : undefined;
      const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
      latest = {
        percent,
        tokens,
        usage,
        model,
        decisions: ledger.rows.map((row) => `${String(row.decision ?? "?")} · ${String(row.tool ?? "")}`.trim()),
        ledgerError: ledger.error,
        hud,
      };
      requestRender?.();
    } finally {
      refreshing = false;
    }
  };

  const show = (ctx: ExtensionContext): void => {
    if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
    context = ctx;
    if (!visible) {
      visible = true;
      ctx.ui.setWidget(
        WIDGET_KEY,
        (tui, theme) => {
          requestRender = () => tui.requestRender();
          return {
            render: (width: number): string[] => renderCockpitWidget(theme, width, latest, Date.now(), { mode: viewMode(), maxRows: getConfig().cockpit.maxRows }),
            invalidate: () => {},
          };
        },
        { placement: "aboveEditor" },
      );
    }
    void refresh();
    // Light timer, alive only while the cockpit is shown.
    if (timer === undefined && hudOn()) {
      timer = setInterval(pollHud, getConfig().hud.pollSec * 1000);
      timer.unref?.();
    }
  };

  const hide = (ctx: ExtensionContext): void => {
    if (!visible) return;
    visible = false;
    requestRender = undefined;
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    ctx.ui.setWidget(WIDGET_KEY, undefined);
  };

  pi.registerCommand("cockpit", {
    description: "Toggle the docked workbench cockpit; `/cockpit full` or `/cockpit compact` switches the view",
    handler: async (args, ctx) => {
      if (!getConfig().cockpit.enabled) {
        ctx.ui.notify("cockpit disabled in workbench.config.json", "warning");
        return;
      }
      const wanted = args.trim().toLowerCase();
      if (wanted === "full" || wanted === "compact") {
        mode = wanted;
        if (visible) requestRender?.();
        else show(ctx);
        return;
      }
      if (visible) hide(ctx);
      else show(ctx);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (getConfig().cockpit.enabled && ctx.hasUI) show(ctx);
  });

  const onEvent = async (ctx: ExtensionContext): Promise<void> => {
    context = ctx;
    if (visible) await refresh();
  };

  pi.on("turn_end", async (_event, ctx) => onEvent(ctx));
  pi.on("tool_result", async (_event, ctx) => onEvent(ctx));
  pi.on("session_shutdown", async (_event, ctx) => {
    hide(ctx);
  });
}

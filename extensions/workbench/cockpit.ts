/**
 * cockpit — a top-right, non-capturing overlay showing context, tokens, provider
 * usage, and recent Jev decisions. The ledger is read over HTTP via
 * `shared/ledger.ts`; the extension never spawns the server.
 *
 * Presentation goes through `shared/panel.ts`. The panel docks in the top-right
 * corner with a narrow footprint so it does not cover mid-screen transcript
 * lines, and its refresh fetches the ledger and provider usage concurrently
 * behind an in-flight guard so bursts of `tool_result` cannot stall it.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { recentCalls } from "../shared/ledger.ts";
import { meter, renderPanel, type PanelTheme } from "../shared/panel.ts";
import type { ProviderUsage, UsageWindow } from "../shared/usage.ts";
import { fetchOpencodeGoUsage } from "../usage/opencode-go.ts";
import type { WorkbenchConfig } from "./config.ts";
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
}

export type CockpitRow =
  | { kind: "label"; text: string }
  | { kind: "meter"; percent: number | null; text: string }
  | { kind: "window"; window: UsageWindow }
  | { kind: "text"; text: string }
  | { kind: "error"; text: string };

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
    footer: "/cockpit to hide · refreshes each turn",
  };
}

/** Compose the cockpit panel at `width`. */
export function renderCockpitPanel(
  theme: PanelTheme,
  width: number,
  input: CockpitInput,
  now: number = Date.now(),
): string[] {
  const sections = buildCockpitSections(input);
  const body = sections.rows.map((row): string => {
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
    }
  });
  return renderPanel(theme, width, {
    title: "◈ cockpit",
    right: sections.right,
    body,
    footer: sections.footer,
  }).lines;
}

export function registerCockpit(pi: ExtensionAPI, getConfig: () => WorkbenchConfig): void {
  let handle: { hide(): void } | undefined;
  let tui: { requestRender(force?: boolean): void } | undefined;
  let context: ExtensionContext | undefined;
  let latest: CockpitInput = { percent: null, tokens: 0, decisions: [] };
  let refreshing = false;

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
      const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
      latest = {
        percent,
        tokens,
        usage,
        model,
        decisions: ledger.rows.map((row) => `${String(row.decision ?? "?")} · ${String(row.tool ?? "")}`.trim()),
        ledgerError: ledger.error,
      };
      tui?.requestRender();
    } finally {
      refreshing = false;
    }
  };

  const open = (ctx: ExtensionContext): void => {
    if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
    context = ctx;
    void ctx.ui
      .custom(
        (t, theme) => {
          tui = t;
          return {
            render: (width: number): string[] => renderCockpitPanel(theme, width, latest),
            invalidate: () => {},
          };
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: "top-right",
            width: "32%",
            maxHeight: "55%",
            margin: { top: 1, right: 1 },
            nonCapturing: true,
            visible: (width) => width >= 120,
          },
          onHandle: (h) => {
            handle = h;
          },
        },
      )
      .finally(() => {
        handle = undefined;
        tui = undefined;
      });
    void refresh();
  };

  pi.registerCommand("cockpit", {
    description: "Toggle the workbench cockpit overlay",
    handler: async (_args, ctx) => {
      if (!getConfig().cockpit.enabled) {
        ctx.ui.notify("cockpit disabled in workbench.config.json", "warning");
        return;
      }
      if (handle) {
        handle.hide();
        return;
      }
      open(ctx);
    },
  });

  const onEvent = async (ctx: ExtensionContext): Promise<void> => {
    context = ctx;
    if (handle) await refresh();
  };

  pi.on("turn_end", async (_event, ctx) => onEvent(ctx));
  pi.on("tool_result", async (_event, ctx) => onEvent(ctx));
  pi.on("session_shutdown", async () => {
    handle?.hide();
  });
}

/**
 * cockpit — a right-anchored, non-capturing overlay showing context, tokens,
 * provider usage, and recent Jev decisions. The ledger is read over HTTP via
 * `shared/ledger.ts`; the extension never spawns the server.
 *
 * Presentation goes through `shared/panel.ts`, so the cockpit reads as a panel
 * instead of blending into the transcript.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { recentCalls } from "../shared/ledger.ts";
import { meter, renderPanel, type PanelTheme } from "../shared/panel.ts";
import { formatUsage } from "../shared/usage.ts";
import { fetchOpencodeGoUsage } from "../usage/opencode-go.ts";
import type { WorkbenchConfig } from "./config.ts";
import { formatTokens, tokenTotals } from "./stats.ts";

export interface CockpitInput {
  percent: number | null;
  tokens: number;
  usageText?: string;
  decisions: string[];
  ledgerError?: string;
  /** Active model label for the title bar, e.g. `opencode-go/m`. */
  model?: string;
}

export type CockpitRow =
  | { kind: "label"; text: string }
  | { kind: "meter"; percent: number | null; text: string }
  | { kind: "text"; text: string }
  | { kind: "error"; text: string };

export interface CockpitSections {
  right?: string;
  rows: CockpitRow[];
  footer: string;
}

/** Pure, ANSI-free section model of the cockpit body. */
export function buildCockpitSections(input: CockpitInput): CockpitSections {
  const rows: CockpitRow[] = [
    { kind: "label", text: "CONTEXT" },
    { kind: "meter", percent: input.percent, text: `${formatTokens(input.tokens)} tok` },
    { kind: "text", text: "" },
    { kind: "label", text: "USAGE" },
    { kind: "text", text: input.usageText ?? "(unavailable)" },
    { kind: "text", text: "" },
    { kind: "label", text: "RECENT DECISIONS" },
  ];
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
export function renderCockpitPanel(theme: PanelTheme, width: number, input: CockpitInput): string[] {
  const sections = buildCockpitSections(input);
  const body = sections.rows.map((row): string => {
    switch (row.kind) {
      case "label":
        return theme.fg("accent", row.text);
      case "meter":
        return `  ${meter(theme, row.percent, 18)}  ${theme.fg("dim", row.text)}`;
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

  const refresh = async (): Promise<void> => {
    if (!context) return;
    const percent = context.getContextUsage()?.percent ?? null;
    const tokens = tokenTotals(context.sessionManager.getEntries());
    const model = context.model ? `${context.model.provider}/${context.model.id}` : undefined;

    let usageText: string | undefined;
    if (context.model?.provider === "opencode-go") {
      const key =
        (await context.modelRegistry.getApiKeyForProvider("opencode-go")) ??
        process.env.OPENCODE_API_KEY;
      if (key) usageText = formatUsage(await fetchOpencodeGoUsage({ apiKey: key }));
    }

    const ledger = await recentCalls(5);
    latest = {
      percent,
      tokens,
      usageText,
      model,
      decisions: ledger.rows.map((row) => `${String(row.decision ?? "?")} · ${String(row.tool ?? "")}`.trim()),
      ledgerError: ledger.error,
    };
    tui?.requestRender();
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
            anchor: "right-center",
            width: "38%",
            maxHeight: "80%",
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

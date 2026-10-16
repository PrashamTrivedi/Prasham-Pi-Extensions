/**
 * cockpit — a right-anchored, non-capturing overlay showing context, tokens,
 * provider usage, and recent Jev decisions. The ledger is read over HTTP via
 * `shared/ledger.ts`; the extension never spawns the server.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { recentCalls } from "../shared/ledger.ts";
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
}

/** Pure composition of the cockpit body. */
export function buildCockpitLines(input: CockpitInput): string[] {
  const lines: string[] = [];
  lines.push(`context  ${input.percent === null ? "?" : `${Math.round(input.percent)}%`}`);
  lines.push(`tokens   ${formatTokens(input.tokens)}`);
  lines.push(`usage    ${input.usageText ?? "(unavailable)"}`);
  lines.push("");
  lines.push("recent Jev decisions");
  if (input.ledgerError) {
    lines.push(`  ledger: ${input.ledgerError}`);
  } else if (input.decisions.length === 0) {
    lines.push("  (none)");
  } else {
    for (const decision of input.decisions) lines.push(`  ${decision}`);
  }
  return lines;
}

export function registerCockpit(pi: ExtensionAPI, getConfig: () => WorkbenchConfig): void {
  let handle: { hide(): void } | undefined;
  let tui: { requestRender(force?: boolean): void } | undefined;
  let context: ExtensionContext | undefined;
  let latest: string[] = ["cockpit loading…"];

  const refresh = async (): Promise<void> => {
    if (!context) return;
    const percent = context.getContextUsage()?.percent ?? null;
    const tokens = tokenTotals(context.sessionManager.getEntries());

    let usageText: string | undefined;
    if (context.model?.provider === "opencode-go") {
      const key =
        (await context.modelRegistry.getApiKeyForProvider("opencode-go")) ??
        process.env.OPENCODE_API_KEY;
      if (key) usageText = formatUsage(await fetchOpencodeGoUsage({ apiKey: key }));
    }

    const ledger = await recentCalls(5);
    latest = buildCockpitLines({
      percent,
      tokens,
      usageText,
      decisions: ledger.rows.map((row) => `${String(row.decision ?? "?")} · ${String(row.tool ?? "")}`.trim()),
      ledgerError: ledger.error,
    });
    tui?.requestRender();
  };

  const open = (ctx: ExtensionContext): void => {
    if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
    context = ctx;
    void ctx.ui
      .custom(
        (t, _theme) => {
          tui = t;
          return {
            render: (width: number): string[] => latest.map((line) => truncateToWidth(line, width)),
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

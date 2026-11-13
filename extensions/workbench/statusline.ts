/**
 * statusline — a footer that always shows the working directory, then
 * branch · context · duration · tokens, the provider usage status (set by the
 * `usage` extension) and the pet sign-off. Restores the built-in footer on
 * shutdown.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import type { WorkbenchConfig } from "./config.ts";
import { petSignOff } from "./pet.ts";
import { cwdLabel, duration, statusLine, tokenTotals, truncateLeft } from "./stats.ts";

export function registerStatusline(pi: ExtensionAPI, getConfig: () => WorkbenchConfig): void {
  const hasUI = (ctx: ExtensionContext): boolean => ctx.mode === "tui" || ctx.mode === "rpc";

  pi.on("session_start", async (_event, ctx) => {
    if (!getConfig().statusline.enabled || !hasUI(ctx)) return;
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      return {
        render: (width: number): string[] => {
          const usage = ctx.getContextUsage();
          const entries = ctx.sessionManager.getEntries();
          const line1 = statusLine({
            branch: footerData.getGitBranch() ?? "no-branch",
            percent: usage?.percent ?? null,
            durationMs: duration(entries),
            tokens: tokenTotals(entries),
          });
          const usageStatus = footerData.getExtensionStatuses().get("usage");
          // The cwd keeps its tail: a deep path must never hide the project name.
          const where = truncateLeft(cwdLabel(ctx.cwd, homedir()), width);
          const lines = [theme.fg("dim", truncateToWidth(where, width)), theme.fg("dim", truncateToWidth(line1, width))];
          if (usageStatus) lines.push(truncateToWidth(usageStatus, width));
          const signOff = petSignOff();
          if (signOff && getConfig().pet.enabled) lines.push(theme.fg("dim", truncateToWidth(signOff, width)));
          return lines;
        },
        invalidate: () => {},
        dispose: () => unsubscribe(),
      };
    });
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (hasUI(ctx)) ctx.ui.setFooter(undefined);
  });
}

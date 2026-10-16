/**
 * pet — animated working indicator plus a per-turn themed verb and a mood badge.
 * Restores the built-in indicator/message on shutdown.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WorkbenchConfig } from "./config.ts";
import { isPetTheme, PET_THEMES, pickVerb, type PetTheme } from "./verbs.ts";

export type Mood = "calm" | "focused" | "busy" | "strained";

const FRAMES = ["◐", "◓", "◑", "◒"];

/** Mood from context pressure and recent tool errors; pure. */
export function moodFrom(percent: number | null, recentErrors: number): Mood {
  if (recentErrors > 0) return "strained";
  if (percent === null) return "calm";
  if (percent >= 80) return "strained";
  if (percent >= 50) return "busy";
  return "focused";
}

export function registerPet(pi: ExtensionAPI, getConfig: () => WorkbenchConfig): void {
  let turn = 0;
  let theme: PetTheme = "auto";
  let recentErrors = 0;

  const hasUI = (ctx: ExtensionContext): boolean => ctx.mode === "tui" || ctx.mode === "rpc";

  const apply = (ctx: ExtensionContext): void => {
    if (!getConfig().pet.enabled || !hasUI(ctx)) return;
    ctx.ui.setWorkingIndicator({ frames: FRAMES, intervalMs: 120 });
    ctx.ui.setWorkingMessage(pickVerb(theme, turn));
  };

  const badge = (ctx: ExtensionContext): void => {
    const config = getConfig();
    if (!config.pet.enabled || !config.pet.badges || !hasUI(ctx)) return;
    const percent = ctx.getContextUsage()?.percent ?? null;
    ctx.ui.setStatus("pet", `${moodFrom(percent, recentErrors)} · ${theme}`);
  };

  pi.on("session_start", async (_event, ctx) => {
    const configured = getConfig().pet.theme;
    if (isPetTheme(configured)) theme = configured;
    apply(ctx);
    badge(ctx);
  });

  pi.on("turn_start", async (_event, ctx) => {
    apply(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    turn += 1;
    apply(ctx);
    badge(ctx);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (event.isError) recentErrors += 1;
    badge(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!hasUI(ctx)) return;
    ctx.ui.setWorkingIndicator();
    ctx.ui.setWorkingMessage();
    ctx.ui.setStatus("pet", undefined);
  });

  pi.registerCommand("pet", {
    description: "Show or configure the working pet (theme, badges)",
    handler: async (args, ctx) => {
      const [sub, value] = args.trim().split(/\s+/);
      if (sub === "theme" && value !== undefined) {
        if (!isPetTheme(value)) {
          ctx.ui.notify(`pet: unknown theme "${value}" (${PET_THEMES.join(", ")})`, "error");
          return;
        }
        theme = value;
        ctx.ui.notify(`pet theme: ${theme}`, "info");
        return;
      }
      if (sub === "badges") {
        ctx.ui.notify(`pet badges: ${getConfig().pet.badges ? "on" : "off"} (edit workbench.config.json)`, "info");
        return;
      }
      const percent = ctx.getContextUsage()?.percent ?? null;
      ctx.ui.notify(`pet · theme ${theme} · mood ${moodFrom(percent, recentErrors)} · turn ${turn}`, "info");
    },
  });
}

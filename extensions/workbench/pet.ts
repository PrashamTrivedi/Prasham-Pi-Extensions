/**
 * pet — animated working indicator, a per-prompt themed verb, a mood badge, pixel-art badges while a
 * run is going, short pet lines, and a footer sign-off using the verb sampled for that run.
 * Restores the built-in indicator/message on shutdown.
 *
 * Pure parts live in `verbs.ts`, `pet-logic.ts`, `pet-lines.ts` and `pet-art.ts`.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WorkbenchConfig } from "./config.ts";
import { ansiRow, iconRows, stoneAt, THEME_LABEL } from "./pet-art.ts";
import { petLine } from "./pet-lines.ts";
import { countErrors, isChatty, isRealFailure, isThirdTurn, lineKindFor, pushResult, signOffLine } from "./pet-logic.ts";
import { isPetTheme, pickVerb, PET_THEMES, signOffFor, themeOf, type PetTheme } from "./verbs.ts";

export type Mood = "calm" | "focused" | "busy" | "strained";

const FRAMES = ["◐", "◓", "◑", "◒"];
const ART_WIDGET = "pet-art";

/** Mood from context pressure and recent tool errors; pure. */
export function moodFrom(percent: number | null, recentErrors: number): Mood {
  if (recentErrors > 0) return "strained";
  if (percent === null) return "calm";
  if (percent >= 80) return "strained";
  if (percent >= 50) return "busy";
  return "focused";
}

let signOffText: string | undefined;

/** The last run's footer sign-off, for the custom statusline footer. */
export function petSignOff(): string | undefined {
  return signOffText;
}

/** Text content of a Pi tool result (`{ content: [{ type: "text", text }] }`). */
function resultText(result: unknown): string {
  const content = (result as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text: string } => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export function registerPet(pi: ExtensionAPI, getConfig: () => WorkbenchConfig): void {
  let prompts = 0;
  let theme: PetTheme = "auto";
  let ring: boolean[] = [];
  let verb = "";
  let runStart = 0;
  let stone = 0;
  let lastSpoken = "";
  let lastSignOff = "";

  const hasUI = (ctx: ExtensionContext): boolean => ctx.mode === "tui" || ctx.mode === "rpc";
  const enabled = (ctx: ExtensionContext): boolean => getConfig().pet.enabled && hasUI(ctx);

  const apply = (ctx: ExtensionContext): void => {
    if (!enabled(ctx)) return;
    if (verb === "") verb = pickVerb(theme, prompts);
    ctx.ui.setWorkingIndicator({ frames: FRAMES, intervalMs: 120 });
    ctx.ui.setWorkingMessage(verb);
  };

  const badge = (ctx: ExtensionContext): void => {
    const config = getConfig();
    if (!enabled(ctx) || !config.pet.badges) return;
    const percent = ctx.getContextUsage()?.percent ?? null;
    ctx.ui.setStatus("pet", `${moodFrom(percent, countErrors(ring))} · ${theme}`);
  };

  const showArt = (ctx: ExtensionContext): void => {
    if (!enabled(ctx) || !getConfig().pet.art) return;
    const artTheme = themeOf(verb);
    const rows = iconRows(artTheme, stone);
    if (artTheme === null || rows.length < 2) return;
    const caption = artTheme === "marvel" ? `${stoneAt(stone).name} Stone` : THEME_LABEL[artTheme];
    ctx.ui.setWidget(
      ART_WIDGET,
      [`${ansiRow(rows[0] ?? [])}  ${verb}`, `${ansiRow(rows[1] ?? [])}  ${caption}`],
      { placement: "belowEditor" },
    );
  };

  const hideArt = (ctx: ExtensionContext): void => {
    if (hasUI(ctx)) ctx.ui.setWidget(ART_WIDGET, undefined);
  };

  pi.on("session_start", async (_event, ctx) => {
    const configured = getConfig().pet.theme;
    if (isPetTheme(configured)) theme = configured;
    apply(ctx);
    badge(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (!enabled(ctx)) return;
    // The verb is sampled once per run, so spinner, badge art and the sign-off all agree.
    verb = pickVerb(theme, prompts);
    prompts += 1;
    runStart = Date.now();
    if (themeOf(verb) === "marvel") stone += 1;
    signOffText = undefined;
    ctx.ui.setStatus("pet-signoff", undefined);
    apply(ctx);
    showArt(ctx);
  });

  pi.on("turn_start", async (_event, ctx) => {
    apply(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    badge(ctx);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    ring = pushResult(ring, isRealFailure({ isError: event.isError, text: resultText(event.result) }));
    badge(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!enabled(ctx)) return;
    hideArt(ctx);
    const config = getConfig().pet;
    if (config.signOff && runStart > 0) {
      lastSignOff = signOffFor(verb, lastSignOff);
      signOffText = `Pip: ${signOffLine(lastSignOff, Date.now() - runStart)}`;
      ctx.ui.setStatus("pet-signoff", signOffText);
    }
    if (config.lines) {
      const kind = lineKindFor(ctx.getContextUsage()?.percent ?? null, countErrors(ring));
      if (isChatty(kind) && isThirdTurn(prompts)) {
        lastSpoken = petLine(kind, lastSpoken);
        ctx.ui.notify(lastSpoken, "info");
      }
    }
    runStart = 0;
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!hasUI(ctx)) return;
    ctx.ui.setWorkingIndicator();
    ctx.ui.setWorkingMessage();
    ctx.ui.setStatus("pet", undefined);
    ctx.ui.setStatus("pet-signoff", undefined);
    hideArt(ctx);
    signOffText = undefined;
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
      const errors = countErrors(ring);
      ctx.ui.notify(
        `pet · theme ${theme} · mood ${moodFrom(percent, errors)} · run ${prompts} · errors ${errors}/${ring.length}` +
          (signOffText ? ` · ${signOffText}` : ""),
        "info",
      );
    },
  });
}

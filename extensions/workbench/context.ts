/**
 * `/context` — a context-budget breakdown. Reports the live value from
 * `getContextUsage()` plus the known injector ceilings; never invents a number.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WorkbenchConfig } from "./config.ts";

export interface ContextCeiling {
  label: string;
  chars: number;
}

export function recursiveCeiling(): number {
  const raw = Number(process.env.PI_RECURSIVE_CONTEXT_MAX);
  return Number.isFinite(raw) && raw > 0 ? raw : 200_000;
}

export function knownCeilings(): ContextCeiling[] {
  return [
    { label: "project-context tree", chars: 8_000 },
    { label: "recursive-context (PI_RECURSIVE_CONTEXT_MAX)", chars: recursiveCeiling() },
  ];
}

export interface ContextBreakdownInput {
  percent: number | null;
  tokens: number | null;
  contextWindow: number;
  ceilings: ContextCeiling[];
}

export function buildContextBreakdown(input: ContextBreakdownInput): string[] {
  const percent = input.percent === null ? "?" : `${Math.round(input.percent)}%`;
  const tokens = input.tokens === null ? "?" : String(input.tokens);
  const lines = [`context ${percent} (${tokens} / ${input.contextWindow} tokens)`];
  for (const ceiling of input.ceilings) {
    lines.push(`  ≤ ${ceiling.chars.toLocaleString("en-US")} chars · ${ceiling.label}`);
  }
  return lines;
}

export function registerContext(pi: ExtensionAPI, getConfig: () => WorkbenchConfig): void {
  pi.registerCommand("context", {
    description: "Show the context-budget breakdown",
    handler: async (_args, ctx) => {
      if (!getConfig().observability.enabled) {
        ctx.ui.notify("observability disabled in workbench.config.json", "warning");
        return;
      }
      const usage = ctx.getContextUsage();
      ctx.ui.notify(
        buildContextBreakdown({
          percent: usage?.percent ?? null,
          tokens: usage?.tokens ?? null,
          contextWindow: usage?.contextWindow ?? 0,
          ceilings: knownCeilings(),
        }).join("\n"),
        "info",
      );
    },
  });
}

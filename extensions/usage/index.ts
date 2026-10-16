/**
 * `usage` extension — per-provider quota display for opencode-go.
 *
 * Shows rolling / weekly / monthly limits in one status segment and refreshes
 * them on a timer or via `/usage`. Cloudflare keeps its own
 * `cloudflare-ai-usage` extension; there is deliberately no cross-provider merge.
 *
 * The key is resolved from Pi's own provider auth
 * (`ctx.modelRegistry.getApiKeyForProvider`) first, then the configured env var.
 * Failures are shown to the user — nothing is silently swallowed.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { formatUsage, type ProviderUsage } from "../shared/usage.ts";
import { fetchOpencodeGoUsage } from "./opencode-go.ts";
import { DEFAULT_USAGE_CONFIG, loadUsageConfig, type UsageConfig } from "./config.ts";

const PROVIDER = "opencode-go";
const STATUS_KEY = "usage";

/** Only the opencode-go provider is reported by this extension. */
export function shouldReport(provider?: string): boolean {
  return provider === PROVIDER;
}

/** Visible message when neither Pi auth nor the configured env var has a key. */
export function missingAuthMessage(provider: string, keyEnv: string): string {
  return `${provider} has no configured auth (set ${keyEnv} or sign in to Pi)`;
}

function agentDir(): string {
  const fromEnv = process.env.PI_CODING_AGENT_DIR;
  return fromEnv && fromEnv.length > 0 ? fromEnv : join(homedir(), ".pi", "agent");
}

async function resolveKey(context: ExtensionContext, config: UsageConfig): Promise<string | undefined> {
  const fromPi = await context.modelRegistry.getApiKeyForProvider(PROVIDER);
  return fromPi ?? process.env[config.opencodeGo.keyEnv];
}

export default function usage(pi: ExtensionAPI) {
  let config: UsageConfig = DEFAULT_USAGE_CONFIG;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastError: string | undefined;

  const hasUI = (ctx: ExtensionContext): boolean => ctx.mode === "tui" || ctx.mode === "rpc";
  const setStatus = (ctx: ExtensionContext, text: string | undefined): void => {
    if (hasUI(ctx)) ctx.ui.setStatus(STATUS_KEY, text);
  };
  // Notify once per distinct error; a timer must not re-toast the same failure.
  const notifyError = (ctx: ExtensionContext, message: string): void => {
    if (message === lastError) return;
    lastError = message;
    if (hasUI(ctx)) ctx.ui.notify(message, "error");
  };

  const render = async (ctx: ExtensionContext): Promise<ProviderUsage | undefined> => {
    if (!shouldReport(ctx.model?.provider)) {
      setStatus(ctx, undefined);
      return undefined;
    }

    const key = await resolveKey(ctx, config);
    if (!key) {
      const message = missingAuthMessage(PROVIDER, config.opencodeGo.keyEnv);
      setStatus(ctx, `${STATUS_KEY}: ${message}`);
      notifyError(ctx, `usage: ${message}`);
      return undefined;
    }

    const result = await fetchOpencodeGoUsage({ apiKey: key, baseUrl: config.opencodeGo.baseUrl });
    setStatus(ctx, formatUsage(result));
    if (result.error) {
      notifyError(ctx, `usage: ${result.error}`);
    } else {
      lastError = undefined;
    }
    return result;
  };

  const stopTimer = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const startTimer = (ctx: ExtensionContext): void => {
    stopTimer();
    if (!shouldReport(ctx.model?.provider)) return;
    const minutes = Math.max(1, config.refreshMinutes);
    timer = setInterval(() => void render(ctx), minutes * 60_000);
  };

  pi.on("session_start", async (_event, ctx) => {
    const loaded = loadUsageConfig({ cwd: ctx.cwd, agentDir: agentDir() });
    config = loaded.config;
    if (loaded.errors.length > 0) notifyError(ctx, `usage config: ${loaded.errors.join("; ")}`);
    await render(ctx);
    startTimer(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    await render(ctx);
    startTimer(ctx);
  });

  pi.on("session_shutdown", () => {
    stopTimer();
  });

  pi.registerCommand("usage", {
    description: "Refresh opencode-go usage shown in the status line",
    handler: async (_args, ctx) => {
      await render(ctx);
    },
  });
}

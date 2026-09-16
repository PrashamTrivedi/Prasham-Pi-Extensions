import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";

type Rates = { input: number; output: number; cacheRead: number; cacheWrite: number };
type Config = {
  dailyNeuronAllowance: number;
  usdPerThousandNeurons: number;
  billing: { accountIdEnv: string; tokenEnv: string; refreshMinutes: number };
  modelRatesPerMillionTokensUsd: Record<string, Rates>;
};
type Event = { day: string; responseId?: string; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; neurons: number };
type Billing = { finalizedDay?: string; finalizedNeurons?: number; mtdUsd?: number; error?: string };

// User configuration stays outside the Git-installed checkout across updates.
const configPath = process.env.PI_CF_AI_USAGE_CONFIG
  ? resolve(process.env.PI_CF_AI_USAGE_CONFIG)
  : join(homedir(), ".pi", "agent", "cloudflare-ai-usage.config.json");
const statePath = join(homedir(), ".pi", "agent", "state", "cloudflare-ai-usage.jsonl");

function utcDay(time = Date.now()): string {
  return new Date(time).toISOString().slice(0, 10);
}

function amount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatNeurons(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

async function loadConfig(): Promise<Config> {
  if (!existsSync(configPath)) return { dailyNeuronAllowance: 0, usdPerThousandNeurons: 1,
    billing: { accountIdEnv: "CLOUDFLARE_ACCOUNT_ID", tokenEnv: "CLOUDFLARE_BILLING_TOKEN", refreshMinutes: 30 }, modelRatesPerMillionTokensUsd: {} };
  const config = JSON.parse(await readFile(configPath, "utf8")) as Config;
  if (!Number.isFinite(config.usdPerThousandNeurons) || config.usdPerThousandNeurons <= 0 ||
      !Number.isFinite(config.dailyNeuronAllowance) || config.dailyNeuronAllowance < 0 ||
      !config.billing || !Number.isFinite(config.billing.refreshMinutes) || config.billing.refreshMinutes < 1 ||
      typeof config.billing.accountIdEnv !== "string" || typeof config.billing.tokenEnv !== "string" ||
      !config.modelRatesPerMillionTokensUsd || typeof config.modelRatesPerMillionTokensUsd !== "object") {
    throw new Error(`Invalid Cloudflare usage configuration: ${configPath}`);
  }
  for (const rates of Object.values(config.modelRatesPerMillionTokensUsd)) {
    if (!rates || [rates.input, rates.output, rates.cacheRead, rates.cacheWrite].some(rate => !Number.isFinite(rate) || rate < 0))
      throw new Error(`Invalid model rates in ${configPath}`);
  }
  return config;
}

async function todayEvents(): Promise<Event[]> {
  try {
    const today = utcDay();
    const lines = (await readFile(statePath, "utf8")).trim().split("\n").filter(Boolean);
    return lines.flatMap((line) => {
      try {
        const event = JSON.parse(line) as Event;
        return event.day === today ? [event] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

async function record(event: Event): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await appendFile(statePath, `${JSON.stringify(event)}\n`, "utf8");
}

function usageFor(event: Event[]): Pick<Event, "input" | "output" | "cacheRead" | "cacheWrite" | "neurons"> {
  return event.reduce(
    (total, current) => ({
      input: total.input + current.input,
      output: total.output + current.output,
      cacheRead: total.cacheRead + current.cacheRead,
      cacheWrite: total.cacheWrite + current.cacheWrite,
      neurons: total.neurons + current.neurons,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, neurons: 0 },
  );
}

async function fetchBilling(config: Config): Promise<Billing> {
  const accountId = process.env[config.billing.accountIdEnv];
  const token = process.env[config.billing.tokenEnv];
  if (!accountId || !token) return { error: `set ${config.billing.tokenEnv} (Billing Read)` };

  const monthStart = `${utcDay().slice(0, 8)}01`;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/billable-usage?from=${monthStart}&to=${utcDay()}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) return { error: `Billing API HTTP ${response.status}` };

  const payload = (await response.json()) as { result?: Array<Record<string, unknown>>; success?: boolean };
  if (!payload.success || !Array.isArray(payload.result)) return { error: "Billing API returned no usage rows" };

  const rows = payload.result.filter((row) => /workers ai/i.test(String(row.ServiceFamilyName ?? row.ServiceName ?? "")));
  const latestDay = rows
    .map((row) => String(row.ChargePeriodEnd ?? row.ChargePeriodStart ?? "").slice(0, 10))
    .filter(Boolean)
    .sort()
    .at(-1);
  const latestRows = latestDay
    ? rows.filter((row) => String(row.ChargePeriodEnd ?? row.ChargePeriodStart ?? "").slice(0, 10) === latestDay)
    : [];

  return {
    finalizedDay: latestDay,
    finalizedNeurons: latestRows.reduce((sum, row) => sum + amount(row.ConsumedQuantity), 0),
    mtdUsd: rows.reduce((sum, row) => sum + amount(row.ContractedCost), 0),
  };
}

export default function (pi: ExtensionAPI) {
  let config: Config;
  let billing: Billing = {};
  let timer: ReturnType<typeof setInterval> | undefined;
  let seenResponseIds = new Set<string>();

  const render = async (ctx: ExtensionContext) => {
    if (ctx.model?.provider !== "cloudflare-workers-ai") {
      ctx.ui.setStatus("cloudflare-ai-usage", undefined);
      return;
    }
    if (!Object.keys(config.modelRatesPerMillionTokensUsd).length) {
      ctx.ui.setStatus("cloudflare-ai-usage", "CF AI usage: configure model rates to enable estimates"); return;
    }
    const today = usageFor(await todayEvents());
    const theme = ctx.ui.theme;
    const estimated = `CF AI today ~${formatNeurons(today.neurons)}/${formatNeurons(config.dailyNeuronAllowance)} N · ${formatNeurons(today.input)} in / ${formatNeurons(today.output)} out`;
    const billingText = billing.error
      ? ` · MTD unavailable (${billing.error})`
      : billing.finalizedDay
        ? ` · ${billing.finalizedDay} final ${formatNeurons(billing.finalizedNeurons ?? 0)} N · $${(billing.mtdUsd ?? 0).toFixed(4)} MTD`
        : " · Billing data pending";
    ctx.ui.setStatus("cloudflare-ai-usage", theme.fg("dim", estimated + billingText));
  };

  const refreshBilling = async (ctx: ExtensionContext) => {
    try {
      billing = await fetchBilling(config);
    } catch (error) {
      billing = { error: error instanceof Error ? error.message : "Billing API request failed" };
    }
    await render(ctx);
  };

  const startBillingRefresh = async (ctx: ExtensionContext) => {
    if (ctx.model?.provider !== "cloudflare-workers-ai") {
      ctx.ui.setStatus("cloudflare-ai-usage", undefined);
      return;
    }
    if (!Object.keys(config.modelRatesPerMillionTokensUsd).length) { await render(ctx); return; }
    await refreshBilling(ctx);
    if (!timer) {
      const everyMs = Math.max(1, config.billing.refreshMinutes) * 60_000;
      timer = setInterval(() => void refreshBilling(ctx), everyMs);
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    config = await loadConfig();
    await startBillingRefresh(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    if (event.model.provider === "cloudflare-workers-ai") {
      await startBillingRefresh(ctx);
      return;
    }
    if (timer) clearInterval(timer);
    timer = undefined;
    ctx.ui.setStatus("cloudflare-ai-usage", undefined);
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant" || event.message.provider !== "cloudflare-workers-ai") return;
    if (!config || !Object.keys(config.modelRatesPerMillionTokensUsd).length) return;
    const message = event.message;
    if (message.responseId && seenResponseIds.has(message.responseId)) return;
    if (message.responseId) seenResponseIds.add(message.responseId);

    const rates = config.modelRatesPerMillionTokensUsd[message.model];
    if (!rates) {
      ctx.ui.notify(`CF AI usage: no rate configured for ${message.model}`, "warning");
      return;
    }

    const usage = message.usage;
    const usd = (amount(usage.input) * rates.input + amount(usage.output) * rates.output + amount(usage.cacheRead) * rates.cacheRead + amount(usage.cacheWrite) * rates.cacheWrite) / 1_000_000;
    const neurons = usd / (config.usdPerThousandNeurons / 1_000);
    await record({
      day: utcDay(message.timestamp),
      responseId: message.responseId,
      model: message.model,
      input: amount(usage.input),
      output: amount(usage.output),
      cacheRead: amount(usage.cacheRead),
      cacheWrite: amount(usage.cacheWrite),
      neurons,
    });
    await render(ctx);
  });

  pi.registerCommand("cf-ai-usage", {
    description: "Refresh Cloudflare Workers AI usage shown in the footer",
    handler: async (_args, ctx) => {
      config = await loadConfig();
      await startBillingRefresh(ctx);
    },
  });

  pi.on("session_shutdown", () => {
    if (timer) clearInterval(timer);
  });
}

/**
 * Pick a free model for BTW, with an explicit override and a visible fallback.
 *
 * BTW is a side chat, not the main agent: it must stay cheap. The preference is
 * deliberately a free-model list first, then any available model whose id says
 * "free", and only then the current session model with a warning. A nested call
 * never changes the session's model.
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

export const FREE_MODEL_PREFERENCE = [
  "opencode-go/beam-free",
  "opencode-go/longcat-2.5-preview-free",
  "opencode-go/iceman-contributor-free",
] as const;

export type BtwModelSource = "override" | "free" | "free-id" | "current" | "none";

export interface BtwModelResolution {
  /** Ordered candidates; the controller tries the next one only before any text arrives. */
  models: Model<Api>[];
  source: BtwModelSource;
  /** Human-facing explanation when the preferred free model was not used. */
  warning?: string;
  /** `provider/id` of the first candidate, or `none`. */
  display: string;
}

export interface BtwModelInput {
  registry: Pick<ModelRegistry, "find" | "getAvailable" | "hasConfiguredAuth">;
  current?: Model<Api>;
  override?: string;
}

/** Parse `provider/id`, `provider/a/b`, or a bare id. */
export function parseModelRef(text: string): { provider: string; id: string } | undefined {
  const value = text.trim();
  if (!value) return undefined;
  const slash = value.indexOf("/");
  if (slash < 0) return { provider: "", id: value };
  const provider = value.slice(0, slash);
  const id = value.slice(slash + 1);
  return provider && id ? { provider, id } : undefined;
}

/** `provider/id`, used in headers and messages. */
export function modelLabel(model: Pick<Model<Api>, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

function availableModels(input: BtwModelInput): Model<Api>[] {
  // Free candidates are chosen even when the session's enabled-model scope
  // excludes them: BTW is a side chat, and "anything free" is the contract.
  return input.registry.getAvailable();
}

function findInAvailable(available: readonly Model<Api>[], id: string): Model<Api> | undefined {
  const matches = available.filter((model) => model.id === id);
  return matches.length === 1 ? matches[0] : matches.find((model) => model.provider === "opencode-go") ?? matches[0];
}

function resolveRef(input: BtwModelInput, ref: { provider: string; id: string }): Model<Api> | undefined {
  const available = availableModels(input);
  if (ref.provider) {
    const found = input.registry.find(ref.provider, ref.id);
    return found && input.registry.hasConfiguredAuth(found) ? found : undefined;
  }
  const found = findInAvailable(available, ref.id);
  return found && input.registry.hasConfiguredAuth(found) ? found : undefined;
}

/**
 * Resolve the ordered candidates. An override is first but never the only path:
 * free models remain fallbacks, and the current model is the final safety net.
 */
export function resolveBtwModels(input: BtwModelInput): BtwModelResolution {
  const models: Model<Api>[] = [];
  const seen = new Set<string>();
  let source: BtwModelSource = "none";
  const warnings: string[] = [];
  const add = (model: Model<Api> | undefined, from: BtwModelSource): void => {
    if (!model) return;
    const key = modelLabel(model);
    if (seen.has(key)) return;
    seen.add(key);
    if (models.length === 0) source = from;
    models.push(model);
  };

  const override = input.override?.trim();
  if (override) {
    const ref = parseModelRef(override);
    const model = ref ? resolveRef(input, ref) : undefined;
    if (model) add(model, "override");
    else warnings.push(`PI_BTW_MODEL="${override}" is not available; using a free model.`);
  }

  for (const candidate of FREE_MODEL_PREFERENCE) {
    const ref = parseModelRef(candidate);
    add(ref ? resolveRef(input, ref) : undefined, "free");
  }

  for (const model of availableModels(input)) {
    if (/free/i.test(model.id)) add(model, "free-id");
  }

  const freeFound = models.some((model) => /free/i.test(model.id));
  // The current model is always the last safety net, even when free candidates
  // exist but are down. The controller reports it if a fallback is actually used.
  add(input.current, "current");
  if (!freeFound && models.length > 0) {
    const preferred = models[0]!;
    warnings.push(
      `No free model is configured; BTW is using ${modelLabel(preferred)}. Set PI_BTW_MODEL to choose another.`,
    );
  }
  if (models.length === 0) {
    warnings.push("No model is available for BTW. Configure model access or set PI_BTW_MODEL.");
  }

  return {
    models,
    source,
    display: models[0] ? modelLabel(models[0]) : "none",
    ...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
  };
}

/** Output cap for a side answer or a summary. */
export function outputLimit(model: Pick<Model<Api>, "maxTokens">, purpose: "answer" | "summary"): number {
  const cap = purpose === "answer" ? 4_096 : 1_024;
  const configured = Number.isFinite(model.maxTokens) && model.maxTokens > 0 ? model.maxTokens : cap;
  return Math.min(configured, cap);
}

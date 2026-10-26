import { describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  FREE_MODEL_PREFERENCE,
  modelLabel,
  outputLimit,
  parseModelRef,
  resolveBtwModels,
} from "../../extensions/btw/model.ts";

function model(provider: string, id: string, extra: Partial<Model<Api>> = {}): Model<Api> {
  return {
    provider,
    id,
    name: id,
    api: "openai-completions",
    baseUrl: "https://example.test",
    reasoning: false,
    contextWindow: 128_000,
    maxTokens: 4_096,
    input: ["text"],
    ...extra,
  } as Model<Api>;
}

function registry(models: Model<Api>[]) {
  return {
    find: (provider: string, id: string) => models.find((item) => item.provider === provider && item.id === id),
    getAvailable: () => models,
    hasConfiguredAuth: () => true,
  };
}

const current = model("opencode-go", "deepseek-v4.1-flash");
const beam = model("opencode-go", "beam-free");
const longcat = model("opencode-go", "longcat-2.5-preview-free");

describe("parseModelRef", () => {
  test("splits provider/id and keeps nested ids", () => {
    expect(parseModelRef("opencode-go/beam-free")).toEqual({ provider: "opencode-go", id: "beam-free" });
    expect(parseModelRef("cloudflare-workers-ai/@cf/openai/gpt-oss-20b")).toEqual({
      provider: "cloudflare-workers-ai",
      id: "@cf/openai/gpt-oss-20b",
    });
    expect(parseModelRef("beam-free")).toEqual({ provider: "", id: "beam-free" });
    expect(parseModelRef("  ")).toBeUndefined();
  });
});

describe("resolveBtwModels", () => {
  test("prefers the ordered free list", () => {
    const result = resolveBtwModels({ registry: registry([beam, longcat, current]), current });
    expect(result.display).toBe(modelLabel(beam));
    expect(result.source).toBe("free");
    expect(result.models.map(modelLabel)).toEqual([modelLabel(beam), modelLabel(longcat), modelLabel(current)]);
    expect(result.warning).toBeUndefined();
  });

  test("an explicit override wins", () => {
    const result = resolveBtwModels({
      registry: registry([beam, longcat, current]),
      current,
      override: "opencode-go/longcat-2.5-preview-free",
    });
    expect(result.models[0] && modelLabel(result.models[0])).toBe(modelLabel(longcat));
    expect(result.source).toBe("override");
  });

  test("a free override does not warn that no free model is configured", () => {
    const result = resolveBtwModels({
      registry: registry([beam, current]),
      current,
      override: "opencode-go/beam-free",
    });
    expect(result.source).toBe("override");
    expect(result.warning).toBeUndefined();
  });

  test("a missing override warns and still uses a free model", () => {
    const result = resolveBtwModels({ registry: registry([beam, current]), current, override: "missing/nope" });
    expect(result.models[0] && modelLabel(result.models[0])).toBe(modelLabel(beam));
    expect(result.warning).toContain("PI_BTW_MODEL");
  });

  test("falls back to the current model with a warning when no free model exists", () => {
    const result = resolveBtwModels({ registry: registry([current]), current });
    expect(result.models.map(modelLabel)).toEqual([modelLabel(current)]);
    expect(result.source).toBe("current");
    expect(result.warning).toContain("No free model");
  });

  test("accepts any available model whose id says free", () => {
    const custom = model("custom", "tiny-free-model");
    const result = resolveBtwModels({ registry: registry([custom, current]), current });
    expect(result.models[0] && modelLabel(result.models[0])).toBe(modelLabel(custom));
    expect(result.source).toBe("free-id");
  });

  test("uses a free model even when the session scope excludes it", () => {
    const result = resolveBtwModels({ registry: registry([beam, current]), current });
    expect(result.models[0] && modelLabel(result.models[0])).toBe(modelLabel(beam));
    expect(result.source).toBe("free");
  });

  test("reports no model when nothing is available", () => {
    const result = resolveBtwModels({ registry: registry([]) });
    expect(result.models).toEqual([]);
    expect(result.display).toBe("none");
    expect(result.warning).toContain("No model");
  });

  test("the preference list is free-only", () => {
    expect(FREE_MODEL_PREFERENCE.every((id) => /free/i.test(id))).toBe(true);
  });
});

describe("outputLimit", () => {
  test("caps answers and summaries", () => {
    expect(outputLimit({ maxTokens: 100_000 } as Model<Api>, "answer")).toBe(4_096);
    expect(outputLimit({ maxTokens: 100_000 } as Model<Api>, "summary")).toBe(1_024);
    expect(outputLimit({ maxTokens: 128 } as Model<Api>, "answer")).toBe(128);
    expect(outputLimit({ maxTokens: 0 } as Model<Api>, "answer")).toBe(4_096);
  });
});

import { isBoolean, isString, loadConfig, objectValidator, type LoadedConfig } from "../shared/config.ts";

export type WorkbenchConfig = {
  pet: { enabled: boolean; theme: string; badges: boolean };
  statusline: { enabled: boolean; showTokens: boolean };
  cockpit: { enabled: boolean };
  observability: { enabled: boolean };
};

export const WORKBENCH_CONFIG_NAME = "workbench";

export const DEFAULT_WORKBENCH_CONFIG: WorkbenchConfig = {
  pet: { enabled: true, theme: "auto", badges: true },
  statusline: { enabled: true, showTokens: true },
  cockpit: { enabled: true },
  observability: { enabled: true },
};

function section(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const isSection = (value: unknown): boolean =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validate = objectValidator({
  pet: isSection,
  statusline: isSection,
  cockpit: isSection,
  observability: isSection,
});

function pick<T>(value: unknown, fallback: T, guard: (v: unknown) => boolean): T {
  return guard(value) ? (value as T) : fallback;
}

function mergeWorkbenchConfig(base: WorkbenchConfig, override: Record<string, unknown>): WorkbenchConfig {
  const pet = section(override.pet);
  const statusline = section(override.statusline);
  const cockpit = section(override.cockpit);
  const observability = section(override.observability);
  return {
    pet: {
      enabled: pick(pet.enabled, base.pet.enabled, isBoolean),
      theme: pick(pet.theme, base.pet.theme, isString),
      badges: pick(pet.badges, base.pet.badges, isBoolean),
    },
    statusline: {
      enabled: pick(statusline.enabled, base.statusline.enabled, isBoolean),
      showTokens: pick(statusline.showTokens, base.statusline.showTokens, isBoolean),
    },
    cockpit: { enabled: pick(cockpit.enabled, base.cockpit.enabled, isBoolean) },
    observability: { enabled: pick(observability.enabled, base.observability.enabled, isBoolean) },
  };
}

export interface WorkbenchConfigOptions {
  cwd: string;
  agentDir: string;
  extensionDir?: string;
}

export function loadWorkbenchConfig(options: WorkbenchConfigOptions): LoadedConfig<WorkbenchConfig> {
  return loadConfig<WorkbenchConfig>(WORKBENCH_CONFIG_NAME, {
    defaults: DEFAULT_WORKBENCH_CONFIG,
    cwd: options.cwd,
    agentDir: options.agentDir,
    extensionDir: options.extensionDir,
    validate,
    merge: mergeWorkbenchConfig,
  });
}

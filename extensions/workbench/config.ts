import { isBoolean, isString, loadConfig, objectValidator, type LoadedConfig } from "../shared/config.ts";

export type WorkbenchConfig = {
  pet: { enabled: boolean; theme: string; badges: boolean; art: boolean; signOff: boolean; lines: boolean };
  statusline: { enabled: boolean; showTokens: boolean };
  cockpit: { enabled: boolean; mode: "compact" | "full"; maxRows: number };
  observability: { enabled: boolean };
  hud: { enabled: boolean; pollSec: number };
  deploy: { enabled: boolean };
  decorate: { enabled: boolean };
};

export const WORKBENCH_CONFIG_NAME = "workbench";

export const DEFAULT_WORKBENCH_CONFIG: WorkbenchConfig = {
  pet: { enabled: true, theme: "auto", badges: true, art: true, signOff: true, lines: true },
  statusline: { enabled: true, showTokens: true },
  cockpit: { enabled: true, mode: "compact", maxRows: 8 },
  observability: { enabled: true },
  hud: { enabled: true, pollSec: 5 },
  deploy: { enabled: true },
  decorate: { enabled: true },
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
  hud: isSection,
  deploy: isSection,
  decorate: isSection,
});

function pick<T>(value: unknown, fallback: T, guard: (v: unknown) => boolean): T {
  return guard(value) ? (value as T) : fallback;
}

function mergeWorkbenchConfig(base: WorkbenchConfig, override: Record<string, unknown>): WorkbenchConfig {
  const pet = section(override.pet);
  const statusline = section(override.statusline);
  const cockpit = section(override.cockpit);
  const observability = section(override.observability);
  const hud = section(override.hud);
  const deploy = section(override.deploy);
  const decorate = section(override.decorate);
  return {
    pet: {
      enabled: pick(pet.enabled, base.pet.enabled, isBoolean),
      theme: pick(pet.theme, base.pet.theme, isString),
      badges: pick(pet.badges, base.pet.badges, isBoolean),
      art: pick(pet.art, base.pet.art, isBoolean),
      signOff: pick(pet.signOff, base.pet.signOff, isBoolean),
      lines: pick(pet.lines, base.pet.lines, isBoolean),
    },
    statusline: {
      enabled: pick(statusline.enabled, base.statusline.enabled, isBoolean),
      showTokens: pick(statusline.showTokens, base.statusline.showTokens, isBoolean),
    },
    cockpit: {
      enabled: pick(cockpit.enabled, base.cockpit.enabled, isBoolean),
      mode: cockpit.mode === "full" || cockpit.mode === "compact" ? cockpit.mode : base.cockpit.mode,
      maxRows:
        typeof cockpit.maxRows === "number" && Number.isFinite(cockpit.maxRows)
          ? Math.min(30, Math.max(3, Math.round(cockpit.maxRows)))
          : base.cockpit.maxRows,
    },
    observability: { enabled: pick(observability.enabled, base.observability.enabled, isBoolean) },
    hud: {
      enabled: pick(hud.enabled, base.hud.enabled, isBoolean),
      pollSec: typeof hud.pollSec === "number" && Number.isFinite(hud.pollSec) ? Math.min(60, Math.max(1, hud.pollSec)) : base.hud.pollSec,
    },
    deploy: { enabled: pick(deploy.enabled, base.deploy.enabled, isBoolean) },
    decorate: { enabled: pick(decorate.enabled, base.decorate.enabled, isBoolean) },
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

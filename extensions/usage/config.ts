/**
 * Configuration for the `usage` extension.
 *
 * A config file only ever *names* environment variables; it never contains a key.
 * Precedence and malformed-file handling come from `shared/config.ts`.
 */
import {
  clamp,
  isFiniteNumber,
  isString,
  loadConfig,
  objectValidator,
  type LoadedConfig,
} from "../shared/config.ts";

export type UsageConfig = {
  /** Minutes between quota refreshes. */
  refreshMinutes: number;
  opencodeGo: {
    /** Env var used as a fallback when Pi has no provider auth. */
    keyEnv: string;
    baseUrl: string;
  };
};

export const USAGE_CONFIG_NAME = "usage";

export const DEFAULT_USAGE_CONFIG: UsageConfig = {
  refreshMinutes: 5,
  opencodeGo: {
    keyEnv: "OPENCODE_API_KEY",
    baseUrl: "https://opencode.ai/zen/go/v1/usage",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const validate = objectValidator({
  refreshMinutes: isFiniteNumber,
  opencodeGo: isRecord,
});

function mergeUsageConfig(base: UsageConfig, override: Record<string, unknown>): UsageConfig {
  const refresh = override.refreshMinutes;
  const opencodeGo = isRecord(override.opencodeGo) ? override.opencodeGo : {};
  return {
    refreshMinutes: clamp(isFiniteNumber(refresh) ? refresh : base.refreshMinutes, 1, 240),
    opencodeGo: {
      keyEnv: isString(opencodeGo.keyEnv) ? opencodeGo.keyEnv : base.opencodeGo.keyEnv,
      baseUrl: isString(opencodeGo.baseUrl) ? opencodeGo.baseUrl : base.opencodeGo.baseUrl,
    },
  };
}

export interface UsageConfigOptions {
  cwd: string;
  agentDir: string;
  extensionDir?: string;
}

export function loadUsageConfig(options: UsageConfigOptions): LoadedConfig<UsageConfig> {
  return loadConfig<UsageConfig>(USAGE_CONFIG_NAME, {
    defaults: DEFAULT_USAGE_CONFIG,
    cwd: options.cwd,
    agentDir: options.agentDir,
    extensionDir: options.extensionDir,
    validate,
    merge: mergeUsageConfig,
  });
}

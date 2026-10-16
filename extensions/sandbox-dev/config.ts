import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_CONFIG, mergeConfig, type SandboxDevConfig, type SandboxDevConfigOverride } from "./rules.ts";

export interface LoadedConfig {
  config: SandboxDevConfig;
  sources: string[];
  errors: string[];
}

export function agentDir(): string {
  const fromEnv = process.env.PI_CODING_AGENT_DIR;
  return fromEnv ? resolve(fromEnv) : join(process.env.HOME ?? ".", ".pi", "agent");
}

export function configPaths(cwd: string, agentDirectory: string): { global: string; project: string } {
  return { global: join(agentDirectory, "sandbox-dev.json"), project: join(cwd, ".pi", "sandbox-dev.json") };
}

/**
 * Load the permission config. Global first, project second (project wins). Missing files are
 * skipped; malformed files are reported and ignored so a bad project config cannot weaken the
 * built-in defaults.
 */
export function loadConfig(cwd: string, agentDirectory: string): LoadedConfig {
  const { global, project } = configPaths(cwd, agentDirectory);
  let config = DEFAULT_CONFIG;
  const sources: string[] = [];
  const errors: string[] = [];
  for (const path of [global, project]) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as SandboxDevConfigOverride;
      config = mergeConfig(config, parsed);
      sources.push(path);
    } catch (error) {
      errors.push(`${path}: ${(error as Error).message}`);
    }
  }
  return { config, sources, errors };
}

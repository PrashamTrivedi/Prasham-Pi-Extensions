import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A resolved configuration plus which files contributed and which failed. */
export interface LoadedConfig<T> {
  config: T;
  sources: string[];
  errors: string[];
}

export interface LoadConfigOptions<T extends Record<string, unknown>> {
  defaults: T;
  cwd: string;
  agentDir: string;
  extensionDir?: string;
  /** Optional shape check; when present, a source failing it is reported and skipped. */
  validate?: (value: Record<string, unknown>) => boolean;
  /** Optional merge strategy; defaults to a shallow override. */
  merge?: (base: T, override: Record<string, unknown>) => T;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

/** Clamp a number into [min, max]; non-finite input becomes `min`. */
export function clamp(value: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Build a shape check for a config object. Unknown keys are allowed; a known key
 * with the wrong type fails the check.
 */
export function objectValidator(
  validators: Record<string, (value: unknown) => boolean>,
): (value: Record<string, unknown>) => boolean {
  return (value) =>
    isObject(value) &&
    Object.entries(validators).every(([key, check]) => value[key] === undefined || check(value[key]));
}

function shallowMerge<T extends Record<string, unknown>>(base: T, override: Record<string, unknown>): T {
  return Object.assign({}, base, override);
}

/**
 * Resolve `<name>.config.json` from lowest to highest precedence:
 * extension defaults, agent dir, cwd, then `<cwd>/.pi`.
 */
export function configPaths(
  name: string,
  options: { cwd: string; agentDir: string; extensionDir?: string },
): string[] {
  const paths: string[] = [];
  if (options.extensionDir) paths.push(join(options.extensionDir, `${name}.config.json`));
  paths.push(join(options.agentDir, `${name}.config.json`));
  paths.push(join(options.cwd, `${name}.config.json`));
  paths.push(join(options.cwd, ".pi", `${name}.config.json`));
  return paths;
}

/**
 * Load an extension config. Missing files are skipped; malformed or invalid files
 * are reported in `errors` and ignored, so a bad override can never weaken the
 * built-in defaults.
 */
export function loadConfig<T extends Record<string, unknown>>(
  name: string,
  options: LoadConfigOptions<T>,
): LoadedConfig<T> {
  let config: T = options.defaults;
  const sources: string[] = [];
  const errors: string[] = [];
  const merge = options.merge ?? shallowMerge<T>;

  for (const path of configPaths(name, options)) {
    if (!existsSync(path)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!isObject(parsed)) {
      errors.push(`${path}: expected a JSON object`);
      continue;
    }
    if (options.validate && !options.validate(parsed)) {
      errors.push(`${path}: failed validation`);
      continue;
    }
    config = merge(config, parsed);
    sources.push(path);
  }

  return { config, sources, errors };
}

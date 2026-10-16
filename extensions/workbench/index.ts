/**
 * workbench — one registered entry with feature flags (locked decision #6).
 * Each feature registers inside its own `try`, so one broken feature cannot take
 * the others down; failures are reported once at `session_start`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_WORKBENCH_CONFIG, loadWorkbenchConfig, type WorkbenchConfig } from "./config.ts";
import { registerPet } from "./pet.ts";
import { registerStatusline } from "./statusline.ts";

function agentDir(): string {
  const fromEnv = process.env.PI_CODING_AGENT_DIR;
  return fromEnv && fromEnv.length > 0 ? fromEnv : join(homedir(), ".pi", "agent");
}

export default function workbench(pi: ExtensionAPI) {
  const state: { config: WorkbenchConfig } = { config: DEFAULT_WORKBENCH_CONFIG };
  const getConfig = (): WorkbenchConfig => state.config;

  // Loaded before feature handlers run (handlers run in registration order).
  pi.on("session_start", async (_event, ctx) => {
    const loaded = loadWorkbenchConfig({ cwd: ctx.cwd, agentDir: agentDir() });
    state.config = loaded.config;
    if (loaded.errors.length > 0) ctx.ui.notify(`workbench config: ${loaded.errors.join("; ")}`, "error");
  });

  const failures: string[] = [];
  const features: Array<[string, () => void]> = [
    ["pet", () => registerPet(pi, getConfig)],
    ["statusline", () => registerStatusline(pi, getConfig)],
  ];
  for (const [name, register] of features) {
    try {
      register();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    if (failures.length > 0) ctx.ui.notify(`workbench features degraded: ${failures.join("; ")}`, "error");
  });
}

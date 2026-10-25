/**
 * The neutral tool shape jev-harness expects.
 *
 * Both gating extensions need it: `sandbox-dev` maps every `tool_call` before asking the decision
 * server, and `jev-gate` maps a `tool_result` before reporting it. It lives here so the two never
 * drift apart — a mapping difference would silently change what the harness sees.
 */

export type ToolKind = "shell" | "read" | "write" | "edit" | "mcp" | "fetch" | "subagent" | "browser" | "other";

export interface JevToolCall {
  name: string;
  kind: ToolKind;
  input: Record<string, unknown>;
  command?: string;
  description?: string;
  path?: string;
  content?: string;
  range?: { start?: number; end?: number };
  url?: string;
  mcpServer?: string;
  mcpTool?: string;
  mcpArgs?: Record<string, unknown>;
  output?: string;
  subagentPrompt?: string;
  subagentModel?: string;
}

function asStr(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Map a Pi tool name + input to the neutral jev-harness ToolCall. Pure. */
export function mapToolCall(name: string, input: Record<string, unknown>): JevToolCall {
  const base = { name, input };
  if (name === "bash") {
    return { ...base, kind: "shell", command: asStr(input.command), description: asStr(input.description) };
  }
  if (name === "read") {
    const offset = typeof input.offset === "number" ? input.offset : undefined;
    const limit = typeof input.limit === "number" ? input.limit : undefined;
    return {
      ...base,
      kind: "read",
      path: asStr(input.path),
      range: offset || limit ? { start: offset, end: limit ? (offset ?? 1) + limit - 1 : undefined } : undefined,
    };
  }
  if (name === "write") return { ...base, kind: "write", path: asStr(input.path), content: asStr(input.content) };
  if (name === "edit") {
    const edits = Array.isArray(input.edits) ? (input.edits as Array<{ newText?: unknown }>) : [];
    const content = edits.map((edit) => String(edit.newText ?? "")).join("\n") || asStr(input.content);
    return { ...base, kind: "edit", path: asStr(input.path), content };
  }
  if (name === "spawn_agents") {
    const agents = Array.isArray(input.agents) ? (input.agents as Array<{ task?: unknown; model?: unknown }>) : [];
    return {
      ...base,
      kind: "subagent",
      subagentPrompt: asStr(agents[0]?.task ?? input.task),
      subagentModel: asStr(agents[0]?.model ?? input.model),
    };
  }
  if (name.startsWith("mcp__")) {
    const [, server, ...rest] = name.split("__");
    return { ...base, kind: "mcp", mcpServer: server, mcpTool: rest.join("__"), mcpArgs: input };
  }
  if (name === "web_fetch" || name === "fetch") return { ...base, kind: "fetch", url: asStr(input.url) };
  return { ...base, kind: "other" };
}

/** Join the text parts of a Pi tool result. Pure. */
export function flattenContent(content: Array<{ type?: string; text?: string }>): string {
  return content
    .filter((part) => part?.type === "text")
    .map((part) => String(part.text ?? ""))
    .join("\n")
    .trim();
}

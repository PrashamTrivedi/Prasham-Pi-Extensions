/**
 * Read-only search of the `memory-server` MCP store.
 *
 * Pi does not expose an MCP client to extensions — only a tool's `execute()`
 * gets `ctx.executeTool` — so a slash command cannot call
 * `mcp__memory_server__find_memories`. It speaks the same JSON-RPC `tools/call`
 * the MCP client would instead, reusing the OAuth access token Pi already stored
 * in `mcp-auth.json`. Nothing is written and no token is refreshed: an expired
 * token is reported so the human can reconnect with `/mcp`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface MemoryServerAuth {
  url: string;
  token: string;
}

export interface ServerMemory {
  id?: string;
  name: string;
  content: string;
  tags: string[];
  updatedAt?: string;
}

/** The `memory-server` entry of `mcp-auth.json`, or undefined when absent or expired. */
export function memoryServerAuth(agentDir: string, now = Date.now()): MemoryServerAuth | undefined {
  let store: Record<string, unknown>;
  try {
    store = JSON.parse(readFileSync(join(agentDir, "mcp-auth.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  for (const [key, value] of Object.entries(store)) {
    if (!/memory[_-]server/i.test(key)) continue;
    const entry = value as { serverUrl?: unknown; tokens?: { access_token?: unknown }; tokensExpireAt?: unknown };
    const url = typeof entry.serverUrl === "string" ? entry.serverUrl : undefined;
    const token = typeof entry.tokens?.access_token === "string" ? entry.tokens.access_token : undefined;
    if (!url || !token) return undefined;
    // `tokensExpireAt` is milliseconds; an expired token needs a reconnect, not a retry.
    if (typeof entry.tokensExpireAt === "number" && entry.tokensExpireAt <= now) return undefined;
    return { url, token };
  }
  return undefined;
}

/** An MCP response is either plain JSON or server-sent events; both carry one JSON-RPC object. */
export function parseMcpBody(body: string): unknown {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  for (const line of trimmed.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      return JSON.parse(line.slice(5).trim());
    } catch {
      // A multi-line data payload is not how these servers answer; keep looking.
    }
  }
  return undefined;
}

/** Reads `structuredContent.data.memories`, falling back to the human summary text. */
function memoriesFrom(envelope: unknown): ServerMemory[] {
  const result = (envelope as { result?: { structuredContent?: { data?: { memories?: unknown } }; content?: Array<{ type?: string; text?: string }> } }).result;
  const rows = result?.structuredContent?.data?.memories;
  if (Array.isArray(rows)) {
    return rows.flatMap((row) => {
      const memory = row as { id?: string; name?: unknown; content?: unknown; tags?: unknown; updated_at?: unknown };
      if (typeof memory.content !== "string" && typeof memory.name !== "string") return [];
      return [{
        ...(typeof memory.id === "string" ? { id: memory.id } : {}),
        name: typeof memory.name === "string" && memory.name ? memory.name : "(untitled)",
        content: typeof memory.content === "string" ? memory.content : "",
        tags: Array.isArray(memory.tags) ? memory.tags.filter((tag): tag is string => typeof tag === "string") : [],
        ...(typeof memory.updated_at === "string" ? { updatedAt: memory.updated_at } : {}),
      }];
    });
  }
  const text = result?.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim();
  return text ? [{ name: "memory-server", content: text, tags: [] }] : [];
}

/**
 * Calls `find_memories` and returns its rows. Throws with the server's message so
 * the caller can show it; a failed server search must never hide local hits.
 */
export async function findServerMemories(
  query: string,
  options: { auth: MemoryServerAuth; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<ServerMemory[]> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "find_memories", arguments: { query } },
  });
  const response = await doFetch(options.auth.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.auth.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      // Cloudflare in front of the server answers 403 to the default fetch agent.
      "User-Agent": "pi-memory-search/1",
    },
    body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
  });
  if (!response.ok) throw new Error(`memory-server answered ${response.status}${response.status === 401 ? " — reconnect it with /mcp" : ""}`);
  const envelope = parseMcpBody(await response.text());
  const error = (envelope as { error?: { message?: unknown } }).error;
  if (error) throw new Error(typeof error.message === "string" ? error.message : "memory-server rejected the search");
  return memoriesFrom(envelope);
}

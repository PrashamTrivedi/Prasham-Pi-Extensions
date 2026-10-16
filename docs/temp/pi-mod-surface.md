# Pi 1.2.0 mod surface (verified inventory)

I read the installed declarations at `@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`, `core/virtual-models.d.ts`, `core/event-bus.d.ts`, `core/model-registry.d.ts`, and `@earendil-works/pi-tui/dist/index.d.ts`. The installed runtime is **1.2.0**; this repository pins dev dependencies to **0.85.1**. The installed declarations win for this report. Examples below are deliberately small compiling TypeScript fragments against 1.2.0.

## 1. Tool renderers, including not-yet-registered tools

Exact declarations:

```ts
registerToolRenderer(resolver: ToolRendererResolver): void;
type ToolRendererResolver = (toolName: string, next: () => ToolRenderers | undefined) => ToolRenderers | undefined;
type ToolRenderers = Pick<AnyToolDefinition, "renderShell" | "renderCall" | "renderResult">;
renderCall?: (args: Static<TParams>, theme: Theme, context: ToolRenderContext<TState, Static<TParams>>) => Component;
renderResult?: (result: AgentToolResult<TDetails>, options: ToolRenderResultOptions, theme: Theme, context: ToolRenderContext<TState, Static<TParams>>) => Component;
```

A resolver runs in load order and may match any name, even an unregistered `mcp__*` name. `next()` returns the remaining resolvers and then the registered tool's renderers; `next() ?? mine` is the clean fall-through pattern. Therefore MCP results can be rendered as a table/diff once the resolver has a renderer, including a resumed call before the MCP server reconnects. It does not grant access to or execute the MCP tool; it only changes the display.

```ts
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default (pi: ExtensionAPI) => pi.registerToolRenderer((name, next) => {
  if (!name.startsWith("mcp__")) return next();
  return { renderShell: "default",
    renderCall: (args, theme) => new Text(theme.fg("accent", `${name} ${JSON.stringify(args)}`)),
    renderResult: (result, _opts, theme) => new Text(theme.fg(result.isError ? "error" : "success", JSON.stringify(result.content))) };
});
```

## 2. Persistent widgets

Exact declarations:

```ts
setWidget(key: string, content: string[] | undefined, options?: ExtensionWidgetOptions): void;
setWidget(key: string, content: ((tui: TUI, theme: Theme) => Component & { dispose?(): void }) | undefined, options?: ExtensionWidgetOptions): void;
type WidgetPlacement = "aboveEditor" | "belowEditor";
```

The key replaces/removes that widget. A string array is static lines; a factory creates a component with the current TUI/theme. It is persistent for the current interactive runtime, but `/reload` tears down extension runtime state and re-runs registration, so it is not guaranteed to survive (reinstall it on `session_start` if desired).

```ts
pi.on("session_start", (_e, ctx) => {
  ctx.ui.setWidget("gate", ["SAFETY: armed"], { placement: "belowEditor" });
  ctx.ui.setWidget("live", (tui, theme) => new Text(theme.fg("dim", "live")));
});
```

## 3. Custom editor and `CustomEditor`

Exact declaration: `setEditorComponent(factory: EditorFactory | undefined): void`, where `EditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent`; `CustomEditor` is `class CustomEditor extends Editor` with constructor `(tui, theme, keybindings, options?)`.

Replacing with an arbitrary `EditorComponent` loses the default text editing and app-level key handling unless implemented. Extending `CustomEditor` keeps `Editor` editing, autocomplete/editor behavior, and Pi app shortcuts; call `super.handleInput(data)` for keys not consumed. `setEditorComponent(undefined)` restores the default.

```ts
import { CustomEditor } from "@earendil-works/pi-coding-agent";
pi.on("session_start", (_e, ctx) => ctx.ui.setEditorComponent((t, theme, keys) =>
  new class extends CustomEditor { handleInput(data: string) { if (data === "x") return; super.handleInput(data); } }(t, theme, keys)));
// Restore: ctx.ui.setEditorComponent(undefined);
```

## 4. Virtual models are per-request routing

Exact declarations:

```ts
registerVirtualModel<TState = unknown>(model: ExtensionVirtualModel<TState>): void;
interface ExtensionVirtualModel<TState> extends Omit<VirtualModelDefinition<TState>, "route"> {
  route(request: ModelRouteRequest<TState>, ctx: ExtensionContext): ModelRoute<TState> | Promise<ModelRoute<TState>>;
}
interface ModelRouteRequest<TState> { model: Model<Api>; thinkingLevel: ModelThinkingLevel; reason: ModelRouteReason; previous?: { model: Model<Api>; thinkingLevel?: ModelThinkingLevel }; state?: TState; messages: readonly Message[]; signal?: AbortSignal; }
interface ModelRoute<TState> { model: Model<Api>; thinkingLevel: ModelThinkingLevel; state?: TState; }
```

The virtual catalog entry is selected at session level, but `route()` runs for each request (`user`, `continuation`, `retry`, or `direct`) and returns the physical model and thinking level. This is materially richer than Claude's `switchModelsOnFlag`/`model`/`effortLevel`, which the Claude declarations expose as session/agent selection controls; those declarations do not expose an equivalent per-request virtual router. (The comparison is limited to the supplied Claude declarations.)

```ts
pi.registerVirtualModel({ provider: "router", id: "smart", name: "Smart", route: async (r) => ({
  model: r.reason === "continuation" ? r.previous?.model ?? r.model : r.model,
  thinkingLevel: r.thinkingLevel,
}) });
```

## 5. Shortcuts and flags

Exact declarations: `registerShortcut(shortcut: KeyId, options: { description?: string; handler: (ctx: ExtensionContext) => Promise<void> | void }): void`; `registerFlag(name: string, options: { description?: string; type: "boolean"; default?: boolean } | { description?: string; type: "string"; default?: string }): void`; `getFlag(name: string): boolean | string | undefined`.

A shortcut is interactive key dispatch. A flag is parsed at process/session startup and is useful before a prompt (and in print/RPC invocation), whereas a slash command is typed after startup and has arguments.

```ts
pi.registerFlag("safe", { type: "boolean", default: true });
pi.registerShortcut("ctrl+shift+s", { description: "Safety", handler: ctx => ctx.ui.notify(`safe=${pi.getFlag("safe")}`) });
```

## 6. Input and transform

Exact declarations: `on("input", handler: ExtensionHandler<InputEvent, InputEventResult>): () => void`; result is `{ action: "continue" } | { action: "transform"; text: string; images?: ImageContent[] } | { action: "handled" }`.

There is no separate input-transform hook: the `input` event is it. A transform silently replaces the text; handled consumes it; continue leaves it unchanged. This can rewrite a prompt without asking.

```ts
pi.on("input", e => e.text.startsWith("!!")
  ? { action: "transform", text: e.text.slice(2).trim(), images: e.images }
  : { action: "continue" });
```

## 7. Exposure and codemode

The five exact meanings are: `direct` = declared to the model while active and callable while active; `model-only` = declared/callable only by model, never callable by other tools; `codemode` = callable whenever registered, not declared unless activated; `deferred` = codemode-callable but omitted from codemode listings and discoverable by `tool_search`; `hidden` = registered but unreachable. Direct/model-only activate on registration; others do not.

Codemode scripts call native or MCP tools through the script's `callTool` mechanism (which Pi implements using the same callable tool set / nested execution path). Scripts use `searchTools(query, { limit?, namespace? })`, `describeTool(name)`, and `describeNamespace(name)`: search ranks callable tools, describe returns description plus TypeScript declaration or `undefined`, and namespace returns namespace metadata and tool names or `undefined`. `ALL_TOOLS` includes every callable tool. `reachesTools(input)` is the declaration that says which tools an orchestrator may reach: `"all"` or name/namespace words; codemode uses all for search/list operations, otherwise script words.

```ts
pi.registerTool({ name: "internal", label: "Internal", description: "callable by scripts", exposure: "codemode", parameters: Type.Object({}), async execute() { return { content: [{ type: "text", text: "ok" }], details: undefined }; } });
```

## 8. Cross-extension event bus

Exact declarations: `events: EventBus`; `interface EventBus { emit(channel: string, data: unknown): void; on(channel: string, handler: (data: unknown) => void): () => void; }`.

It is process-local/shared by extensions in one Pi runtime, not transcript or cross-process IPC. Handlers run in registration order in the synchronous emitter (the declaration does not promise async ordering); `on` returns unsubscribe.

```ts
const off = pi.events.on("ramp", data => console.log(data));
pi.events.emit("ramp", { aggression: 0.7 });
// off();
```

## 9. Nested tools

Exact declaration: `executeTool(name: string, args: unknown, options?: { signal?: AbortSignal; onUpdate?: AgentToolUpdateCallback }): Promise<AgentToolCallOutcome>`; nested ids are `<calling id>/<n>` and carry `parentToolCallId`. Failures return `isError: true`, not rejected promises. Nested calls are absent from the transcript and retained as bounded `nestedCalls`; nested `usage` is added to the calling tool's reported usage, while the calling tool reports only its own usage.

```ts
async execute(_id, _args, _signal, _update, ctx) {
  const result = await ctx.executeTool("read", { path: "README.md" });
  return { content: [{ type: "text", text: JSON.stringify(result.content) }], details: undefined, usage: result.usage };
}
```

## 10. Nested model calls

Exact declaration: `streamSimple(model: Model<Api>, context: Context, options?: ModelsSimpleStreamOptions): AssistantMessageEventStream` on `ctx.modelRegistry` (the context is `{ systemPrompt?: string; messages: Message[]; tools?: Tool[] }`). Consume the async event stream and use its `done.message.usage`. This avoids spawning a CLI process.

```ts
const model = ctx.model; if (!model) return;
const stream = ctx.modelRegistry.streamSimple(model, { messages: [{ role: "user", content: "Question only", timestamp: Date.now() }] });
for await (const event of stream) if (event.type === "done") ctx.ui.notify(`in=${event.message.usage.input} out=${event.message.usage.output}`);
```

## 11. Tool annotations

Exact declaration: `annotations?: ToolAnnotations`, with `readOnlyHint?`, `destructiveHint?`, `idempotentHint?`, and `openWorldHint?` booleans. `getAllTools(): ToolInfo[]`, where `ToolInfo` includes `exposure`, `namespace`, `annotations`, and `reachesTools` in addition to name/description/schema/source. MCP tools carry server annotations; missing hints use the documented conservative MCP defaults (not read-only, may be destructive/open-world), and hints are unverified author claims.

```ts
for (const tool of pi.getAllTools()) if (tool.annotations?.destructiveHint) console.log(tool.name, tool.annotations);
```

## 12. Branch-scoped custom entries

Exact declarations: `appendEntry<T = unknown>(customType: string, data?: T): void`; `registerEntryRenderer<T = unknown>(customType: string, renderer: EntryRenderer<T>): void`; `EntryRenderer = (entry: CustomEntry<T>, options: EntryRenderOptions, theme: Theme) => Component | undefined`.

Entries persist state in the current session branch, are rendered with the registered renderer, and do not participate in LLM context. A custom *message* renderer (`registerMessageRenderer`) is for custom messages, which can participate depending on how they are sent; do not confuse it with a custom entry.

```ts
pi.registerEntryRenderer("gate.state", (entry, _opts, theme) => new Text(theme.fg("dim", JSON.stringify(entry.data))));
pi.appendEntry("gate.state", { enabled: true });
```

## 13. Additional genuine capabilities

The declarations also expose: `registerProvider`/OAuth and custom streaming providers; `registerMcpServer`; `sendUserMessage` and `sendMessage` with steering/follow-up delivery; mutable `context` and full `context_with_system` hooks; provider request/header/response interception; compaction/tree/session switching; custom footer/header/status/title/theme/editor/widgets; autocomplete providers; resource discovery; project trust; and `ctx.exec`. These are capabilities rather than mere lifecycle notifications. Pi's tool renderer resolver and per-request virtual routing are especially clear Claude-plugin gaps in the supplied declarations. Claude's plugin declarations do expose rich event hooks, UI clients, state atoms, agent spawning, and model classification, so those are **not** claimed as Claude gaps.

### Claude comparison table

| capability | exists in Claude Code plugin API? | source of claim |
|---|---|---|
| Resolver rendering of any registered/unregistered/MCP tool | **unverified / no equivalent found** | Pi `types.d.ts` `registerToolRenderer`; Claude `claude-code/index.d.ts` event/UI types reviewed, no matching renderer resolver |
| Persistent above/below-editor widget factory | **unverified** | Pi `ExtensionUIContext.setWidget`; Claude UI surface declarations reviewed |
| Custom editor extending Pi `CustomEditor` | **no equivalent found** | Pi exported `CustomEditor`; Claude types expose UI elements, not an editor subclass contract |
| Per-request virtual model routing | **no equivalent found** | Pi `VirtualModelDefinition.route`; Claude types' model/effort fields are agent/session selection |
| Slash commands / shortcuts / CLI flags | yes, partly | Claude command/event and UI declarations; exact parity of Pi CLI flags is **unverified** |
| Silent input transform | yes, via prompt hooks | Claude `prompt.fill` / prompt edit events in `claude-code/index.d.ts` |
| Exposure modes, `reachesTools`, codemode discovery | **unverified / no equivalent found** | Pi extensions and codemode docs; Claude tool hooks lack this loadout contract |
| Shared in-process named event bus | **unverified** | Pi `EventBus`; Claude event chain is hook middleware, not the same API |
| Nested same-runtime tool execution with transcript omission/usage accounting | yes, different surface | Pi `ctx.executeTool`; Claude `$.tool.call` declarations exist, exact transcript/usage parity is unverified |
| Nested model stream through registry | yes, different surface | Pi `ModelRegistry.streamSimple`; Claude `$.model` APIs include model calls/classification |
| MCP/tool annotations surfaced through `getAllTools` | **unverified** | Pi `ToolInfo`; Claude MCP declarations provide input/result schemas, not this Pi metadata method |
| Branch-scoped entries excluded from model context | **unverified** | Pi `appendEntry` declaration; Claude session APIs differ |
| Provider registration, virtual models, MCP registration | **unverified / no equivalent found** | Pi `ExtensionAPI`; Claude declarations expose MCP tools but not this registration contract |

Claims marked unverified are intentionally not guesses.

# Research Report #1: Tambo SDK Core Architecture vs Jarble DIY UI Rendering

**Researcher**: tambo-core-researcher
**Date**: 2026-03-03
**Status**: Complete

---

## Executive Summary

Tambo is an open-source React toolkit for "generative UI" — it lets AI agents render React components by selecting from a registry and streaming typed props. This report compares Tambo's core architecture (streaming JSON, component registration, Zod schemas, error recovery, MCP integration) against Jarble's current custom-built system.

**Key finding**: Tambo and Jarble solve the same fundamental problem (AI-selected components with streamed props) but from opposite architectural directions. Tambo uses a **tool-call model** (LLM calls functions that map to components), while Jarble uses a **fenced-block model** (LLM emits structured JSON in markdown). This has deep implications for migration.

---

## 1. Streaming JSON: Tambo vs Jarble

### Jarble's Approach: Brace-Depth JSON Parser

Jarble uses a custom brace-depth JSON parser in `jarble-api-main/src/utils/uiBlockParser.ts` (lines 109-136). The parser:

1. Scans for ` ```jarble_ui ` fenced block openings
2. Tracks brace depth and string escaping to find the closing `}`
3. Returns `null` for incomplete blocks (still streaming)
4. Parses complete JSON via `JSON.parse()`
5. Validates structure (`component` string + `props` object)

```typescript
// Jarble: extractJsonFromBlock() — brace-depth parser
function extractJsonFromBlock(text: string, startIndex: number) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (; i < text.length; i++) {
    // ... tracks braces, strings, escapes
    if (ch === "}") {
      depth--;
      if (depth === 0) return { json: text.slice(start, i + 1), endIndex: i + 1 };
    }
  }
  return null; // Incomplete — still streaming
}
```

**Crash prevention strategy**: During SSE streaming, the backend accumulates text. The parser only attempts extraction when it detects a complete JSON object (depth returns to 0). Incomplete blocks are silently skipped. The frontend never sees partial JSON — it only receives fully-parsed `UI_BLOCK_START/PROPS/END` SSE events.

**Strengths**:
- Rock-solid: handles nested backticks in JSON (e.g., code_block with markdown content)
- No crashes from partial JSON — incomplete blocks are simply skipped
- Clear separation: backend parses, frontend renders clean data

**Weaknesses**:
- All-or-nothing: the UI block doesn't appear until the entire JSON is complete
- No progressive rendering — users see nothing until the full props are generated
- Custom code to maintain (though it's only ~140 lines and well-tested)

### Tambo's Approach: Progressive Prop Streaming

Tambo takes a fundamentally different approach: props are streamed **incrementally** to components as the LLM generates them.

```typescript
// Tambo: Component receives props that start undefined and fill in progressively
function RecipeCard({ title, ingredients, prepTime }: Props) {
  // During streaming: title="Pasta C..." (partial), ingredients=undefined, prepTime=undefined
  // After streaming: title="Pasta Carbonara", ingredients=[...], prepTime=30
}
```

The `useTamboStreamStatus()` hook provides granular tracking:

```typescript
const { streamStatus, propStatus } = useTamboStreamStatus();

// Global status: isPending → isStreaming → isSuccess/isError
// Per-prop status: propStatus.title.isStreaming, propStatus.ingredients.isPending
```

**How it works under the hood**:
- Tambo's backend converts component schemas into LLM **tool definitions** (function calls)
- The LLM generates tool call arguments as streamed tokens
- Tambo's backend incrementally parses the streaming JSON using partial JSON parsing
- Each prop value is sent to the React component as soon as it's parseable
- Components must handle `undefined` values for all props during streaming

**Strengths**:
- Progressive rendering: users see the UI building in real-time
- Per-prop status tracking enables sophisticated loading states
- Cancellation, error recovery, and reconnection handled by framework

**Weaknesses**:
- Components MUST handle undefined for every prop (significant development burden)
- No autofix/repair layer — if the LLM generates bad prop values, they go straight to the component
- The streaming JSON parser is opaque (inside Tambo's backend, not customizable)
- More complex failure modes: partial renders can be confusing

### Comparison Matrix: Streaming

| Aspect | Jarble (Current) | Tambo |
|--------|-----------------|-------|
| **Parsing location** | Backend (uiBlockParser.ts) | Tambo backend (opaque) |
| **Parser type** | Brace-depth JSON extractor | Partial JSON streamer (tool calls) |
| **Progressive rendering** | No — all-or-nothing | Yes — props arrive incrementally |
| **Crash prevention** | Skip incomplete blocks | Props start as undefined |
| **Component contract** | Props always complete | Props can be undefined during stream |
| **Custom code** | ~140 lines, well-tested | 0 lines (framework handles it) |
| **Flexibility** | Full control over parsing | Must use Tambo's pipeline |

---

## 2. Component Registration: Tambo vs Jarble

### Jarble's Approach: Manifest + Registry + MCP Server

Jarble has a **three-layer** component registration system:

**Layer 1: Component Manifest** (`shared/component-manifest/index.ts`)
Single source of truth — 37 component entries (+ 1 alias). Each entry defines:
- Name, description, category
- Zod schema for props
- Layout hints (defaultSize, minSize, layoutHint)
- Loading strategy
- Aliases
- Optional splittable config

```typescript
// shared/component-manifest/components/chart.ts
export const chartEntry: ComponentManifestEntry = {
  name: "chart",
  description: "Recharts-based chart with multiple types",
  category: "charts",
  schema: chartSchema,
  layout: { defaultSize: { w: 2, h: 2 }, minSize: { w: 1, h: 1 }, layoutHint: "half" },
  loadingStrategy: "lazy",
  aliases: ["graph", "plot"],
};
```

**Layer 2: Frontend Registry** (`Jarble-mvp/components/canvas/registry.ts`)
Maps component names to React components + Zod schemas. Imports schemas from the manifest, maps to lazy-loaded or static React components:

```typescript
export const CANVAS_COMPONENTS: Record<string, CanvasComponentEntry> = {
  chart: { component: CanvasChart, propsSchema: chartSchema },
  // ... 37 entries
};
```

**Layer 3: MCP Server** (`jarble-api-main/mcp/jarble-ui-server.js`)
Exposes `render_ui`, `list_components`, `component_reference` tools to the LLM. The LLM calls `render_ui` with a component name and props, which gets embedded as a `jarble_ui` fenced block in the response text.

### Tambo's Approach: TamboComponent Array

Tambo has a **single-layer** registration via `TamboProvider`:

```typescript
const components: TamboComponent[] = [
  {
    name: "Graph",
    description: "Displays data as charts (bar, line, pie)",
    component: Graph,
    propsSchema: z.object({
      data: z.array(z.object({ name: z.string(), value: z.number() })),
      type: z.enum(["line", "bar", "pie"]),
    }),
  },
];

<TamboProvider apiKey={KEY} components={components}>
  <ChatInterface />
</TamboProvider>
```

Tambo also supports **dynamic registration** at runtime via `useTambo()`:

```typescript
const { registerComponent } = useTambo();
registerComponent({ name: "NewWidget", ... });
```

### Comparison Matrix: Registration

| Aspect | Jarble (Current) | Tambo |
|--------|-----------------|-------|
| **Layers** | 3 (manifest → registry → MCP) | 1 (TamboComponent array) |
| **Schema location** | Shared package (works in both FE + BE) | Inline with registration |
| **Dynamic registration** | Via custom component definitions (PVC) | `registerComponent()` hook |
| **Layout metadata** | Rich (defaultSize, minSize, layoutHint) | None (no layout system) |
| **Lazy loading** | `next/dynamic` per component | Not mentioned |
| **Aliases** | 30+ name aliases in autoFixProps | None |
| **Categories** | Display, Charts, Interactive, etc. | None |
| **Splittable config** | stat_grid→statistic, etc. | None |

---

## 3. Zod Schema Integration

### Jarble's Approach: Schema → Validate → AutoFix → Render

Jarble's Zod schemas serve as **validation gates** between the LLM output and rendering:

```
LLM output → uiBlockParser → autoFixProps (20 rules, 30+ aliases) → Zod safeParse → render/error card
```

The LLM doesn't directly "know" the Zod schemas. Instead:
1. The MCP server exposes `component_reference` tool with human-readable descriptions derived from schemas
2. The soul.md system prompt contains a component quick reference
3. The LLM generates JSON based on these descriptions
4. `autoFixProps` fixes common mistakes (type coercion, enum normalization, field aliases)
5. Zod `safeParse` validates — success renders, failure shows error card with "Fix" button

```typescript
// CanvasRenderer.tsx — the pipeline
const fixed = autoFixProps(block.component, block.props);  // 20 repair rules
const entry = CANVAS_COMPONENTS[fixed.component];
const result = entry.propsSchema.safeParse(fixed.props);    // Zod validation
if (!result.success) return <ComponentErrorCard ... />;      // Error UI
return <Component {...result.data} />;                       // Render
```

**autoFixProps** is the unique differentiator — 1055 lines of battle-tested repair rules that handle:
- 30+ component name aliases (DataTable → data_table, graph → chart, etc.)
- Type coercion (string→number, string→boolean)
- Enum normalization ("danger" → "destructive", "Line" → "line")
- Missing defaults (alert variant, steps current)
- Structural fixes (unwrap nested props, wrap single→array)
- Field aliases (content→body, description→message)
- Data normalization (chart.js format → recharts format)
- Map coordinate normalization ({lat, lng} → [lat, lng])

### Tambo's Approach: Schema → Tool Definition → LLM → Stream

Tambo's Zod schemas serve a **dual purpose**: they guide LLM generation AND validate output.

1. At registration, Tambo converts Zod schemas to JSON Schema via `zod-to-json-schema`
2. The JSON Schema becomes an LLM **tool/function definition**
3. The LLM generates structured output matching the tool definition
4. Tambo streams parsed values to the component
5. **No intermediate repair layer** — the LLM is expected to get it right

```typescript
// Tambo: Schema guides generation directly
propsSchema: z.object({
  city: z.string().describe("City name, e.g., 'San Francisco'"),
  temperature: z.number(),
})
// → converted to tool definition that the LLM sees directly
```

The `.describe()` method on Zod fields provides hints to the LLM, but there's no autoFix equivalent. If the LLM generates invalid props, the component either crashes or shows undefined values.

### Comparison Matrix: Zod Integration

| Aspect | Jarble (Current) | Tambo |
|--------|-----------------|-------|
| **Schema purpose** | Validation gate | Generation guide + validation |
| **LLM awareness** | Indirect (descriptions in prompt) | Direct (tool definitions) |
| **Error repair** | 20 rules, 30+ aliases (autoFixProps) | None |
| **Schema location** | Shared package (zod v3 BE / v4 FE) | Registration time (zod v3 or v4) |
| **Failed validation** | Error card with "Fix" button | Component sees undefined/crashes |
| **Schema-to-prompt** | Manual (generatePromptReference) | Automatic (zod-to-json-schema) |
| **Field hints** | In soul.md prompt | `.describe()` on schema fields |

---

## 4. Error Recovery

### Jarble's Approach: Multi-Layer Defense

Jarble has **5 layers** of error handling:

1. **Server-side validation** (uiBlockParser.ts): Structure checks, library URL sanitization, size limits
2. **autoFixProps** (autoFixProps.ts): 20 repair rules fix common LLM mistakes before validation
3. **Zod safeParse** (CanvasRenderer.tsx): Validates props, shows error card on failure
4. **Error boundary** (CanvasErrorBoundary): Catches React render errors
5. **Fix rate limiting** (FixAttemptRecord): Limits auto-fix retries to prevent loops

When a component fails, users see an error card with:
- "Fix Component" button (sends error back to LLM for correction)
- "Remove" button (dismisses the card)
- Rate limit indicator (e.g., "2/3" attempts used)

```typescript
// CanvasRenderer.tsx — error card with fix action
<ComponentErrorCard
  componentName={fixed.component}
  error={`Invalid props: ${errorMsg}`}
  blockId={block.id}
  onAction={wrappedOnAction}       // Sends fix request
  fixAttempt={fixAttempt}           // Rate limiting
  onResetFixAttempts={onResetFixAttempts}
/>
```

### Tambo's Approach: Streaming Status + Component Defaults

Tambo's error recovery is more implicit:

1. **StreamStatus tracking**: `isError` flag + `streamError` object
2. **PropStatus tracking**: Per-prop error states
3. **Component-level handling**: Components must provide defaults for undefined props
4. **Framework-level**: "Cancellation, error recovery, and reconnection are handled for you"

There's no equivalent to:
- autoFixProps (no repair layer)
- Error cards with "Fix" button (no user-driven error recovery)
- Fix rate limiting (no retry loop prevention)

### Comparison Matrix: Error Recovery

| Aspect | Jarble (Current) | Tambo |
|--------|-----------------|-------|
| **Layers** | 5 (server → autoFix → Zod → boundary → rate limit) | 2 (stream status → component defaults) |
| **User-driven fix** | "Fix Component" button | Not available |
| **Rate limiting** | Yes (FIX_ATTEMPT_LIMIT) | N/A |
| **Prop repair** | 20 rules (autoFixProps) | None |
| **Error visibility** | Detailed error cards | Stream status flags |
| **Reconnection** | Manual (SSE reconnect) | Automatic (framework) |

---

## 5. MCP Integration

### Jarble's Approach: Custom MCP Server in Pod

Jarble runs a custom MCP stdio server (`jarble-ui-server.js`) inside each bot pod. The server exposes:

- `render_ui` — Render a UI component with specific props
- `define_component` — Define a reusable custom component template
- `list_components` — List all available components with descriptions
- `component_reference` — Get detailed reference for a specific component

The LLM (OpenClaw) calls these MCP tools, and the tool responses are embedded as `jarble_ui` fenced blocks in the conversation text. The backend then parses these blocks via `uiBlockParser.ts`.

```
LLM → MCP tool call (render_ui) → fenced block in text → backend parser → SSE events → frontend render
```

### Tambo's Approach: MCP as Optional External Integration

Tambo treats MCP as an **external data source**, not as the primary UI rendering mechanism:

- MCP servers are configured via dashboard or `TamboProvider` props
- Tools are auto-namespaced: `serverKey__toolName`
- MCP tool results feed into the agent's context
- The agent then decides which registered component to render
- Component rendering is separate from MCP

```typescript
<TamboProvider
  mcpServers={[{
    url: "http://localhost:8123/",
    serverKey: "local",
    transport: MCPTransport.HTTP,
  }]}
>
```

```
MCP tool call → data returned → Tambo agent → selects component → streams props → render
```

### Comparison Matrix: MCP

| Aspect | Jarble (Current) | Tambo |
|--------|-----------------|-------|
| **MCP role** | Primary UI rendering mechanism | Optional data source |
| **MCP server location** | Inside pod (stdio) | External (HTTP/SSE) |
| **Component selection** | LLM selects via MCP tool | Tambo agent selects from registry |
| **Data flow** | MCP → fenced block → parser → SSE | MCP → agent context → component selection |
| **Custom MCP tools** | 4 custom tools | Connect any standard MCP server |

---

## 6. Architecture Diagrams

### Jarble Current Flow
```
User message
  → POST /api/tambo-agent
  → WebSocket to OpenClaw gateway (or kubectl exec fallback)
  → LLM processes with MCP tools (render_ui, etc.)
  → LLM response with ```jarble_ui fenced blocks
  → uiBlockParser.ts extracts blocks (brace-depth JSON parser)
  → SSE events: TEXT_MESSAGE_CONTENT, UI_BLOCK_START/PROPS/END
  → Frontend receives events
  → autoFixProps: 20 rules normalize component name + props
  → Zod safeParse validates
  → CanvasRenderer renders or shows error card
  → SimpleCanvasGrid positions in responsive grid
```

### Tambo Flow
```
User message
  → useTamboThreadInput().submit()
  → Tambo backend (NestJS API)
  → Agent selects component from registry (semantic matching)
  → LLM generates tool call with component props
  → Props stream incrementally to frontend
  → ComponentRenderer renders with partial props
  → useTamboStreamStatus() tracks progress
  → Component handles undefined values during streaming
```

---

## 7. Specific Answers to Research Questions

### Q1: How does Tambo prevent UI crashes during streaming?

Tambo does NOT prevent crashes in the same way Jarble does. Instead:
- **All props start as `undefined`** — components must be designed to handle this
- **PropStatus tracking** — components can check `propStatus.fieldName.isStreaming` to show loading states
- **No equivalent to try/catch in uiBlockParser.ts** — Tambo's parsing happens server-side in the NestJS backend
- **No equivalent to autoFixProps** — there's no repair layer between the LLM and the component

Jarble's approach is actually **more robust** for crash prevention because:
1. Components never receive partial/undefined props (all-or-nothing parsing)
2. autoFixProps fixes common LLM mistakes before Zod validation
3. Zod safeParse provides a clear validation gate
4. Error boundary catches any remaining render errors

### Q2: What does `registerComponent()` look like?

```typescript
// Static registration (most common)
const components: TamboComponent[] = [{
  name: "Graph",
  description: "Displays data as charts",
  component: Graph,
  propsSchema: z.object({
    data: z.array(z.object({ name: z.string(), value: z.number() })),
    type: z.enum(["line", "bar", "pie"]),
  }),
}];

// Passed to provider
<TamboProvider apiKey={KEY} components={components}>

// Dynamic registration
const { registerComponent } = useTambo();
registerComponent({ name: "NewWidget", description: "...", component: NewWidget, propsSchema: z.object({...}) });
```

**Comparison to Jarble**: Jarble's `COMPONENT_MANIFEST` + `registry.ts` is more structured (categories, layout hints, loading strategies, aliases, splittable config) but requires 3 files to add a component. Tambo is simpler (1 registration call) but has no layout metadata.

### Q3: Does Tambo use Zod schemas at registration?

Yes — Zod schemas are converted to JSON Schema via `zod-to-json-schema` and become LLM tool definitions. The LLM "sees" the schema directly, which is fundamentally different from Jarble's approach where the LLM sees human-readable descriptions and a prompt-engineered quick reference.

Tambo supports both Zod v3 (^3.25.76) and Zod v4 (^4, recommended). Jarble has a Zod version split (v3 backend, v4 frontend) which would need to be resolved for Tambo integration.

### Q4: When a bot sends malformed props, what happens?

In Tambo, there's **no autoFixProps equivalent**. If the LLM generates bad props:
1. The component receives the raw (possibly incorrect) values
2. If a prop can't be parsed, it stays `undefined`
3. StreamStatus shows `isError` with `streamError`
4. The component is responsible for handling errors gracefully

This is a **significant gap** compared to Jarble's autoFixProps, which handles 20+ categories of LLM mistakes. Migrating to Tambo would mean either:
- Losing all 1055 lines of battle-tested repair logic
- Building a custom middleware layer between Tambo's streaming and component rendering
- Contributing autoFixProps-like functionality upstream to Tambo

### Q5: Does Tambo have MCP integration?

Yes, but fundamentally differently from Jarble:
- Tambo: MCP servers are **external data sources** — tools provide data, then Tambo's agent selects a component
- Jarble: MCP server IS the UI rendering mechanism — `render_ui` tool directly specifies which component to render

Tambo's MCP is configured via `TamboProvider` props or the dashboard. It auto-namespaces tools and supports rich content responses. But it doesn't have Jarble's `render_ui`/`define_component`/`component_reference` tools because Tambo's agent handles component selection internally.

---

## 8. Risk Assessment for Migration

### What Jarble Would Gain
1. **Progressive prop streaming** — UI builds in real-time instead of appearing all-at-once
2. **Automatic schema-to-tool conversion** — No need to manually maintain MCP tool descriptions
3. **Built-in streaming infrastructure** — Replaces custom SSE event pipeline
4. **Standardized component lifecycle** — Less custom code to maintain
5. **AG-UI event compatibility** — Tambo uses AG-UI events under the hood

### What Jarble Would Lose
1. **autoFixProps** (1055 lines) — 20 repair rules, 30+ name aliases. This is Jarble's secret sauce for handling LLM output variability. Tambo has nothing equivalent.
2. **Error cards with "Fix" button** — User-driven error recovery is a Jarble differentiator
3. **Layout system** — Tambo has no concept of layout hints, grid positioning, split/merge
4. **Custom MCP tools** — render_ui, define_component, component_reference would need replacement
5. **Server-side validation** — Library URL sanitization, block size limits, abuse prevention
6. **Fenced block flexibility** — Support for `jarble_ui_update` and `jarble_ui_define` blocks

### Migration Complexity: HIGH

The systems solve the same problem but with fundamentally incompatible architectures:
- Jarble: **text-embedded blocks** → backend parser → SSE events → frontend render
- Tambo: **tool calls** → backend streaming → progressive props → frontend render

A migration would require rewriting:
- The entire SSE streaming pipeline (tamboAgent.ts)
- All component registrations (manifest → TamboComponent)
- The canvas grid system (Tambo has no layout concept)
- The error recovery system (error cards, fix button, rate limiting)
- The MCP server (replace render_ui with Tambo's component selection)
- Component implementations (add undefined-prop handling for streaming)

---

## Sources

- [Tambo GitHub Repository](https://github.com/tambo-ai/tambo)
- [Tambo Docs: Register Components](https://docs.tambo.co/guides/enable-generative-ui/register-components)
- [Tambo Docs: Generative Components](https://docs.tambo.co/concepts/generative-interfaces/generative-components)
- [Tambo Docs: Interactable Components](https://docs.tambo.co/concepts/generative-interfaces/interactable-components)
- [Tambo Docs: MCP Integration](https://docs.tambo.co/concepts/model-context-protocol)
- [Tambo Docs: React SDK Migration](https://docs.tambo.co/reference/react-sdk/migration)
- [Tambo Docs: Self-Hosting](https://docs.tambo.co/guides/self-hosting)
- [Tambo Docs: Kubernetes](https://docs.tambo.co/guides/self-hosting/kubernetes)
- [Tambo Cloud GitHub](https://github.com/tambo-ai/tambo-cloud)
- [Tambo 1.0 Hacker News Discussion](https://news.ycombinator.com/item?id=46966182)
- [@tambo-ai/react NPM](https://www.npmjs.com/package/@tambo-ai/react)
- [Tambo Legacy Types Reference](https://docs.tambo.co/reference/react-sdk-legacy/types)

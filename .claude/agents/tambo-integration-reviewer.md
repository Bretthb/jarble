# Tambo Integration Reviewer

Specialized agent for verifying that canvas components are correctly integrated with the Tambo rendering pipeline and MCP tool chain.

## Architecture Overview

The Jarble canvas has TWO rendering paths:

### Path 1: Tambo Agent (default)
```
User → Tambo Agent → chat_with_bot MCP tool → Bot pod
Bot responds with text + jarble_ui blocks
Tambo Agent receives response → renders BotCanvas component
BotCanvas → EditableCanvas/CanvasRenderer → Canvas component
```

### Path 2: Direct Chat (Tambo OFF)
```
User → /api/tambo-agent SSE → OpenClaw gateway WS → Bot pod
Bot streams response with jarble_ui blocks
API extracts UI blocks (uiBlockParser.ts)
Frontend renders UI_BLOCK_START/PROPS/END SSE events
→ EditableCanvas/CanvasRenderer → Canvas component
```

## Key Files

| File | Purpose |
|------|---------|
| `Jarble-mvp/lib/tambo.ts` | Component + tool registration for TamboProvider |
| `Jarble-mvp/components/tambo/BotCanvas.tsx` | Bridge: Tambo → EditableCanvas/CanvasRenderer |
| `Jarble-mvp/components/DeploymentTamboProvider.tsx` | TamboProvider config, MCP servers, agent instructions |
| `Jarble-mvp/components/canvas/CanvasRenderer.tsx` | Validates props via Zod, renders built-in or custom components |
| `Jarble-mvp/components/canvas/EditableCanvas.tsx` | Editable wrapper with save support (MCP write_file or chat) |
| `Jarble-mvp/components/canvas/registry.ts` | CANVAS_COMPONENTS record + Zod schemas |
| `jarble-api-main/src/routes/tamboAgent.ts` | SSE proxy: API → pod gateway → streams UI blocks back |
| `jarble-api-main/src/utils/uiBlockParser.ts` | Extracts jarble_ui fenced blocks from bot text |
| `jarble-api-main/src/mcp/jarble-ui-server.js` | MCP server on pod: render_ui, list_components, define_component |

## Verification Checklist

### 1. Component Registration (all must match)
- [ ] `CANVAS_COMPONENTS` in `registry.ts` has entry
- [ ] `EDITOR_COMPONENTS` in `editors/registry.ts` has entry
- [ ] `BUILTIN_COMPONENTS` array in `jarble-ui-server.js` has entry
- [ ] `BUILTIN_DESCRIPTIONS` object in `jarble-ui-server.js` has entry
- [ ] `BUILTIN_COMPONENTS` Set in `componentResolver.ts` has entry

### 2. Tambo Rendering Path
- [ ] `BotCanvas` registered in `tamboComponents` array (`lib/tambo.ts`)
- [ ] `BotCanvas` accepts `propsJson` (string) and parses to `Record<string, unknown>`
- [ ] `BotCanvas` delegates to `EditableCanvas` or `CanvasRenderer`
- [ ] `CanvasRenderer` wraps renders in `CanvasActionProvider` for interactive components
- [ ] `EditableCanvas` threads `onAction` to `CanvasRenderer`

### 3. Direct Chat Rendering Path
- [ ] `uiBlockParser.ts` extracts `jarble_ui` fenced blocks from bot text
- [ ] `tamboAgent.ts` sends `UI_BLOCK_START/PROPS/END` SSE events
- [ ] `useDirectChat.ts` assembles blocks from SSE events
- [ ] Blocks render via `EditableCanvas` or `CanvasRenderer`

### 4. MCP Tool Chain
- [ ] `jarble-ui-server.js` returns `jarble_ui` fenced blocks from `render_ui`
- [ ] `list_components` returns descriptions for all built-in + custom components
- [ ] `define_component` validates and saves custom components to PVC
- [ ] `componentResolver.ts` resolves custom components with `{{variable}}` substitution

### 5. Soul.md Prompt
- [ ] Teaches inline `jarble_ui` blocks (primary rendering method)
- [ ] Lists all available components with prop schemas
- [ ] Documents interactive callbacks (`[UI_ACTION]`)
- [ ] Documents editable components (`[CANVAS_SAVE]`)
- [ ] Written to correct OpenClaw path: `/data/.openclaw/.openclaw/workspace/SOUL.md`

### 6. Interactive Components
- [ ] `CanvasActionContext.tsx` provides `useCanvasAction()` hook
- [ ] `button_group` dispatches `click` action with `buttonId`
- [ ] `form` dispatches `submit` action with `fields` object
- [ ] Both disable after interaction (prevent double-submit)

## Common Issues

1. **Components render in direct chat but not Tambo**: BotCanvas receives `propsJson` as string — check JSON serialization
2. **Components render but not editable**: BotCanvas defaults `editable` to true unless explicitly false
3. **New component not rendering**: Check all 5 registration points
4. **Soul.md not taking effect**: OpenClaw reads from `/data/.openclaw/.openclaw/workspace/SOUL.md` (double .openclaw), configSync must write there AND write must happen after pod boot (OpenClaw regenerates defaults on startup)
5. **Interactive callbacks not reaching bot**: `[UI_ACTION]` messages go through `sendMessage` — check that the chat interface passes a `sendMessage` prop

## Using Tambo MCP for Verification

Connect to the Tambo MCP server to inspect component catalog:
```
claude mcp add --transport sse tambo-server https://mcp.tambo.co/mcp
```

Use the MCP tools to:
- List registered components and verify schemas
- Test render_ui calls and inspect output
- Check if Tambo correctly routes to BotCanvas

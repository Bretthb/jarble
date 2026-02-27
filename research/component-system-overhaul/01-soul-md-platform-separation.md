# Report 1: Soul.md Platform Separation Strategy

**Agent**: soul-md-strategist
**Status**: COMPLETE

## Key Findings

### Current System
- OpenClaw serves ALL platforms (Telegram, Discord, WhatsApp, Slack, AND Jarble web) with the SAME system prompt
- No built-in platform detection: OpenClaw can't tell which platform a message came from at inference time
- `[CANVAS_STATE]` is the only signal: The web dashboard injects this marker; the prompt uses it as a heuristic to detect "I'm on dashboard"

### The Problem
- Jarble web chat: Works great — bot sees `[CANVAS_STATE]` and renders UI components
- Telegram/Discord/WhatsApp/Slack: Bot still receives 1.2k tokens of UI rendering instructions, but can't use them (no MCP server, no canvas)
- Fragile heuristic: If a Telegram user's message contains `[CANVAS_STATE]` text, bot might hallucinate UI blocks

### How Chat Works
```
Web Dashboard:  [CANVAS_STATE] injected → sessionKey = "jarble-web-{userId}"
                → chatViaGateway() to pod → bot sees markers → outputs jarble_ui blocks
                → API parses blocks → frontend renders as moveable cards

Telegram:       No markers injected → bot should output plain text only
                → But prompt still teaches UI components (wasted tokens)
                → Heuristic could fail if message contains [CANVAS_STATE] text
```

### Soul.md Content Breakdown
- **Total**: ~1,500 tokens
- **UI-specific**: ~1,250 tokens (83%) — component reference, fenced block syntax, design patterns
- **Platform-agnostic**: ~250 tokens (17%) — real data policy, memory tools, conversation guidance

### MCP Tools Availability
- NOT available in pod directly: The MCP server (jarble-ui-server.js) runs on the API side via kubectl exec
- Bot can't call tools directly: No live stdio connection; bot must output jarble_ui fenced blocks instead
- Works for UI definition: Bot can output `jarble_ui_define` blocks; API parses and saves them

## Recommended Options (Low→High Effort)

**Option 1 (Recommended — Medium-term)**: Extend `[CANVAS_STATE]` blocks to Telegram/Discord/etc with a `Platform:` field. Make heuristic explicit. No OpenClaw changes needed.

**Option 2 (Long-term)**: Coordinate with OpenClaw upstream to support per-channel soul files (separate soul.md for web vs messaging platforms). Requires OpenClaw API changes.

**Option 3 (Quick win)**: Tune JARBLE_UI_PROMPT to be more explicit about the heuristic and more resistant to hallucination. Test with real Telegram/Discord deployments.

## Key Files
- `jarble-api-main/src/runtimes/handlers/openclaw.ts` — JARBLE_UI_PROMPT constant
- `jarble-api-main/src/services/configSync.ts` — soul.md deployment pipeline
- `jarble-api-main/src/mcp/jarble-ui-server.js` — MCP server
- `jarble-api-main/src/routes/tamboAgent.ts` — chat proxy with [CANVAS_STATE] injection

# Soul.md Platform Separation Audit

**Date**: Feb 27, 2026
**Task**: Understand current system and identify platform-aware prompting options

## Executive Summary

**Current Problem**: The soul.md system prompt (containing JARBLE_UI_PROMPT) is injected into OpenClaw's core system prompt and **shipped to ALL platforms** (Telegram, Discord, WhatsApp, Slack, AND Jarble web chat). This means:

- ✅ When users chat on the **Jarble web dashboard** (`/d/[id]`), the bot DOES see `[CANVAS_STATE]` markers and CAN render UI components
- ❌ When users chat on **Telegram/Discord/WhatsApp/Slack**, the bot still receives the full UI rendering instructions but has NO WAY to use them (no MCP server, no canvas)
- ⚠️ The prompt explicitly says "detect platform and respond accordingly" but **OpenClaw has no built-in platform detection mechanism** — so the bot relies on heuristics

---

## End-to-End Chat Flow

### Web Dashboard (`/d/[id]`)
```
User message
  ↓
[frontend] useCanvasChat sends:
  - [CANVAS_STATE] marker with current canvas cards
  - [EDITING card_id "title"] if a card is selected
  - User text
  ↓
[API] POST /api/tambo-agent (tamboAgent.ts)
  - Extracts deploymentId
  - Calls chatViaGateway() or chatViaExec()
  ↓
[Pod] OpenClaw processes message:
  - Reads soul.md (includes JARBLE_UI_PROMPT)
  - Sees [CANVAS_STATE] marker → infers "I'm on dashboard"
  - Generates response with jarble_ui blocks
  ↓
[API] Parses response:
  - extractAllUIBlocks() pulls jarble_ui blocks from text
  - Renders blocks as SSE events to frontend
  ↓
[Frontend] StreamingBotMessage + SimpleCanvasGrid:
  - Receives SSE UI_BLOCK_START/PROPS/END events
  - Renders as moveable cards on canvas
```

### Telegram/Discord/WhatsApp/Slack
```
User sends message on Telegram (e.g.)
  ↓
[Pod] OpenClaw receives message via Telegram bot handler
  - No [CANVAS_STATE] marker (not sent by these platforms)
  - Reads soul.md (includes JARBLE_UI_PROMPT)
  - Prompt says "detect platform" but OpenClaw has NO API to know the channel
  ↓
[Pod] Bot generates response:
  - Sees no [CANVAS_STATE] → assumes "NOT dashboard"
  - Should output plain text only
  - BUT: if the prompt is poorly tuned, bot might still output jarble_ui blocks
  ↓
[Telegram] Receives bot response:
  - No UI rendering capability
  - jarble_ui blocks appear as garbage in the chat
```

---

## Platform Detection: How It Currently Works (Poorly)

### What the Bot Has:
1. **JARBLE_UI_PROMPT heuristic** (openclaw.ts:56-170):
   ```markdown
   Detect your platform and respond accordingly:
   - **Jarble web dashboard**: Messages contain `[CANVAS_STATE]` or `[UI_ACTION]`
   - **Other platforms**: Use plain text/markdown only
   If no [CANVAS_STATE] is present, assume you are NOT on the dashboard.
   ```

2. **sessionKey** (tamboAgent.ts:278):
   ```ts
   const sessionKey = `jarble-web-${authenticatedUserId || "anon"}`;
   ```
   - Only for web dashboard
   - Passed to OpenClaw but OpenClaw can't inspect it (doesn't have routing context)

### What the Bot DOESN'T Have:
- ❌ No `channel` or `platform` parameter in the `chat.send` request (openclawGateway.ts:231-235)
- ❌ No way to query "which platform am I running on?" at inference time
- ❌ No metadata about the incoming message source (Telegram vs Discord vs Web)
- ❌ No runtime platform detection API in OpenClaw

### Result:
The bot can ONLY detect the platform by looking for `[CANVAS_STATE]` markers in the user message. This is fragile:
- ✅ Works for Jarble web (markers always present)
- ❌ Breaks if Telegram user message happens to contain `[CANVAS_STATE]` text
- ❌ Breaks if bot hallucinates and outputs UI blocks on Telegram anyway

---

## MCP Tools: Available Only on Web Dashboard

The MCP server (`jarble-ui-server.js`) is invoked via kubectl exec on the **API side** — NOT as a live stdio server connected to OpenClaw.

Flow:
```
[Frontend] User clicks "Define component" in UI
  ↓
[API] canvasFiles endpoint (invoke MCP server)
  → kubectl exec pod -- node /data/config/mcp/jarble-ui-server.js
  ↓
[Pod] MCP server runs in stdio mode, returns tool response
  ↓
[API] HTTP endpoint returns JSON response to frontend
```

**Critical**: The MCP server is **NOT available to OpenClaw** during chat. The bot can't call `render_ui`, `define_component`, etc. as tools. The JARBLE_UI_PROMPT tells the bot to OUTPUT jarble_ui fenced blocks instead.

---

## Soul.md Content Breakdown

**Size**: ~1.5k tokens (fits well in system prompt)

**Sections**:
1. **Platform Awareness** (lines 56-60): Heuristic detection of dashboard via `[CANVAS_STATE]`
2. **Real Data Policy** (lines 62-67): Use browser tool for live data, not fabricated
3. **Jarble UI Instructions** (lines 69-170): 56+ components, design principles, fenced block syntax
4. **Quick Reference** (lines 123-148): Compact component descriptions + prop schemas

**UI-Specific Content**: ~80% of soul.md is UI rendering instructions (components, design patterns, examples)

**General/Platform-Agnostic**: ~20% (real data policy, memory tools, general conversational guidance)

---

## Options for Platform-Aware Prompting

### Option 1: Extend `chat.send` Request (RECOMMENDED — Minimal)
**In openclawGateway.ts line 231-235:**
```ts
// Current:
sendRequest("chat.send", {
  sessionKey,
  message,
  deliver: false,
  idempotencyKey,
});

// Enhanced:
sendRequest("chat.send", {
  sessionKey,
  message,
  deliver: false,
  idempotencyKey,
  platform: "jarble-web",  // ← Add this
  // or:
  metadata: { platform: "jarble-web" },
});
```

**Requirements**:
- OpenClaw must support this parameter (may require upstream changes or version check)
- Bot would use it as: "If metadata.platform == 'jarble-web', use UI components; else plain text"

**Pros**: Explicit, reliable, future-proof
**Cons**: Requires OpenClaw integration

---

### Option 2: Inject Platform Signal into `[CANVAS_STATE]` Block (CURRENT + RELIABLE)
**Already working on web dashboard.** Could extend this for other scenarios:

On Telegram/Discord/etc, the API could inject:
```
[CANVAS_STATE]
Platform: telegram
No cards on canvas.
[/CANVAS_STATE]
```

Then remove JARBLE_UI_PROMPT logic that says "if no [CANVAS_STATE], assume not dashboard" and instead parse the Platform field.

**Pros**: No OpenClaw changes needed, works today
**Cons**: Bloats every message on non-web platforms with unused markers

---

### Option 3: Create Two Soul Files (Platform-Specific)
**In configSync.ts:**
```ts
// soul.md — deployed to OpenClaw, includes UI instructions
// soul-web.md — deployed separately, bot loads based on channel

renderConfigs() {
  const soulWeb = soulPrompt + JARBLE_UI_PROMPT;  // Full UI instructions
  const soulOther = soulPrompt;  // No UI instructions

  // Write both, OpenClaw loads based on channel context
  files.push({ path: "/data/.openclaw/workspace/SOUL.md", content: soulWeb });
  files.push({ path: "/data/.openclaw/workspace/SOUL_TELEGRAM.md", content: soulOther });
}
```

Then openclaw.json specifies:
```json
{
  "channels": {
    "telegram": { "soulFile": "SOUL_TELEGRAM.md" },
    "discord": { "soulFile": "SOUL_TELEGRAM.md" },
    "whatsapp": { "soulFile": "SOUL_TELEGRAM.md" },
    "jarble_web": { "soulFile": "SOUL.md" }
  }
}
```

**Pros**: Complete separation, clearest intent
**Cons**: Requires OpenClaw support for per-channel soul files (may not exist)

---

### Option 4: Conditional Blocks in Soul.md (FRAGILE)
**Current approach with better tuning:**
```markdown
IF you see [CANVAS_STATE] in the message:
  - You are on the Jarble web dashboard
  - Output jarble_ui components
ELSE:
  - You are on Telegram/Discord/etc
  - Output ONLY plain text/markdown
  - NEVER mention jarble_ui or components
```

Then tune JARBLE_UI_PROMPT to be more explicit about the heuristic.

**Pros**: Works today, no infrastructure changes
**Cons**: LLMs sometimes hallucinate; fragile heuristic can fail

---

## How Much of Soul.md is UI-Specific?

**Rough breakdown** (by lines in openclaw.ts):

| Section | Lines | Tokens | Purpose | Platform-Agnostic? |
|---------|-------|--------|---------|-------------------|
| Platform Awareness | 56-60 | ~50 | Detect dashboard | ❌ UI-specific |
| Real Data Policy | 62-67 | ~80 | Use browser tool | ✅ Yes |
| UI Intro | 69-97 | ~400 | jarble_ui syntax | ❌ Web only |
| Component Quick Ref | 123-148 | ~800 | 24 components | ❌ Web only |
| Browser Tool | 159-160 | ~50 | Use live data | ✅ Yes |
| Long-Term Memory | 162-170 | ~100 | MCP memory tools | ✅ Yes (on all platforms) |

**UI-specific content**: ~1,250 tokens (~83% of total)
**Platform-agnostic**: ~250 tokens (~17% of total)

**Implication**: A platform-specific soul file would cut the "telegram/discord/etc" prompt by ~83%, saving tokens and reducing hallucination risk.

---

## Recommended Next Steps

1. **Short-term (low-risk)**: Tune JARBLE_UI_PROMPT to be more explicit that non-dashboard platforms must NOT output jarble_ui blocks. Test across Telegram/Discord to verify bot behavior.

2. **Medium-term (moderate-risk)**: Implement Option 2 — extend `[CANVAS_STATE]` blocks to non-web platforms with a Platform field, so heuristic is more reliable.

3. **Long-term (high-impact)**: Investigate Option 1 or Option 3 — coordinate with OpenClaw upstream to support platform-aware system prompts or per-channel soul files. This would enable clean separation and reduce token waste.

4. **Monitoring**: Add logging to track when bot outputs jarble_ui blocks on non-web platforms. Use this to validate that tuning is working.

---

## Key Insights

1. **OpenClaw is platform-agnostic**: It serves Telegram, Discord, WhatsApp, Slack, AND Jarble web with the SAME system prompt. There's no built-in way for the bot to know which platform a message came from.

2. **`[CANVAS_STATE]` is the only platform signal**: The web dashboard injects this marker, and the prompt relies on it to detect "I'm on the web." This is working but fragile.

3. **MCP tools are web-only**: The UI MCP server is invoked via HTTP endpoints, not as a live stdio process in the pod. The bot can't call tools; it must output fenced blocks.

4. **Prompt bloat**: The JARBLE_UI_PROMPT is 1.2k tokens, 80%+ of which is useless on Telegram/Discord/etc. This wastes context and increases hallucination risk.

5. **The heuristic can fail**: If a Telegram user's message contains `[CANVAS_STATE]` text (e.g. copy-pasted from docs), the bot might hallucinate UI components.

---

## Links & References

- **openclaw.ts** (lines 56-170): JARBLE_UI_PROMPT definition
- **configSync.ts** (lines 196-212): Where soul.md is rendered and deployed
- **tamboAgent.ts** (lines 278, 231-235): Where sessionKey is set and chat.send is called
- **openclawGateway.ts** (lines 93-240): WebSocket chat client to pod gateway
- **useCanvasChat.ts** (lines 175-189): Where `[CANVAS_STATE]` is injected on web


# Chat-First Architecture — Pod Proxy + Management Action Buttons

> Implemented on `k8-debug` branch, Feb 21 2026

## What This Is

Chat goes straight to the OpenClaw bot running in the pod. Management happens via explicit UI buttons that invoke tools directly — no LLM tax on either path.

```
Chat "hello"      → POST /api/tambo-agent → WebSocket to pod gateway → bot responds → SSE text
[Status] button   → POST /api/tools/invoke { tool: "get_deployment_info" } → SSE tool component
[Platforms] button → POST /api/tools/invoke { tool: "get_platforms" }      → SSE tool component
[Restart] button  → POST /api/tools/invoke { tool: "restart_bot" }        → SSE tool component
```

---

## Files Changed / Created

### Created
| File | Purpose |
|------|---------|
| `jarble-api-main/src/routes/toolInvoke.ts` | Direct MCP tool execution endpoint (no LLM) |
| `jarble-api-main/src/services/openclawGateway.ts` | WebSocket client for OpenClaw gateway protocol |

### Modified
| File | Change |
|------|--------|
| `jarble-api-main/src/routes/tamboAgent.ts` | Stripped MCP agent loop → pod WebSocket proxy |
| `jarble-api-main/src/services/agentMock.ts` | Changed from management responses to bot conversation simulation |
| `jarble-api-main/src/index.ts` | Mounted `/api/tools` route |
| `jarble-api-main/src/k8s/deployment.ts` | `getPodAddress` no longer requires gateway token (allows empty) |
| `Jarble-mvp/hooks/useAgentChat.ts` | Added `invokeTool()`, extracted shared `parseSSEStream()` |
| `Jarble-mvp/app/d/[id]/page.tsx` | Added 7 action pill buttons, updated greeting message |

### Unchanged
| File | Why |
|------|-----|
| `jarble-api-main/src/mcp/toolRegistry.ts` | Reused by toolInvoke.ts as-is |
| `jarble-api-main/src/mcp/tools/*.ts` | All 15 tools reused as-is |
| `jarble-api-main/src/services/llmProxy.ts` | `collectLlmCompletion` stays (unused, may reuse later) |
| `Jarble-mvp/components/tambo/loaders.tsx` | `TOOL_COMPONENTS` map unchanged |

---

## Backend

### Chat Endpoint — `POST /api/tambo-agent`

Proxies user messages to the OpenClaw bot running inside the K8s pod.

**Flow (real cluster):**
1. Verify Auth0 JWT (or `X-Agent-Secret`)
2. Extract `deploymentId` from body
3. Load deployment from DB, verify ownership
4. Check deployment status is `"running"`
5. Call `getPodAddress(deploymentId)` → `{ ip, port, gatewayToken }`
6. Open WebSocket to `ws://{ip}:{port}` (OpenClaw gateway)
7. Authenticate via `connect` protocol with gateway token
8. Send `chat.send` with user message and session key
9. Stream `delta` events back as SSE `TEXT_MESSAGE_CONTENT` chunks
10. Close on `final` event

**Flow (mock mode — `MOCK_K8S=true`):**
- Calls `streamMockAgent()` which returns canned bot conversation responses with simulated typing delay

**Request:**
```json
{
  "deploymentId": "40scrjllu40s",
  "messages": [{ "role": "user", "content": "hello" }]
}
```

**SSE Response:**
```
data: {"type":"RUN_STARTED","runId":"...","threadId":"..."}
data: {"type":"TEXT_MESSAGE_START","messageId":"...","role":"assistant"}
data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"...","delta":"Hey"}
data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"...","delta":" there!"}
data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"...","delta":" I'm test2."}
data: {"type":"TEXT_MESSAGE_END","messageId":"..."}
data: {"type":"RUN_FINISHED","runId":"...","threadId":"..."}
```

### Tool Invoke Endpoint — `POST /api/tools/invoke`

Executes an MCP tool directly — no LLM involved.

**Auth:** Bearer JWT only (stricter than chat endpoint).

**Request:**
```json
{
  "deploymentId": "40scrjllu40s",
  "tool": "get_deployment_info",
  "params": {}
}
```

**Response:** Same SSE format. If tool has `rendersComponent`, emits `TOOL_CALL_*` events that the frontend renders as UI cards. Also emits `TEXT_MESSAGE_*` with the tool's text summary.

**Available tools:**
| Tool Name | Renders Component | Action Button |
|-----------|-------------------|---------------|
| `get_deployment_info` | `show_status` | Status |
| `get_platforms` | `show_platforms` | Platforms |
| `get_logs` | `show_logs` | Logs |
| `update_system_prompt` | `show_system_prompt` | Prompt |
| `update_llm_config` | `show_llm_config` | LLM |
| `list_skills` | `show_skills` | Skills |
| `restart_bot` | `confirm_action` | Restart |
| `connect_platform` | — | (from within PlatformSetup) |
| `disconnect_platform` | — | (from within PlatformSetup) |
| `install_skill` | — | (from within SkillsPanel) |
| `uninstall_skill` | — | (from within SkillsPanel) |
| `stop_bot` | `confirm_action` | — |
| `start_bot` | `confirm_action` | — |
| `get_whatsapp_qr` | — | — |
| `chat_with_bot` | — | — |

### OpenClaw Gateway Client — `openclawGateway.ts`

WebSocket client that speaks the OpenClaw gateway's JSON-RPC protocol.

**Protocol:**
1. **WS connect** → server sends `connect.challenge` event with nonce
2. **Client authenticates:**
   ```json
   {
     "type": "req", "id": "xxx", "method": "connect",
     "params": {
       "minProtocol": 3, "maxProtocol": 3,
       "client": { "id": "jarble-api", "version": "1.0", "platform": "server", "mode": "webchat" },
       "role": "operator", "scopes": ["operator.admin"],
       "auth": { "token": "<gatewayToken>" }
     }
   }
   ```
3. **Send message:**
   ```json
   {
     "type": "req", "id": "yyy", "method": "chat.send",
     "params": { "sessionKey": "jarble-web-userId", "message": "hello", "deliver": false }
   }
   ```
4. **Receive deltas:** Events with `state: "delta"` contain full accumulated text
5. **Done:** Event with `state: "final"` signals completion

**Key details:**
- 45-second timeout
- Supports `AbortSignal` for client disconnect cleanup
- `onDelta` callback called with full text so far (tamboAgent computes incremental diff for SSE)
- Handles empty gateway token (no auth sent if token is empty)
- Session keys maintain conversation continuity per user

### `getPodAddress` Change

Previously returned `null` if `OPENCLAW_GATEWAY_TOKEN` was missing from the K8s secret. Now returns with empty string token, since many deployments don't have the token set and the gateway accepts unauthenticated connections in that case.

---

## Frontend

### `useAgentChat` Hook

```typescript
const { messages, isStreaming, isConnecting, sendMessage, invokeTool } = useAgentChat(deploymentId);
```

**`sendMessage(text)`** — POSTs to `/api/tambo-agent` with full message history. Parses SSE stream.

**`invokeTool(tool, params?)`** — POSTs to `/api/tools/invoke`. Same SSE parsing. Creates an assistant message placeholder that collects text and tool call components.

**Shared `parseSSEStream()`** — Extracted into standalone function. Handles all SSE event types, accumulates text deltas, collects tool call events into `ChatMessage.toolCalls[]`.

### Chat Page — `/d/[id]`

**Layout:**
```
┌─────────────────────────────────────┐
│  ← Bot Name   [running]   [avatar] │  ← header
├─────────────────────────────────────┤
│                                     │
│  [bot] Hi! I'm test2. Type a       │  ← greeting
│        message to chat, or use      │
│        the buttons below.           │
│                                     │
│                  [user] hello  →     │  ← user msg
│                                     │
│  [bot] Hey there! I'm test2.       │  ← bot response
│        How can I help you?          │
│                                     │
│  [bot] ┌─────────────────────┐     │  ← tool component
│        │ StatusCard           │     │
│        │ Name: test2          │     │
│        │ Status: running      │     │
│        └─────────────────────┘     │
│                                     │
├─────────────────────────────────────┤
│ [Status][Platforms][Logs][Prompt]... │  ← action buttons
│ [Type a message...          ] [→]   │  ← input
└─────────────────────────────────────┘
```

**Action buttons:** Scrollable row of pill buttons above the input. Each calls `invokeTool(toolName)`. Disabled while streaming.

| Button | Icon | Tool |
|--------|------|------|
| Status | Activity | `get_deployment_info` |
| Platforms | Plug | `get_platforms` |
| Logs | FileText | `get_logs` |
| Prompt | Brain | `update_system_prompt` |
| LLM | Cpu | `update_llm_config` |
| Skills | Puzzle | `list_skills` |
| Restart | RotateCw | `restart_bot` |

**Tool components** rendered inline in chat via `TOOL_COMPONENTS` map (defined in `loaders.tsx`). Each loader fetches fresh data from tRPC before rendering.

---

## Running Locally

### Mock Mode (no K8s needed)
```bash
# Terminal 1 — API
cd jarble-api-main
MOCK_K8S=true USE_SQLITE=true npx tsx src/index.ts

# Terminal 2 — Frontend
cd Jarble-mvp
npm run dev

# Chat at http://localhost:3000/d/{deploymentId}
# Bot gives canned responses. Action buttons invoke real tools against SQLite.
```

### Real K8s (with port-forward)
```bash
# Terminal 1 — Port-forward to running pod
kubectl port-forward -n jarble dep-{DEPLOYMENT_ID}-xxx 18790:18789

# Terminal 2 — API (no MOCK_K8S)
cd jarble-api-main
USE_SQLITE=true POD_PROXY_URL=http://localhost:18790 npx tsx src/index.ts

# Terminal 3 — Frontend
cd Jarble-mvp
npm run dev

# Chat at http://localhost:3000/d/{deploymentId}
# Bot responses come from actual OpenClaw instance in the pod.
```

### Verified Working (Feb 21 2026)
```
$ curl -N -X POST http://localhost:3001/api/tambo-agent \
    -H "X-Agent-Secret: ..." \
    -d '{"deploymentId":"40scrjllu40s","messages":[{"role":"user","content":"hello, who are you?"}]}'

data: {"type":"TEXT_MESSAGE_CONTENT","delta":"Hey"}
data: {"type":"TEXT_MESSAGE_CONTENT","delta":" there!"}
data: {"type":"TEXT_MESSAGE_CONTENT","delta":" I'm"}
data: {"type":"TEXT_MESSAGE_CONTENT","delta":" test2."}
data: {"type":"TEXT_MESSAGE_CONTENT","delta":" How"}
data: {"type":"TEXT_MESSAGE_CONTENT","delta":" can"}
data: {"type":"TEXT_MESSAGE_CONTENT","delta":" I"}
data: {"type":"TEXT_MESSAGE_CONTENT","delta":" help"}
data: {"type":"TEXT_MESSAGE_CONTENT","delta":" you"}
data: {"type":"TEXT_MESSAGE_CONTENT","delta":" today?"}
```

---

## What Was Removed

The old MCP agent loop in `tamboAgent.ts` that:
- Called `collectLlmCompletion()` with Jarble's own LLM key
- Ran a multi-turn tool calling loop (up to 5 turns)
- Had the LLM decide when to use tools vs respond with text
- Required `AGENT_LLM_API_KEY`, `AGENT_LLM_PROVIDER`, `AGENT_LLM_MODEL` env vars
- Imported `buildSystemPrompt`, `convertMessages`, `mcpRegistry`, `MAX_TOOL_TURNS`

This is gone because every chat message was paying for 2 LLM calls (management agent + bot), adding latency and cost. Now chat is direct (0 LLM calls from Jarble's side — only the bot's own LLM call inside the pod) and management is instant (direct tool execution, no LLM needed).

---

## Known Limitations

1. **Port-forward required on Windows** — The Jarble API running on Windows can't reach K8s pod IPs directly inside k3d. Requires `kubectl port-forward` + `POD_PROXY_URL` env var.

2. **One pod at a time** — `POD_PROXY_URL` points to a single pod. If testing with multiple deployments, need separate port-forwards on different local ports. Production uses pod IPs directly (no proxy needed).

3. **Gateway token not set on older deployments** — `getPodAddress` now works without the token, but gateway auth is skipped. New deployments should include `OPENCLAW_GATEWAY_TOKEN` in the K8s secret.

4. **Mock mode = fake bot** — In `MOCK_K8S=true`, chat returns canned responses, not real bot output. This is expected since there's no pod to connect to.

5. **Session key per user, not per conversation** — The gateway session key is `jarble-web-{userId}`, so all conversations with the same bot share context. Could be made per-thread if needed.

6. **No conversation history sent to gateway** — Each `chat.send` is a single message. The OpenClaw gateway maintains its own conversation state via the session key. Frontend message history is for display only.

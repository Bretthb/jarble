# Tambo + OpenClaw MCP Integration Design

**Date:** 2026-02-22
**Status:** Approved
**Implementation:** [2026-02-22-tambo-openclaw-mcp-integration.md](./2026-02-22-tambo-openclaw-mcp-integration.md)

> **Implementation Note:** During planning, we discovered 18 MCP-inspired tools already exist in `jarble-api-main/src/mcp/tools/` with a custom `McpTool` interface. These tools require DB access, K8s API, and configSync — so they must run in the API, not inside the pod. The implementation wraps these existing tools into a real MCP server using `@modelcontextprotocol/sdk`, exposed at `/api/mcp/:deploymentId`. From Tambo's perspective, the result is identical to the "Pod MCP Server" design — tools are discovered automatically via MCP. Pod-side MCP can be added later for tools that benefit from running closer to the runtime.
**Goal:** Make Tambo the "monitor" for the OpenClaw "desktop" — full visibility and control over the bot runtime via MCP.

## Architecture

```
Browser (Tambo)          Jarble API              OpenClaw Pod
+-----------------+    +------------------+    +-------------------+
| TamboProvider   |    | /api/mcp/:id     |    | MCP Server        |
| mcpServers=[{   |--->| SSE proxy        |--->| HTTP+SSE :18790   |
|   SSE transport |    | + Auth (JWT)     |    |                   |
| }]              |    | + Pod routing    |    | Wraps:            |
|                 |    | + Connection mgmt|    | - WS Gateway :18789|
| Infra tools     |    |                  |    | - stdio MCP (UI)  |
| (start/stop/    |    |                  |    | - PVC filesystem  |
|  restart/delete)|    |                  |    | - OpenClaw CLI    |
+-----------------+    +------------------+    +-------------------+
```

- **Browser to API:** SSE (Tambo's `MCPTransport.SSE`)
- **API to Pod:** Direct HTTP to pod IP:18790 (internal K8s networking)
- **Infrastructure tools** remain as Tambo `defineTool()` (bot can't control its own pod)

## Pod MCP Server

New process running alongside OpenClaw inside the pod on port 18790. Exposes all bot capabilities as MCP tools.

### Chat Tools
| Tool | Description | Internal Implementation |
|------|-------------|------------------------|
| `chat` | Send message, get streaming response | WS gateway `chat.send` on localhost:18789 |
| `chat_history` | List recent conversation sessions | Read from `.openclaw/` state directory |

### UI Tools (migrated from jarble-ui-server.js)
| Tool | Description |
|------|-------------|
| `render_ui` | Render a UI component on the canvas |
| `define_component` | Create a reusable component template |
| `list_components` | List available UI components (built-in + custom) |
| `save_canvas_file` | Save component data to `/data/files/` |
| `load_canvas_file` | Load saved component data |
| `list_canvas_files` | List saved canvas files |

### Config Tools
| Tool | Description | PVC Path |
|------|-------------|----------|
| `get_config` | Full bot config | `/data/config/openclaw.json` |
| `get_native_config` | OpenClaw native config | `/data/.openclaw/openclaw.json` |
| `get_system_prompt` | Current system prompt | `/data/config/soul.md` |
| `update_system_prompt` | Update system prompt | `/data/config/soul.md` |
| `list_skills` | Available/enabled skills | OpenClaw skill registry |
| `toggle_skill` | Enable/disable a skill | Skill config |
| `get_channel_config` | Platform channel settings | `/data/config/openclaw.json` |

### Data Tools
| Tool | Description | PVC Path |
|------|-------------|----------|
| `list_conversations` | List conversation sessions | `/data/.openclaw/.openclaw/` |
| `get_conversation` | Full message history for a session | `/data/.openclaw/.openclaw/` |
| `get_auth_store` | View paired devices/platforms | `/data/.openclaw/.openclaw/` |
| `get_logs` | Read application logs | `/data/logs/` |
| `get_stats` | Usage stats (messages, users, uptime) | Aggregated from state |

### Filesystem Tools
| Tool | Description | Scope |
|------|-------------|-------|
| `list_files` | Browse directory on PVC | `/data/` (scoped) |
| `read_file` | Read any file (1MB limit) | `/data/` (scoped) |
| `write_file` | Write/update a file | `/data/` (restricted: no `.initialized`, `runtime/`, `.npm/`) |

### OpenClaw CLI Tools
| Tool | Description | Implementation |
|------|-------------|----------------|
| `pairing_list` | List pairings for a platform | `npx openclaw pairing list {platform} --json` |
| `pairing_approve` | Approve a pending pairing | `npx openclaw pairing approve {platform} {code}` |

## API Proxy Endpoint

### `GET /api/mcp/:deploymentId`

SSE endpoint that proxies MCP protocol between browser and pod.

**Auth flow:**
1. Browser sends SSE request with `Authorization: Bearer <Auth0 JWT>`
2. API verifies JWT, looks up deployment, confirms user ownership
3. API connects to pod's MCP server at `pod-ip:18790`
4. API streams MCP SSE events bidirectionally

**Connection management:**
- Re-resolves pod IP on connection failure (handles pod restarts)
- Closes pod connection when browser disconnects
- Multiple browser tabs = multiple SSE connections (pod handles concurrency)

## Frontend Changes

### DeploymentTamboProvider

```tsx
import { MCPTransport } from "@tambo-ai/react/mcp";

<TamboProvider
  apiKey={TAMBO_API_KEY}
  userKey={user?.sub || "anonymous"}
  components={tamboComponents}
  tools={infrastructureTools}  // Only start/stop/restart/delete/changeLlmApiKey/getLogs/getStatus
  mcpServers={[{
    url: `${API_URL}/api/mcp/${deploymentId}`,
    serverKey: "openclaw",
    customHeaders: { Authorization: `Bearer ${auth0Token}` },
    transport: MCPTransport.SSE,
  }]}
  contextHelpers={contextHelpers}
>
```

### Agent Instructions Update

```
You are Jarble, connected to the user's OpenClaw bot via MCP.

The bot exposes its full capabilities through MCP tools:
- chat: Talk to the bot
- Config tools: Read/update system prompt, skills, channels
- Data tools: Browse conversations, logs, files
- UI tools: Render components on the canvas

ROUTING:
- Chat messages → use the MCP "chat" tool
- Config questions/changes → use MCP config tools
- Data/analytics requests → use MCP data tools
- Infrastructure actions (restart, stop, delete) → use infrastructure tools (these control the pod, not the bot)

For destructive actions (restart, stop, delete), ALWAYS render ConfirmAction first.
```

## Error Handling

| Scenario | Handling |
|----------|----------|
| Pod not running | API returns MCP error: "Bot is not running. Use the start button." |
| Pod restarting | API detects connection loss, returns MCP error with retry hint |
| Auth token expired | API returns 401, Tambo refreshes token via customHeaders callback |
| Chat streaming timeout | 120s timeout, returns partial response if available |
| PVC file too large | read_file enforces 1MB limit, returns truncated with warning |
| Write to restricted path | write_file blocks writes to .initialized, runtime/, .npm/ |
| Pod IP changes | API re-resolves on connection failure, transparent to browser |

## Implementation Phases

### Phase 1: Pod MCP Server
- New file in pod image: MCP server with HTTP+SSE transport on :18790
- Chat tool (wraps WS gateway internally)
- UI tools (absorb jarble-ui-server.js functionality)
- Basic config read tools (get_config, get_system_prompt)

### Phase 2: API Proxy Endpoint
- New route: `/api/mcp/:deploymentId` — SSE proxy with JWT auth
- Pod connection management (lookup, connect, reconnect)
- Update DeploymentTamboProvider to use mcpServers

### Phase 3: Full Config & Data Tools
- Write tools: update_system_prompt, toggle_skill
- Data tools: list_conversations, get_conversation, get_auth_store, get_logs, get_stats
- Filesystem tools: list_files, read_file, write_file
- CLI tools: pairing_list, pairing_approve

### Phase 4: Cleanup Legacy
- Remove chatWithBot tool and callPodProxy from tambo-tools.ts
- Remove tamboAgent.ts route (replaced by MCP chat tool)
- Simplify agent instructions
- Remove onUIBlocks side-channel (MCP handles UI rendering)

## Dependencies

New packages needed:
- `@modelcontextprotocol/sdk@^1.24.0` (both pod + API)
- `zod@^4.0.0` (if not already at v4)
- `zod-to-json-schema@^3.25.0`

Pod image changes:
- Add MCP server script to container
- Expose port 18790 in Dockerfile
- Add port to K8s deployment spec

## Sources

- [Tambo MCP Server Guide](https://github.com/tambo-ai/tambo/blob/main/docs/content/docs/guides/connect-mcp-servers.mdx)
- [Tambo MCP Template](https://github.com/tambo-ai/mcp-template)
- [Tambo Docs](https://docs.tambo.co/)

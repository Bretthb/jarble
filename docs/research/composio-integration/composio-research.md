# Composio Integration Research for Jarble

> **Date:** 2026-03-03
> **Status:** Research complete — future roadmap item
> **Branch:** UI-polishing

## Summary

Composio (composio.dev) is a managed tool-integration platform for AI agents. 27k+ GitHub stars, $29M funded, 982 toolkits / 11,000+ actions. Its primary value for Jarble is **OAuth-as-a-service** — eliminating the need for users to manually obtain API keys for SaaS integrations.

## Why Composio (and Why Not)

### The Problem It Solves
Jarble users who want their bot to interact with Gmail, Google Calendar, GitHub, Notion, etc. currently need to:
1. Go to each service's developer console
2. Create OAuth credentials or API keys
3. Configure the skill manually
4. Handle token refresh

Non-technical users (Jarble's target) won't do this.

### What Composio Provides
- **One-click OAuth flows**: User clicks "Connect Gmail" → hosted OAuth screen → done
- **Automatic token refresh**: Composio handles the entire token lifecycle
- **982 integrations**: Gmail, Google Calendar, Sheets, Drive, GitHub, Jira, Linear, Notion, Slack, Salesforce, HubSpot, Stripe, Airtable, and more
- **Multi-tenant credential isolation**: Each deployment gets its own connected accounts
- **SOC 2 compliant**: Credential storage meets enterprise security standards

### What Composio Does NOT Replace
- **OpenClaw native tools**: web_search, web_fetch, browser, exec, file system, memory, cron, image/PDF — all stay as-is
- **jarble-ui-server.js**: render_ui, define_component, etc. are domain-specific in-pod tools. Zero overlap with Composio.
- **Inbound messaging**: Composio's Slack/Discord/Telegram/WhatsApp integrations are outbound-only. OpenClaw owns inbound channels.
- **Unauthenticated skills**: Web Search, Weather, Calculator, Wikipedia, Translator don't need OAuth.

## OpenClaw Already Has Broad Capability

OpenClaw pods ship with:
- `web_search` (multi-provider: Brave, Perplexity, Gemini, Grok)
- `web_fetch` (HTTP GET + HTML-to-markdown)
- `browser` (full Chromium automation — can access any web service)
- `exec` (shell commands)
- File system tools (`read`, `write`, `edit`)
- Cross-session memory (`memory_search`, `memory_get`)
- Messaging relay, cron, image/PDF analysis
- 13,700+ community skills on ClawHub (Gmail, GitHub, Notion, Calendar skills exist)

**The gap isn't capability — it's user experience.** OpenClaw *can* access these services, but requires manual API key configuration. Composio turns that into a one-click OAuth flow.

## Recommended Architecture

### Option C: Proxy Through Jarble API (Recommended Starting Point)

```
User chat → OpenClaw pod → tool call → Jarble API proxy endpoint
                                            ↓
                                    Composio SDK (in jarble-api-main)
                                            ↓
                                    Third-party API (Gmail, GitHub, etc.)
                                            ↓
                                    Result back to OpenClaw → LLM → user
```

**Why this approach:**
- No changes to the OpenClaw container image
- No NetworkPolicy changes (pod already talks to Jarble API)
- Composio SDK lives in `jarble-api-main` where you control auth, secrets, networking
- Credentials never enter the pod
- Easy to add/remove Composio integrations without image rebuilds

**Trade-off:** Extra hop adds latency (~2-3s for Composio + network round-trip). Acceptable for async bot workflows.

### Alternative Options (Future)

**Option A: Bake Composio SDK into OpenClaw image**
- Install `@composio/core` in the base image
- Write an OpenClaw SKILL.md for Composio tool usage
- Pass Composio API key + session token via K8s Secret env vars
- Pro: Lower latency (direct call). Con: Custom image maintenance.

**Option B: Composio MCP server in-pod**
- Install MCP server wrapper for Composio in the image
- When OpenClaw gets native MCP client support, configure via `openclaw.json`
- Pro: Clean MCP architecture. Con: OpenClaw MCP client not yet merged (as of Feb 2026).

## Integration Design (Option C)

### Database Changes
```sql
-- Add to skillsCatalog
ALTER TABLE skillsCatalog ADD COLUMN skillType TEXT DEFAULT 'native';  -- 'native' | 'composio'
ALTER TABLE skillsCatalog ADD COLUMN toolkitSlug TEXT;                 -- e.g., 'github', 'gmail'
ALTER TABLE skillsCatalog ADD COLUMN requiredScopes TEXT;              -- JSON array of OAuth scopes
```

### API Changes
```
jarble-api-main/
├── src/
│   ├── services/
│   │   └── composio.ts              # NEW: Composio SDK wrapper
│   ├── trpc/routers/
│   │   └── skills.ts                # EDIT: Add Composio skill operations
│   ├── routes/
│   │   └── composioProxy.ts         # NEW: Tool call proxy endpoint
│   └── k8s/
│       └── secrets.ts               # EDIT: Add COMPOSIO_SESSION_TOKEN to pod secrets
```

### Frontend Changes
```
Jarble-mvp/
├── views/
│   └── DeploymentConfiguration.tsx   # EDIT: Add "Connected Apps" section
├── components/
│   └── skills/
│       └── ComposioConnectButton.tsx # NEW: OAuth Connect Link button
```

### ConfigSync Changes
- When a Composio skill is enabled, configSync writes a skill config that points to the Jarble API proxy
- OpenClaw sees it as a regular tool endpoint, calls Jarble API, which proxies to Composio

### User Flow
1. User enables "Google Calendar" skill in deployment settings
2. UI shows "Connect Google Calendar" button
3. User clicks → Composio hosted OAuth flow → signs in with Google
4. Connected account stored in Composio (keyed by `deploymentId`)
5. Bot can now call Google Calendar tools at chat time
6. Token refresh is automatic (Composio handles it)

## Composio Pricing

| Plan | Cost | Tool Calls/mo | Connected Accounts |
|------|------|---------------|--------------------|
| Free | $0 | 20,000 | 100 |
| Starter | $29/mo | 200,000 | Included |
| Business | $229/mo | 2,000,000 | Included |
| Enterprise | Custom | Custom | Custom |

Additional: $2 per 1,000 connected accounts at scale.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Vendor lock-in (Composio outage = all SaaS skills fail) | Treat Composio skills as a separate degradable tier; native skills always work |
| Latency (~2-3s per tool call) | Acceptable for async bot workflows; cache frequent reads |
| SDK maturity (v3 in beta) | Start with REST API, adopt SDK when stable |
| Pricing at scale | Monitor usage; batch operations where possible |
| Data sovereignty | Composio is SOC 2; enterprise tier offers VPC/on-prem |

## Decision

**Not blocking current work.** This is a future feature for when the skills system expands beyond public utilities into user-authenticated SaaS integrations. The recommended starting point (Option C: API proxy) requires no image changes and minimal infrastructure modification.

## Sources

- [Composio Homepage](https://composio.dev/)
- [Composio Docs](https://docs.composio.dev/)
- [Composio GitHub (27k+ stars)](https://github.com/ComposioHQ/composio)
- [Composio Toolkits Directory](https://composio.dev/toolkits)
- [Composio Pricing](https://composio.dev/pricing)
- [Composio MCP Integration](https://docs.composio.dev/docs/mcp-quickstart)
- [Composio Auth Docs](https://docs.composio.dev/docs/authenticating-tools)
- [SwarmZero Case Study](https://composio.dev/case-study/swarmzero-case-study)
- [OpenClaw Tools Docs](https://docs.openclaw.ai/tools)
- [OpenClaw Skills Docs](https://docs.openclaw.ai/tools/skills)
- [OpenClaw MCP Feature Request (Issue #29053)](https://github.com/openclaw/openclaw/issues/29053)

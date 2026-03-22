# Hosted Packages Architecture

> How creators publish components/packages where their own server hosts the backend logic, and buyers install them to get UI components + remote skills on their bots.

## Current State

**Built (display layer ~40%)**:
- DB schema: `hostingModel` (`self_hosted` | `remote` | `hybrid`), `remoteApiEndpoint` on `marketplacePackages`
- Publish/browse/filter by hosting model in frontend + API
- Frontend badges, endpoint display, conditional form fields
- Self-hosted install flow works end-to-end (PVC sync, soul.md snippets, skill configs)

**Missing (execution layer ~0%)**:
- No auth tokens for buyer→creator API calls
- `remoteApiEndpoint` never reaches the pod
- No proxy endpoint for remote skill execution
- No health monitoring for creator APIs
- No payment gating on install
- No admin approve/reject for packages
- No usage metering or billing

## Architecture Design

### Core Principle: Proxy Pattern

Every platform we researched (Shopify, Slack, MCP, AG-UI) uses a proxy/gateway. Buyer pods **never** call creator APIs directly.

```
Buyer's Pod (MCP skill tool call)
    │
    ▼ HTTP POST to Jarble API
Jarble API Proxy  (/api/packages/proxy/:deploymentId/:packageId/:skillName)
    │
    │ 1. Validate deployment owns this package install
    │ 2. Decrypt creator API credential from DB
    │ 3. Add auth headers + HMAC signature
    │ 4. Forward request with timeout
    │ 5. Log usage for metering
    │
    ▼ HTTP POST to creator endpoint
Creator's Remote API (https://weather-api.creator.com/v1/get_weather)
    │
    ▼ response
Jarble API Proxy  (validate response, enforce size limit)
    │
    ▼ response back to pod
Buyer's Pod → bot renders UI component with response data
```

**Why proxy, not direct**:
- Creator API keys never stored on buyer pods
- Usage metering happens at one chokepoint
- Circuit-break unhealthy endpoints centrally
- HMAC signing proves requests came from Jarble
- Minimal latency (same cluster)

### Package Card (Creator Registration)

When publishing a `remote` or `hybrid` package, creators provide a **Package Card** — a structured JSON blob stored in `marketplacePackages.remoteApiConfig` (replacing the simple `remoteApiEndpoint` string).

```typescript
interface PackageCard {
  // Creator's API base URL (HTTPS required)
  endpoint: string;

  // Health check (Jarble polls every 5min)
  healthEndpoint?: string;

  // Auth that the creator's API expects from Jarble proxy
  auth: {
    type: "api_key" | "bearer" | "oauth2_client_credentials";
    headerName?: string;        // default: "Authorization" for bearer, "X-API-Key" for api_key
    // For oauth2: token endpoint + scopes
    tokenEndpoint?: string;
    scopes?: string[];
  };

  // Skills the package exposes (MCP-compatible tool defs)
  skills: Array<{
    name: string;               // e.g., "get_weather"
    description: string;
    inputSchema: JSONSchema;    // validated at proxy before forwarding
    outputSchema?: JSONSchema;  // validated on response
  }>;

  // Rate limits the creator enforces
  rateLimits?: {
    requestsPerMinute?: number;
    requestsPerDay?: number;
  };

  version: string;              // semver
}
```

**Inspiration**: A2A Agent Card (`/.well-known/agent.json`), MCP Registry `server.json`.

### Authentication Flow

1. **At publish time**: Creator provides their master API key (or OAuth client credentials). Jarble encrypts and stores it in `marketplacePackages.remoteApiConfig`.

2. **At install time**: `packages.install` creates a `packageCredentials` row with an encrypted copy of the credential scoped to this deployment. For OAuth, Jarble obtains an initial access token.

3. **At runtime**: Proxy decrypts the credential per-request, adds it as the configured header, forwards to creator.

4. **Request signing**: Every proxied request includes `X-Jarble-Signature` (HMAC-SHA256 of request body + timestamp with a shared secret), so creators can verify authenticity.

### How the Bot Learns to Use Remote Skills

The existing patterns handle this naturally:

1. **Instruction snippet** → appended to `/data/config/soul.md` as `## Package: {name}` (already works)
2. **Skill configs** → rendered to `/data/skills/{name}.json` on PVC (already works for self-hosted skills)
3. **Component manifests** → written to `/data/marketplace/{componentId}/manifest.json` (already works)

**New for remote**: The skill config JSON includes a `proxyUrl` field pointing to `{JARBLE_API_URL}/api/packages/proxy/{deploymentId}/{packageId}/{skillName}`. The MCP server reads this and calls the proxy instead of executing locally.

### Data Flow

```
Creator publishes package with PackageCard
    ↓
Admin reviews + approves
    ↓
Buyer browses marketplace, clicks "Install"
    ↓
packages.install:
  1. Create packageInstalls record
  2. Create packageCredentials record (encrypted creator API cred)
  3. Install components to PVC (manifest.json, template/sandbox files)
  4. Install skills with proxyUrl in config
  5. Append instruction snippet to soul.md
  6. syncConfigsToPvc() fires
    ↓
Bot receives user message
    ↓
LLM sees skill tool + instruction snippet
    ↓
LLM calls skill tool (e.g., get_weather)
    ↓
MCP server on pod hits proxyUrl → Jarble API proxy → Creator API
    ↓
Response data flows back to bot
    ↓
LLM calls render_ui("weather_card", { ...responseData })
    ↓
Frontend renders the component (template or sandbox from PVC)
```

## Database Changes

### New Tables

```sql
-- Per-deployment credentials for remote package installs
CREATE TABLE package_credentials (
  id TEXT PRIMARY KEY,
  package_install_id TEXT NOT NULL UNIQUE
    REFERENCES package_installs(id) ON DELETE CASCADE,
  deployment_id TEXT NOT NULL
    REFERENCES deployments(id) ON DELETE CASCADE,
  credential_encrypted TEXT NOT NULL,   -- AES-256-GCM via encryption.ts
  credential_type TEXT NOT NULL,        -- "api_key" | "bearer" | "oauth2_client_credentials"
  cached_token TEXT,                    -- For OAuth: cached access token
  token_expires_at TEXT,                -- ISO timestamp
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Usage metering for billing
CREATE TABLE package_usage (
  id TEXT PRIMARY KEY,
  package_install_id TEXT NOT NULL
    REFERENCES package_installs(id) ON DELETE CASCADE,
  deployment_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  billing_cycle_start TEXT NOT NULL,    -- ISO date (first of month)
  recorded_at TEXT NOT NULL
);
```

### Schema Modifications

```sql
-- Replace simple endpoint string with structured PackageCard JSON
ALTER TABLE marketplace_packages ADD COLUMN remote_api_config TEXT;
-- (keep remoteApiEndpoint for backwards compat, migrate data)

-- Health tracking
ALTER TABLE marketplace_packages ADD COLUMN remote_health TEXT DEFAULT 'unknown';
-- Values: "healthy" | "degraded" | "offline" | "unknown"
ALTER TABLE marketplace_packages ADD COLUMN remote_last_check TEXT;
```

## New API Endpoints

### 1. Package Proxy (Express route, not tRPC — needs raw HTTP)

```
POST /api/packages/proxy/:deploymentId/:packageId/:skillName
Body: { arguments: { ... } }
Returns: { result: { ... } }
```

Logic:
1. Verify deployment exists and belongs to authenticated user (or is the pod calling via internal auth)
2. Verify package is installed on this deployment
3. Load `packageCredentials` for this install
4. Decrypt credential
5. Validate `arguments` against PackageCard's skill `inputSchema`
6. Build request: creator endpoint + `/skills/{skillName}`, auth headers, HMAC signature
7. Forward with 30s timeout
8. Validate response size (max 1MB)
9. Record usage in `package_usage`
10. Return response to caller

### 2. Admin Package Moderation (tRPC)

```typescript
packages.adminApprove   // { packageId } → sets status "published"
packages.adminReject    // { packageId, reason } → sets status "rejected"
packages.adminList      // list all pending_review packages
```

### 3. Health Check Background Job

Runs every 5 minutes (like `statusReconciler.ts`):
- Fetch all packages where `hostingModel` in `("remote", "hybrid")`
- Hit `healthEndpoint` (or `endpoint + "/health"` fallback)
- Update `remote_health` and `remote_last_check`
- Log warnings for degraded/offline packages

### 4. Creator Dashboard (tRPC)

```typescript
packages.creatorInstalls  // list who installed your packages (anonymized)
packages.creatorUsage     // aggregated usage stats per package per month
```

## Implementation Phases

### Phase 1 — Core Proxy + Credentials (MVP)
1. Add `packageCredentials` table to all 3 DB schemas
2. Add `remoteApiConfig` column to `marketplacePackages`
3. Define `PackageCard` Zod schema
4. Build `/api/packages/proxy` Express route
5. Modify `packages.install` to create `packageCredentials` for remote packages
6. Modify `packages.publish` to accept and validate `PackageCard`
7. Add admin moderation procedures (`adminApprove`, `adminReject`, `adminList`)
8. Update skill config rendering to include `proxyUrl` for remote skills
9. Update MCP server to use `proxyUrl` when calling remote skills

### Phase 2 — Health + Metering
10. Add `package_usage` table
11. Implement usage recording in proxy endpoint
12. Build health check background job
13. Add `remote_health` / `remote_last_check` columns
14. Show health status badges in frontend
15. Creator dashboard: `creatorInstalls`, `creatorUsage`

### Phase 3 — Billing + Security Hardening
16. Stripe usage-based billing integration
17. Revenue share calculation (80/20 split)
18. HMAC request signing on proxied requests
19. Input/output schema validation at proxy
20. Response size limits + timeout enforcement
21. Rate limiting at proxy (from PackageCard `rateLimits`)
22. Circuit breaker for unhealthy creator APIs

### Phase 4 — Enhanced Creator Experience
23. Creator API key rotation endpoint
24. Webhook notifications for install/uninstall events
25. Creator analytics dashboard (frontend)
26. `hybrid` hosting model: partial local + partial remote skills
27. Version upgrade flow (notify buyers of new versions)

## Security Model

| Data | Stored Where | Protection |
|------|-------------|------------|
| Creator API key | `package_credentials.credential_encrypted` | AES-256-GCM |
| Proxy requests | In-flight only | TLS + HMAC signature |
| Tool arguments | Validated at proxy | JSON Schema from PackageCard |
| Tool responses | In-flight only | Size limit (1MB), optional schema validation |
| Usage records | `package_usage` table | Per-deployment, anonymized for creator dashboard |

**What creators never see**: buyer deployment ID, user identity, LLM keys, conversation history — only the specific tool call arguments.

**What buyers never see**: creator's infrastructure details, other buyers' usage.

**Publish requirements for remote packages**:
- HTTPS endpoint (validated at publish)
- Reachable health endpoint (validated at publish)
- Valid PackageCard schema
- Admin security review before approval

## Frontend Changes

### PackagePublishForm
- Replace simple `remoteApiEndpoint` text input with structured PackageCard form:
  - Endpoint URL
  - Auth type selector (API key / Bearer / OAuth2)
  - Auth credential input (encrypted before sending)
  - Skill definitions (name, description, input schema)
  - Rate limits (optional)

### PackageDetail
- Show health status badge (healthy/degraded/offline) for remote packages
- Show skill list with descriptions from PackageCard
- Show rate limits if defined

### Creator Dashboard (new page)
- Install count per package
- Usage stats (requests/month) per package
- Health status history
- Revenue (when billing enabled)

## Install/Uninstall Handshake (Inspired by Shopify AppInstallation Webhooks)

When a buyer installs a remote package, Jarble performs a handshake with the creator's API so the creator can set up per-buyer state:

```
packages.install:
  ...after creating packageInstalls + packageCredentials...

  POST {remoteApiEndpoint}/jarble/install
  Headers: X-Jarble-Signature, X-Jarble-Timestamp
  Body: {
    deploymentId: "dep_abc123",
    packageId: "pkg_weather",
    installedAt: "2026-03-04T...",
    callbackUrl: "https://api.jarble.ai/api/packages/proxy/dep_abc123/pkg_weather"
  }

  Response: {
    capabilities: ["get_weather", "get_forecast"],
    configSchema: { ... }  // optional: per-buyer config the creator accepts
  }
```

On uninstall: fire-and-forget `POST {remoteApiEndpoint}/jarble/uninstall` so the creator can clean up.

If the install handshake fails (4xx), the install fails with a user-visible error. If it times out or returns 5xx, the install succeeds but is marked `remote_install_confirmed = false` with async retry.

**Added to `packageInstalls`**:
```sql
remote_install_confirmed  INTEGER DEFAULT 0   -- boolean
remote_capabilities       TEXT                 -- JSON from creator's install response
```

## Component Trust Boundary (Inspired by Shopify Remote DOM + Figma Two-Context)

**Critical constraint**: Remote packages must respect the existing trust split:

| Context | Trust Level | What Runs Here |
|---------|------------|----------------|
| MCP tool execution (pod) | High (reviewed by Jarble) | Tool invocation, data fetching. Creator's endpoint gets called here. Creator code **never** runs here. |
| Canvas sandbox iframe | Low (creator HTML/JS) | Only for sandbox-tier components. CSP, heartbeat watchdog, 3-attempt rate limit apply. |

**Rule**: A `remote` package's sandbox-tier components must have their HTML baked in at review time (stored in `componentVersions`), not fetched dynamically from the creator's API at render time. This prevents runtime code injection.

- **Template-tier**: Props can come dynamically from remote skill results (safe — it's just JSON data)
- **Sandbox-tier**: HTML is static from publish/review time, only **data props** can be dynamic

This mirrors Shopify's Remote DOM pattern: creators declare intent (a component tree / data), Jarble renders reality. The existing fenced-block pipeline (`uiBlockParser → autoFixProps → CanvasRenderer`) is already this boundary.

## Competitor Pattern Sources

| Pattern | Source Platform | How We Use It |
|---------|---------------|---------------|
| Package Card (structured API descriptor) | A2A Agent Card, MCP Registry | Creator registration |
| Proxy gateway | Shopify App Proxy, MCP Gateway | All remote calls |
| HMAC request signing | Slack `X-Slack-Signature` | Request authenticity |
| Remote DOM (controlled component declaration) | Shopify Remote DOM | Fenced-block pipeline = our Remote DOM |
| Two-context trust split | Figma (WASM main + iframe UI) | MCP tools = high trust, sandbox iframe = low trust |
| Install/uninstall webhooks | Shopify `AppInstallation` | Creator handshake |
| Usage-based metering at proxy | Shopify Billing API | Billing |
| Security review before publish | Slack App Directory | Trust/safety |
| Health endpoint monitoring | Kubernetes liveness probes | Availability |
| Streamable HTTP transport | MCP 2025 spec | Future: upgrade proxy to MCP protocol |

## Research Sources

- **Shopify**: App Bridge JWT session tokens, App Proxy HMAC signing, Remote DOM / remote-ui
- **Slack**: `X-Slack-Signature` HMAC-SHA256 verification, Block Kit (JSON-only UI), security review process
- **MCP**: OAuth 2.1 Resource Server spec, Streamable HTTP (replaced SSE), Dynamic Client Registration, MCP Gateway pattern
- **Google A2A**: Agent Card (`/.well-known/agent.json`), JSON-RPC 2.0 over HTTP, digitally signed cards (JWS)
- **CopilotKit/AG-UI**: `CopilotKitRemoteEndpoint`, `external_execution=true` tool delegation, AG-UI SSE events
- **Figma**: QuickJS WASM sandbox (main thread) + sandboxed iframe (UI thread), `postMessage` bridge
- **Vercel AI SDK**: `streamUI()` server actions, RSC-based tool rendering

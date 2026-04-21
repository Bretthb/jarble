---
name: Production Deployment Session - March 25, 2026
description: Full production deployment of Jarble on Hetzner K3s + Coolify (replaced Vercel) — all fixes applied, streaming still needs frontend work
type: project
---

## What Was Done (2026-03-25)

### Auth0
- Created Post Login Action "Jarble — Sync Email Verification" via Auth0 MCP
- Added dev.jarble.ai + jarble-git-develop-jarbleai.vercel.app to Auth0 callbacks, logout URLs, web origins
- Fixed NEXT_PUBLIC_AUTH0_DOMAIN env var on Vercel (had trailing newline from echo pipe, used printf instead)
- Fixed Auth0Provider: rewrote to mount synchronously (no useEffect delay) — the delayed mount caused handleRedirectCallback to never fire after OAuth redirect
- Added useCookiesForTransactions={false} to avoid SameSite cookie blocking
- Surfaced useAuth0().error in Dashboard.tsx to prevent silent failures

### API / K8s
- Added dev.jarble.ai and jarble.ai to CORS allowed origins
- Fixed PostgreSQL rowCount in deploy mutation (Drizzle PG returns .rowCount not .rowsAffected)
- Added configmaps, services to RBAC Role + get verb on pods/exec
- Seeded 13 persona templates in Neon PostgreSQL
- Marked test deployment as is_free=true to bypass subscription enforcement (Stripe not configured yet)
- Set FRONTEND_URL K8s secret to https://dev.jarble.ai

### OpenClaw Gateway (WS Streaming)
- Fixed WS origin: set origin to http://{podIP}:{port} to match Host header
- Fixed pairing: use "openclaw-control-ui" client ID + dangerouslyDisableDeviceAuth=true
- Fixed scopes: added operator.read + operator.write
- Added chatViaHTTP function using /v1/chat/completions endpoint (available but not primary)
- Added res.flush() after each sendEvent for SSE flush
- Added Traefik no-buffering middleware

### Vercel
- Linked Vercel CLI, set up env var overrides for develop branch
- Production branch confirmed as main (user needs to rollback production deployment)

## What's Remaining

### Streaming (Priority)
- **Backend sends SSE deltas per-token with flush() — confirmed working**
- **Frontend doesn't render incrementally** — the assistant-ui ExternalStoreRuntime batches updates and only renders the complete message. Need to investigate useCanvasChat.ts / assistantRuntime.ts to enable progressive rendering.
- The typewriter animation (CHARS_PER_FRAME = 8) is designed for this but it needs the SSE events to arrive and be processed incrementally.

### Other TODO
- **Stripe** — deferred, need STRIPE_SECRET_KEY from cofounder
- **Provisioning screen UX** — should be a banner/toast, not full-screen takeover
- **Vercel production branch** — rollback jarble.ai to main branch deploy
- **System prompt** — bot uses OpenClaw's default "fresh out of the box" greeting instead of persona template prompt
- **Hydration warning** — React error #418 from Auth0Provider SSR/client mismatch (cosmetic)
- **SSE status stream 401** — duplicate user insert error on first connection (race condition in getUserFromToken)
- **Library page** — showing HTTP 400
- **Platform agents** — need testing

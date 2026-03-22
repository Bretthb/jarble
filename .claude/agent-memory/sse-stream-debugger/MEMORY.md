# SSE Stream Debugger - Agent Memory

## Project Structure
- API server: `C:/Users/brett/jarble/jarble-api-main/src/index.ts` (Express, all 3 SSE endpoints inline)
- K8s module: `C:/Users/brett/jarble/jarble-api-main/src/k8s/deployment.ts` (@kubernetes/client-node)
- Frontend hooks: `C:/Users/brett/jarble/Jarble-mvp/hooks/useStatusStream.ts`, `useLogStream.ts`, `useQrStream.ts`
- Auth: `C:/Users/brett/jarble/jarble-api-main/src/services/auth.ts` (Auth0 + jose JWT)
- Rate limiting: `C:/Users/brett/jarble/jarble-api-main/src/middleware/rateLimit.ts`

## Key Findings (2026-02-18 Audit)
See [audit-findings.md](audit-findings.md) for full details.

### Critical Bugs Found
1. **No `res.flushHeaders()`** on any SSE endpoint -- could cause buffering issues with some proxies
2. **QR mock mode `log` event sends `{message}` but real mode sends `{line}`** -- frontend only reads `data.line`
3. **Log stream `isPaused` state is tracked but never applied** -- logs keep arriving when "paused"
4. **QR mock mode `setTimeout` not cleaned up on disconnect** -- timer fires after res.end()
5. **Status stream delta events lack `event:` field** -- go to `onmessage` not named event handler
6. **Status stream has no mock K8s mode** -- `getDeploymentPodStatus()` handles it internally
7. **Log stream EventSource auto-reconnect not disabled** -- browser reconnects after `end` event
8. **Global rate limiter does NOT skip SSE endpoints** -- long-lived SSE counted against 300 req/min

## SSE Endpoint Patterns
- All 3 endpoints: auth via header OR `?token=` query param, SSE headers with X-Accel-Buffering
- Keepalive: `: ping\n\n` every 30s on all endpoints
- QR stream: 90s timeout, exec-based
- Status stream: 5s poll interval, delta detection via JSON.stringify comparison
- Log stream: PassThrough pipe from K8s Log API with follow=true

## Infrastructure
- Traefik reverse proxy (trust proxy 1)
- CORS: env.FRONTEND_URL + localhost:3000 + 127.0.0.1:3000
- Rate limiting: in-memory (not shared across replicas)
- K8s namespace: "jarble"

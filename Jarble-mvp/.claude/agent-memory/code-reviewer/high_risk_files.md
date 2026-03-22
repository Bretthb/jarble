---
name: High-risk files for code review
description: Files that deserve extra scrutiny in every PR because of size, complexity, or security sensitivity
type: project
---

## Always read in full during a PR review

| File | Risk reason |
|------|-------------|
| `jarble-api-main/src/mcp/jarble-ui-server.js` | 7,110 lines, no module boundaries, no tests, runs as pod process |
| `jarble-api-main/src/routes/stripe.ts` | Webhook idempotency, billing state machine |
| `jarble-api-main/src/services/marketplaceHub.ts` | Credit debit/earn without DB transaction (known issue) |
| `jarble-api-main/src/routes/meshGateway.ts` | Hardcoded internal auth token (known issue) |
| `jarble-api-main/src/routes/serviceProxy.ts` | SSRF, gateway token auth, circuit breaker, HMAC |
| `jarble-api-main/src/services/auth.ts` | Account linking, JWT verification, race condition handling |
| `jarble-api-main/src/k8s/lifecycle.ts` | PVC/Secret/ConfigMap rollback, security contexts |
| `jarble-api-main/src/trpc/routers/deployment.ts` | 1,931 lines — ownership checks, K8s orchestration |
| `jarble-api-main/src/utils/encryption.ts` | AES-256-GCM, format parsing |
| `Jarble-mvp/components/canvas/sandbox/sandboxCore.ts` | CSP construction, script extraction from HTML, DOMPurify |
| `Jarble-mvp/hooks/useCanvasChat.ts` | 1,236 lines — streaming, abort, conversation management |

## Known intentional patterns that are NOT bugs

- `(deployment as any).managedBy` — common cast for fields that differ across SQLite/MySQL/PG schema variants
- `values({...} as any)` on Drizzle inserts — schema union type limitation, not a logic issue
- `USE_SQLITE` check bypassing enforcement services — intentional dev-mode skip
- `dev-*` BYOK key prefix bypass — only accepted when `isDevMode`, see `openrouter.ts:validateProviderKey`
- Standard isolation running as root (`runAsUser: 0`) — documented backward-compat decision

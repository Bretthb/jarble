---
name: Proactive bug audit — Mar 20, 2026
description: 134 bugs found across 6 agents, 21 fixed and committed, remaining high-priority items listed for next session
type: project
---

## Proactive Bug Audit (Mar 20, 2026)

6 specialized agents scanned the full deployment page stack and found **134 potential bugs** across frontend, backend, SSE, database, K8s, and auth/billing layers.

### Committed Fixes (21 total) — `fed8bb9` on `UI-Tambo-ALL`

**Timeout fixes (6):**
- Gateway timeout `timedOut` flag + truncation notice in SSE
- Master timeout TDZ fix — arm after `messageId` defined
- `chatViaExec` accepts + respects `AbortSignal`
- `EXEC_TIMEOUT` error code in `chatErrors.ts`

**Critical security & reliability (6):**
- Shell injection in canvas screenshot → `execInPodWithStdin` + base64 validation
- Auth bypass in `serviceExecution.ts` when no gateway token configured
- `markDeploymentActive` moved after ownership check
- SSE double-free `cleaned` guards on all 4 endpoints
- Connection slot leak fix on status snapshot failure
- Fence buffer reset on gateway→exec fallback

**High priority (9):**
- Atomic conditional `stop` mutation (prevents double-stop race)
- Timing-safe token comparison on `serviceProxy.ts` + `serviceExecution.ts`
- Dev-mode auth hardened — never bypass in production even if `USE_SQLITE=true`
- Rate limiter skips SSE endpoints (prevents reconnection flood)
- Exec timeout destroys stdout/stderr streams (prevents memory leak)
- CanvasErrorBoundary resets error state when props change
- localStorage LRU eviction on quota exceeded
- ResizeObserver properly tracks and unobserves removed cards

### Remaining High-Priority Items (not yet fixed)

| ID | Bug | Location |
|----|-----|----------|
| H8 | IndexedDB canvas persistence not per-conversation — all conversations share same large-prop slot | `useCanvasPersistence.ts:49-73` |
| H14 | TOCTOU race in credential upsert — concurrent saves hit unique constraint | `platformCredentials.ts:117-150` |
| H15 | N+1 queries in service/marketplace list endpoints (60+ queries/page) | `services.ts:160-179`, `marketplace.ts:176-181` |
| H16 | statusCache ignores `managedBy` — operator-managed pods invisible | `statusCache.ts:77` |
| H17 | statusReconciler TOCTOU race — unconditional WHERE overwrites concurrent status | `statusReconciler.ts:201` |
| H18 | QR stream double-start race — rapid clicks orphan EventSource | `useQrStream.ts:45-127` |
| H5 | Subscription auto-linked to wrong deployment on concurrent creates | `stripe.ts:69-103` |
| H6 | Fire-and-forget deploy uses `ctx.db` (request-scoped, may be stale) | `deployment.ts:678-721` |
| H7 | Session lock not cancellable on abort — 90s delay for next message | `tamboAgent.ts:30-43` |
| H12 | SQLite foreign keys disabled — CASCADE rules don't fire | `init.ts` |
| H13 | Service install/uninstall not wrapped in transactions | `services.ts:297-505` |
| H20 | `init.ts` missing `is_platform`, `resource_tier` columns on deployments | `init.ts:43-76` |

### Full Audit Reports
The 6 agent outputs are in temp files (not persisted). Key counts:
- Backend API: 23 bugs (3 critical, 5 high, 4 medium, 6 low + 5 more)
- Frontend: 25 bugs (2 critical, 8 high, 12 medium, 3 low)
- SSE Streaming: 31 bugs (3 critical, 6 high, 7 medium, 5 low)
- Database: 31 bugs (1 critical, 8 high, 12 medium, 10 low)
- K8s Pod Lifecycle: 31 bugs (1 critical, 6 high, 13 medium, 11 low)
- Auth & Billing: 16 bugs (1 critical, 3 high, 6 medium, 4 low)

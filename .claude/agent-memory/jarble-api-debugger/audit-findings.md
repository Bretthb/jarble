# Comprehensive Audit Findings

Last full audit: 2026-02-26 (routers only), initial audit: 2026-02-18

## CRITICAL

### C1. Race Condition: Free Deployment Check Not Atomic
- **File**: `src/trpc/routers/deployment.ts:266-268`
- `checkFreeDeployment` reads `freeDeploymentUsed` then insert happens later (line 408-431)
- Two concurrent create requests can both see `freeUsed=false`
- No transaction wraps the check + insert + user flag update
- **Impact**: User gets two free deployments

### C2. `updateKeyLimit` Doesn't Sync DB `llmCreditLimitDollars`
- **File**: `src/trpc/routers/openrouter.ts:272-280`
- Updates OpenRouter API limit but DB column stays stale
- Frontend reads DB value, shows wrong limit; credit pool children reference wrong value

### C3. Missing Ownership Check on Root Deployment Key Fetch
- **File**: `src/trpc/routers/deployment.ts:390-393`
- Linked deployment fetches root via `eq(deployments.id, resolvedSourceDeploymentId)` -- no userId filter
- Violates principle of least privilege (encrypted key crosses user boundary)

### C4. Stop Mutation Leaves Stuck "stopping" State
- **File**: `src/trpc/routers/deployment.ts:840-858`
- Sets status to "stopping" (line 843), then calls K8s `stopDeployment`
- If K8s throws, catch rethrows TRPCError but never resets DB status
- Deployment stuck in "stopping" forever, user can't retry

### C5. DB Write Without Ownership on revokeKey Cleanup
- **File**: `src/trpc/routers/openrouter.ts:315-321`
- `.where(eq(deployments.id, input.deploymentId))` missing `eq(deployments.userId, ctx.user.id)`
- Ownership checked at lines 287-294 but TOCTOU gap exists

## HIGH

### H1. Config Webhook Auth Gap in Development
- **File**: `src/routes/webhooks.ts:81-82`
- Skips auth when `NODE_ENV === "development"` AND no `CONFIG_WEBHOOK_SECRET`
- `NODE_ENV` defaults to "development" in env.ts:5
- Any process can trigger configSync for any deploymentId

### H2. Fire-and-Forget Deploy Loses Error Context
- **File**: `src/trpc/routers/deployment.ts:596-622`
- Returns `{ success: true }` immediately; K8s work runs in background
- If closure throws before DB update, deployment stuck at "creating"
- StatusReconciler mitigates but creates a visibility gap

### H3. SSE Status Stream N+1 K8s API Calls
- **File**: `src/routes/sse.ts:369-401`
- Each deployment triggers individual `getDeploymentPodStatus()` per poll (every 5s)
- 10 deployments = 10 K8s API calls per poll cycle = 120 K8s API calls/min per user

### H4. Webhook Idempotency: Mark-Before-Process
- **File**: `src/routes/stripe.ts:49-62`
- Marks event as processed BEFORE handling; crash = permanent skip
- Should mark after success or use a processing/completed status field

### H5. subscriptionEnforcement Overwrites cancelledAt
- **File**: `src/services/subscriptionEnforcement.ts:194-196`
- Checks `if (!(dep as any).cancelledAt)` but should work; checking dep not updates
- Actually this was correct -- the check is against `dep.cancelledAt`, not `updates.cancelledAt`
- (Previous audit report was wrong about this being a bug)

### H6. User updateProfile Allows Unverified Email Change
- **File**: `src/trpc/routers/user.ts:23-36`
- Accepts `email: z.string().email()` -- user can set any email without verification
- Should require email verification flow or block direct email updates

## MEDIUM

### M1. Checkout Webhook Bypasses Email Verification
- **File**: `src/routes/stripe.ts:75`
- Sets `emailVerified: true` with comment "If they can pay, they're verified"
- Stolen credit card could bypass the email verification gate on deploy

### M2. Missing Credential Field Validation in platformCredentials.save
- **File**: `src/trpc/routers/platformCredentials.ts:95`
- `credentials: z.record(z.string())` accepts arbitrary key-value pairs
- No validation that keys match expected platform fields (e.g., `botToken` for telegram)

### M3. Missing updatedAt on Most DB Updates
- Nearly all `.set(...)` calls omit `updatedAt: new Date().toISOString()`
- Only platformCredentials.save sets it explicitly
- Column gets initial value from `$defaultFn(now)` but never refreshed

### M4. Google API Key Sent in URL Query String
- **File**: `src/trpc/routers/openrouter.ts:115`
- `?key=${input.apiKey}` -- logged by proxies, CDNs, and access logs
- Should use header-based auth for Google API validation

### M5. Delete vs In-Flight Deploy Race
- **File**: `src/trpc/routers/deployment.ts:1206-1293`
- If deployment is "creating" with fire-and-forget K8s work, delete proceeds
- Background closure later tries to update deleted row (confusing error logs)

### M6. OpenRouter models Endpoint Uses Server API Key for User Queries
- **File**: `src/trpc/routers/openrouter.ts:33-34`
- `env.OPENROUTER_API_KEY` used to list models on behalf of authenticated users
- Not a direct leak but associates server key with user-triggered requests

### M7. Price Recalculation Uses Falsy Check
- **File**: `src/trpc/routers/deployment.ts:797`
- `if (updates.cpuLimit || updates.memoryMb || updates.storageMb)` -- falsy values (0) skip recalc
- Zod validates `.positive()` so 0 shouldn't arrive, but logic is fragile

## LOW

### L1. getById Returns null Instead of NOT_FOUND
- **File**: `src/trpc/routers/deployment.ts:105-115`
- Returns undefined; other endpoints throw TRPCError NOT_FOUND

### L2. getStatus Returns Object Instead of Error
- **File**: `src/trpc/routers/deployment.ts:634-636`
- Returns `{ status: "not_found" }` instead of throwing

### L3. runtimeCatalog.getById Returns Inactive Runtimes
- **File**: `src/trpc/routers/runtimeCatalog.ts:20-24`
- No `isActive` filter on getById, unlike `list` which filters

### L4. Linked Deployment Chain Limited to 2 Levels
- **File**: `src/trpc/routers/deployment.ts:328-342`
- Follows one link level; chains > 2 would resolve to wrong root
- Safe in practice since create only links 1 level deep

### L5. Template Router Is Hardcoded
- **File**: `src/trpc/routers/template.ts:4-26`
- Static 3-item array, not configurable without code change

### L6. Debug Routes No Auth (Dev Only)
- **File**: `src/routes/debug.ts:41-57`
- `POST /debug/deployment/:id/status` changes any deployment's status
- Gated by NODE_ENV but defaults to "development"

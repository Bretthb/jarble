# Work Session: Hosted Packages Architecture

**Date:** 2026-03-04
**Branch:** `UI-Tambo-ALL`
**Status:** All 4 phases complete (18/18 tasks)

---

## What Was Built

A complete hosted package system that lets third-party creators publish packages with remote APIs. Buyer pods call creator APIs through a secure proxy layer with HMAC signing, input/output validation, rate limiting, circuit breaking, health monitoring, and usage metering. Includes key rotation, uninstall webhooks, version upgrade detection, and creator dashboard analytics.

## Implementation Phases

### Phase 1: Core Proxy + Credentials
- `packageCredentials` DB table (all 3 schemas: SQLite, MySQL, PG)
- `remoteApiConfig`, `remoteHealth`, `remoteLastCheck` columns on `marketplacePackages`
- HMAC-SHA256 signing/verification utilities
- Package proxy route — forwards skill calls to creator APIs with auth + HMAC headers
- Install handshake (POST to creator's `/jarble/install`)
- Admin moderation procedures (adminList, adminApprove, adminReject)
- ConfigSync + openclaw skill rendering with `proxyUrl` for remote skills

### Phase 2: Health Monitoring + Metering
- `packageUsage` DB table — per-skill request tracking by billing cycle
- Fire-and-forget usage recording in proxy after each request
- Background health check service (polls creator health endpoints every 5 min)
- Creator dashboard procedures (creatorInstalls, creatorUsage)
- Frontend health badges on PackageCard + PackageDetail

### Phase 3: Security + Resilience
- Lightweight JSON Schema validation (type checking, required fields, nesting)
- Input validation at proxy — 400 on schema mismatch
- Output validation — warning header `X-Jarble-Schema-Warning`, non-blocking
- Per-deployment+package rate limiter (fixed-window, in-memory)
- Circuit breaker (3-state: CLOSED/OPEN/HALF_OPEN, per-package)

### Phase 4: Creator Experience
- `rotateSigningSecret` — generates new HMAC secret, notifies creator via webhook signed with old secret
- Uninstall webhook to creator API (fire-and-forget)
- `getPackageStatus` — comprehensive install status with handshake/health info
- `checkForUpdates` — detects packages with new components/skills since install
- `upgradePackage` — installs missing components/skills, re-syncs configs

## Files Created

| File | Purpose |
|------|---------|
| `jarble-api-main/src/utils/hmac.ts` | HMAC-SHA256 signing/verification (generateSigningSecret, signRequest, verifySignature) |
| `jarble-api-main/src/utils/jsonSchemaValidation.ts` | Lightweight JSON Schema validator (type, required, nesting, enum) |
| `jarble-api-main/src/routes/packageProxy.ts` | Express proxy: POST /api/packages/proxy/:deploymentId/:packageId/:skillName |
| `jarble-api-main/src/services/packageHealthCheck.ts` | Background health check service (5 min interval) |
| `jarble-api-main/src/services/packageHandshake.ts` | Install handshake POST to creator endpoint |
| `jarble-api-main/src/services/circuitBreaker.ts` | Per-package 3-state circuit breaker |
| `jarble-api-main/src/middleware/packageRateLimit.ts` | Per-deployment+package rate limiter (fixed-window) |
| `jarble-api-main/src/utils/hmac.test.ts` | 19 tests |
| `jarble-api-main/src/utils/__tests__/jsonSchemaValidation.test.ts` | 39 tests |
| `jarble-api-main/src/services/__tests__/packageHealthCheck.test.ts` | 20 tests |
| `jarble-api-main/src/services/__tests__/circuitBreaker.test.ts` | 17 tests |
| `jarble-api-main/src/middleware/__tests__/packageRateLimit.test.ts` | 17 tests |
| `jarble-api-main/src/routes/__tests__/packageProxy.test.ts` | 20 tests |
| `jarble-api-main/src/__tests__/routers/packages.admin.test.ts` | 16 tests |
| `docs/plans/2026-03-04-hosted-packages-architecture.md` | Architecture plan |

## Files Modified

| File | Change |
|------|--------|
| `jarble-api-main/src/db/schema.sqlite.ts` | Added `packageCredentials`, `packageUsage` tables + remote columns on `marketplacePackages` |
| `jarble-api-main/src/db/schema.ts` (MySQL) | Same schema changes |
| `jarble-api-main/src/db/schema.pg.ts` (PG) | Same schema changes |
| `jarble-api-main/src/db/index.ts` | Added `packageCredentials`, `packageUsage` to ActiveTables |
| `jarble-api-main/src/db/init.ts` | Added `package_usage` CREATE TABLE for SQLite dev |
| `jarble-api-main/src/__tests__/helpers/testDb.ts` | Added `package_usage` CREATE TABLE for test DB |
| `jarble-api-main/src/trpc/routers/packages.ts` | 10 new procedures (rotateSigningSecret, getPackageStatus, checkForUpdates, upgradePackage, creatorInstalls, creatorUsage, adminList, adminApprove, adminReject + enhanced install/uninstall) |
| `jarble-api-main/src/services/configSync.ts` | buildDeploymentFields loads remoteSkillConfigs for proxy URL injection |
| `jarble-api-main/src/runtimes/types.ts` | Added `remoteSkillConfigs` to DeploymentFields |
| `jarble-api-main/src/runtimes/handlers/openclaw.ts` | renderConfigs injects proxyUrl into skill configs |
| `jarble-api-main/src/index.ts` | Registered packageProxyRouter + startPackageHealthCheck |
| `jarble-api-main/src/__tests__/routers/packages.test.ts` | +47 new tests (creatorInstalls, creatorUsage, Phase 4 procedures) |
| `Jarble-mvp/components/marketplace/PackageCard.tsx` | Health dot indicator for remote/hybrid packages |
| `Jarble-mvp/components/marketplace/PackageDetail.tsx` | Health status in Details card |

## Test Counts

- **Before session:** 776 tests (28 files)
- **After session:** 925 tests (32 files)
- **New tests:** 149
- **All passing, 0 TypeScript errors**

## Packages Router Procedures (16 total)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| list | query | public | Browse published packages |
| get | query | public | Package detail with components/skills |
| install | mutation | protected | Install package + handshake for remote |
| uninstall | mutation | protected | Uninstall + webhook for remote |
| listInstalled | query | protected | List installed packages for deployment |
| publish | mutation | protected | Submit package for review |
| listByCreator | query | public | Creator's published packages |
| getPackageStatus | query | protected | Comprehensive install status |
| checkForUpdates | query | protected | Detect packages with available upgrades |
| upgradePackage | mutation | protected | Install new components/skills from updated package |
| creatorInstalls | query | protected | Creator: view install list |
| creatorUsage | query | protected | Creator: usage analytics by month |
| rotateSigningSecret | mutation | protected | Rotate HMAC signing secret |
| adminList | query | protected+admin | List packages by status |
| adminApprove | mutation | protected+admin | Approve package for publishing |
| adminReject | mutation | protected+admin | Reject package with reason |

## Architecture: Request Flow

```
Buyer Pod (MCP skill call)
  → POST /api/packages/proxy/:depId/:pkgId/:skillName
    → Rate limit check (per-deployment+package, fixed-window)
    → Circuit breaker check (per-package, 3-state)
    → Input schema validation (JSON Schema from PackageCard)
    → HMAC-SHA256 signing (timestamp-in-payload, replay protection)
    → Auth headers (api_key or bearer from PackageCard)
    → Forward to creator API (30s timeout, 1MB response limit)
    → Circuit breaker recording (success/failure)
    → Output schema validation (warn-only, X-Jarble-Schema-Warning header)
    → Fire-and-forget usage recording (package_usage table)
  → Response to buyer pod
```

## Key Design Decisions

- **Proxy pattern** — buyer pods never call creator APIs directly; Jarble API acts as gateway
- **HMAC-SHA256** — per-install signing secrets, timestamp-in-payload prevents replay attacks
- **Fire-and-forget** — usage recording, handshake, webhooks don't block the response
- **Circuit breaker** — 5 consecutive failures opens circuit for 60s, auto-recovers
- **In-memory rate limiting** — no Redis needed for MVP; fixed-window per-minute and per-day
- **Schema validation** — input validation blocks bad requests; output validation is warn-only
- **Key rotation** — notifies creator with old-secret-signed webhook containing new secret

---
name: QA API Run April 8 2026 (Cycle 3)
description: Wave 4 Layer F + security hardening verification run against https://api.jarble.ai - 5 bugs found including 2 CRITICAL
type: project
---

Full regression + new-feature QA run against production (https://api.jarble.ai) using M2M token.
Testing security hardening from QA cycle 2 findings and Wave 4 Layer F fixes.

**Why:** Verify that 17 previously identified issues were fixed before continued development.
**How to apply:** Regression watchlist for next QA cycle; two critical issues still need fixes.

## CRITICAL REGRESSIONS (not fixed)

### CRITICAL - /debug/db accessible to any authenticated user in production
- GET https://api.jarble.ai/debug/db WITHOUT auth → 401 (correct)
- GET https://api.jarble.ai/debug/db WITH any valid Bearer token → 200 + full DB dump
- Response includes: all user emails, all deployment configs, encrypted API keys, runtime catalog, skills catalog
- The endpoint is supposed to be dev-only (NODE_ENV check) but is live in production
- Fix: check NODE_ENV === 'production' or restrict to super_admin role; never expose in prod

### HIGH - Stack traces still present in all tRPC error responses in production
- All 4xx/5xx responses include `"stack"` field with full file paths and call stack
- Example from admin.listUsers (403): stack shows /app/dist/jarble-api-main/src/trpc/middleware.js:91
- Fix: Strip `data.stack` from tRPC error responses in production (NODE_ENV check in errorFormatter)

## NEW BUGS FOUND

### FAIL - deployment.create accepts absurd storageGb without validation
- POST /trpc/deployment.create with `storageGb: 10000` → 200 (creates deployment!)
- Should return 400 with "Storage size exceeds maximum allowed" or similar
- Wave 4 Layer A PVC pre-flight validation is not enforced at the Zod/API layer

### FAIL - flows.generateFromPrompt still returns 500 instead of PRECONDITION_FAILED
- POST /trpc/flows.generateFromPrompt with any prompt → 500 INTERNAL_SERVER_ERROR
- Actual error: "Flow generation failed: LLM API error 401: Missing Authentication header"
- Should be: 412 PRECONDITION_FAILED with "LLM API key not configured for this deployment"
- This was flagged in QA cycle 2 (Apr 4) and is still unfixed

## FIXES CONFIRMED (previously failing, now passing)

- XSS input validation on deployment.create, org.create, flows.create, deployment.update → all return 400 with "HTML tags are not allowed in this field"
- deployment.create name length max (255 chars) → 400 with Zod too_big error
- deployment.create systemPrompt length max (50K chars) → 400 with Zod too_big error  
- Rate limiting on mutations: 429 after 30 requests in window, message: "Too many write operations. Please slow down."
- deployment.getById with nonexistent ID → 404 NOT_FOUND (was returning null/200)
- deployment.create missing LLM key → 400 "OpenClaw requires an LLM API key when using Bring Your Own Key mode"
- deployment.create invalid runtimeCatalogId → 404 "Runtime not found in catalog"
- deployment.delete → 200 and deployment no longer in list
- Flow execution persists to DB: execution IDs appear in flows.listExecutions after execute
- Ad-hoc flow with unowned deployment → 403 "Flow references deployments you do not own"
- flows.create + list + update (preserves nodes) + delete → all working correctly
- Subagents CRUD (create/list/update/delete) → all working correctly
- Subagents max limit: 400 "Maximum of 10 subagents per deployment" on 11th create

## NOTED BEHAVIORS

### Subagents persist beyond test sessions on M2M user's parent deployment
- The QA M2M user (11u1rYyIRG15) had 3 pre-existing subagents on a fresh parent deployment
- These appear to be leftover from previous QA runs; all deleted as part of cleanup
- Implication: M2M user data is persistent in production (contrast with Apr 4 run where it wasn't)

## Cleanup Status
- All QA test flows deleted (4 flows): CONFIRMED
- All QA test deployments deleted (parent deploy, 10K GB deploy): CONFIRMED
- All QA test subagents deleted (10 subagents): CONFIRMED
- No test data artifacts remain in production

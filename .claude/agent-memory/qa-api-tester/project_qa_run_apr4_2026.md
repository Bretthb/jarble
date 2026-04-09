---
name: QA API Run April 4 2026
description: Full API QA run against https://api.jarble.ai - findings, bugs, and procedure name corrections
type: project
---

Full API test run against production (https://api.jarble.ai) using M2M token from jarble-dev.us.auth0.com.

**Why:** Comprehensive QA coverage of all major routers before release.
**How to apply:** Reference for known bugs and correct procedure names; regression watchlist.

## Confirmed Bugs / Issues

### FAIL - deployment.create: no max length on `name` field
- 10,001 char name causes 500 (DB insert error) instead of 400 (Zod validation)
- Fix: add `z.string().max(255)` or similar to name field in Zod schema

### WARN - deployment.getById returns 200 with null for missing/other-user's deployments
- Expected: 404 NOT_FOUND  
- Actual: 200 with `{"json": null}` 
- Security note: silently returns null rather than erroring - prevents enumeration but callers must null-check

### WARN - XSS payload accepted in deployment `name` field (200 created)
- `<script>alert("xss")</script>` stored as-is
- Parameterized queries prevent SQL injection risk; XSS risk is frontend's responsibility to escape
- Confirm frontend escapes before rendering deployment names

### WARN - flows.generateFromPrompt returns 500 when OPENROUTER_API_KEY is not set
- Error: "Flow generation failed: LLM API error 401: Missing Authentication header"
- Should return a user-friendly 400 or 503 instead of 500

### INFO - user.me is publicProcedure (no auth required)
- Returns 200 for unauthenticated requests (M2M or no token)  
- This is intentional per M2M token auto-provision design - confirmed in memory

### INFO - deployment.list returns empty for M2M user even after creating deployments
- Deployments created during test session not visible in list or getById afterward
- Possible: platform-level data isolation, soft-delete, or M2M user data cleanup
- Needs investigation if M2M is intended to have persistent deployments

## Correct Procedure Names (vs. test plan guesses)

| Test Plan Name | Actual Name | Router |
|---|---|---|
| deployment.updateConfig | deployment.update | deployment |
| user.update | user.updateProfile | user |
| billing.getStatus | billing.getOverview | billing |
| billing.createCheckoutSession | (not found) | billing |

## Billing Router Procedures (actual)
- `billing.getOverview` - totals and subscription count
- `billing.getInvoices` - invoice list (Stripe)
- `billing.getSubscriptions` - subscription list

## Auth Enforcement Summary
- GET queries without token: deployment.list, flows.list, org.list all return 401 (correct)
- user.me: returns 200 even without token (publicProcedure - by design)
- POST mutations without token: return 401 (correct)

## Performance (all under threshold)
- All endpoints responded under 0.25s
- Slowest: health check at 0.24s (first call)
- Average: ~0.11s

## Cleanup Status
- Test flows: deleted (soft + hard delete both confirmed 200)
- Test org: deleted (confirmed 200)
- Test deployments: NOT confirmed deleted (deployment.delete returned 404 - data appears not persistent for M2M user)

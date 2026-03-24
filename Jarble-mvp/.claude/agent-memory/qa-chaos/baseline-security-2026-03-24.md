---
name: Baseline Security Audit - 2026-03-24
description: First-ever security test run on Jarble API. Covers SQL injection, XSS, auth bypass, oversized payload, path traversal.
type: project
---

## Summary

Run date: 2026-03-24. API at http://localhost:3001 running in NODE_ENV=development with USE_SQLITE=true.

## Findings

### MEDIUM: 500 on Oversized Payload (no 413 returned)
- `express.json()` at line 103 of `src/index.ts` uses the default 100KB body size limit with no explicit `limit` option.
- When a body exceeds ~100KB, Express's body-parser throws a `PayloadTooLargeError`.
- The global error handler at lines 172-187 handles `SyntaxError` explicitly (400) but does NOT handle `PayloadTooLargeError` — it falls through to the generic 500 branch.
- Result: any request body > ~100KB returns HTTP 500 instead of HTTP 413, to any endpoint including unauthenticated ones.
- Fix: add `express.json({ limit: '1mb' })` with an explicit limit, or add a `PayloadTooLargeError` case in the global error handler.

### LOW: Stack Traces in tRPC Error Responses
- All tRPC error responses (401, 404, etc.) include a `data.stack` field with full server-side stack trace including file paths.
- Example: `TRPCError: You must be logged in... at <anonymous> (C:\Users\brett\jarble\jarble-api-main\src\trpc\middleware.ts:38:11)`
- This is default tRPC behavior in development mode (`NODE_ENV=development`). Confirmed the server runs with NODE_ENV=development.
- tRPC strips stack traces automatically when NODE_ENV=production.
- This is a dev-only issue as long as production deployments set NODE_ENV=production. Worth verifying.
- No custom `errorFormatter` exists in `src/trpc/middleware.ts` — relies entirely on tRPC's built-in dev-mode detection.

## PASSING

- SQL injection payloads: all handled gracefully (null result, 404, or 401 - no 500s, no data exfiltration)
- XSS payloads in API inputs: blocked at auth layer (401) before any processing
- Auth bypass (no token, invalid token, tampered JWT): all return 401 consistently across all protected endpoints
- Path traversal (../../../etc/passwd): Express normalizes the path, returns 404 "Cannot GET /etc/passwd"
- Server remains healthy after all adversarial tests

## API Configuration Notes (src/index.ts)
- Body parser: `app.use(express.json())` — no explicit limit set (defaults to 100KB)
- Rate limiter: 300 req/min per IP (global), additional `authLimiter` on tRPC and flow routes
- Helmet security headers: enabled (CSP disabled since API-only)
- Debug endpoints: only mounted when NODE_ENV=development
- PayloadTooLargeError not in global error handler — falls through to 500

**Why:** Missing PayloadTooLargeError handler is a real DoS surface — an attacker can trivially generate 500s on any endpoint without authentication. Should be 413.
**How to apply:** Flag this whenever reviewing Express error handler code. The fix is a one-liner case in the error handler or an explicit `limit` on `express.json()`.

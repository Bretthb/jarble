---
name: Production Security Audit 2026-04-04
description: Full security test run against api.jarble.ai - critical findings on debug endpoint and stack trace leakage
type: project
---

# Production Security Findings — 2026-04-04

## CRITICAL: /debug/db Exposed in Production Without Auth

**Endpoint**: `GET https://api.jarble.ai/debug/db`
**Auth required**: None
**Returns**: Complete database dump — all users (emails, auth0 IDs), all deployments (names, system prompts, encrypted LLM keys), runtime catalog, skills catalog

**Root cause**: `index.ts` gates `/debug` behind `NODE_ENV === "development"`, but the production server is running with `NODE_ENV` not set to `production` (or the build compiles out the check). The endpoint is live and publicly accessible.

**Data exposed**:
- 6 user records: email, auth0Id, name, role, stripeCustomerId, freeTrialExpiresAt
- 21 deployments: all fields including systemPrompt and encrypted llmApiKey
- Full skillsCatalog and runtimeCatalog

**Fix**: Add explicit production guard OR require auth on debug endpoints. Easiest fix: remove the `/debug` mount entirely from the built Docker image.

## HIGH: Stack Traces Leaked in All tRPC Error Responses

**Endpoint**: All tRPC endpoints on api.jarble.ai
**Condition**: Any error (400, 401, 403, etc.)
**Returns**: Full server-side stack trace including internal file paths `/app/dist/jarble-api-main/src/trpc/middleware.js:80:15`

**Root cause**: `initTRPC.create()` in `middleware.ts` has no `errorFormatter`. tRPC's default behavior includes `stack` in all error responses regardless of environment.

**Fix**: Add an `errorFormatter` that strips `stack` in production:
```ts
const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
    };
  },
});
```

## HIGH: XSS Payloads Stored Verbatim (No Input Sanitization)

**Endpoints**: `deployment.create` (name, systemPrompt), `flows.create` (name), `org.create` (name)
**Payloads stored successfully**:
- `<script>alert(xss)</script>` as deployment name → stored as-is (HTTP 200)
- `<img src=x onerror=alert(1)>` as deployment name → stored as-is (HTTP 200)
- `<svg onload=alert(1)>` as systemPrompt → stored as-is (HTTP 200)
- `<script>alert(xss)</script>` as flow name → stored as-is (HTTP 200)
- `<img src=x onerror=alert(1)>` as org name → stored as-is (HTTP 200)

**Risk level**: HIGH (not CRITICAL) because:
- React JSX renders deployment.name as text nodes (safe for UI components)
- No confirmed execution path through dangerouslySetInnerHTML for user-controlled content
- systemPrompt is sent to bot runtime, not rendered in browser

**BUT**: The system prompt is stored and rendered in deployment config views. If any config view ever uses dangerouslySetInnerHTML for the system prompt text, it would execute. This is a stored XSS time bomb.

**Fix**: Add Zod `.refine()` to strip/reject HTML tags from name fields, or sanitize on write with a library like DOMPurify (server-side).

## MEDIUM: No Rate Limiting on Any tRPC Endpoints

**Test**: 50 sequential requests to `user.me` — all returned HTTP 200, no 429s.
**Test**: 5 concurrent `deployment.create` calls — all returned HTTP 200, all created.
**Risk**: DoS via resource exhaustion, brute-force enumeration

**Note**: The `authLimiter` middleware is attached in `index.ts` but apparently does not trigger for authenticated requests.

## LOW: No Server-Side Input Length Caps Beyond Minimum

- Empty name rejected (Zod `z.string().min(1)`)
- 100KB system prompt accepted (HTTP 200)
- `!@#$%^&*()` as deployment name accepted (HTTP 200)
- No max length validation on systemPrompt

**Risk**: Storage bloat, potential DoS through very large system prompts being synced to K8s pods.

## PASS Items

| Test | Result |
|------|--------|
| No-auth on deployment.list | 401 UNAUTHORIZED |
| No-auth on flows.list | 401 UNAUTHORIZED |
| Invalid JWT | user.me returns null (not error, not data leak) |
| Admin route without admin role | 403 FORBIDDEN |
| Prototype pollution (__proto__ key) | Zod strips silently |
| SQL injection in name fields | Stored as literal string (Drizzle parameterized) — SAFE |
| Path traversal via URL | Returns frontend 404 HTML (not bypassed) |
| /.env endpoint | 404 |
| /api/health endpoint | 404 |
| LLM API keys in storage | AES-256-GCM encrypted (enc:...) |
| IDOR on getById with wrong ID | Returns null, not other user's data |

## Why: Findings were confirmed against https://api.jarble.ai (production)
## How to apply: Prioritize /debug/db fix immediately (CRITICAL) — it exposes real user PII in production.

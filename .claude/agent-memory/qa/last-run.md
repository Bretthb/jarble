# Last QA Run

## Run Details
- **Timestamp**: 2026-03-26T13:12:11Z
- **Git SHA**: 15a3e26
- **Duration**: ~25 minutes
- **Pass rate**: 83% (15 pass, 3 warn, 0 fail, 0 skip out of 18 goals)
- **Real bugs found**: 0
- **Security findings**: 1 LOW (missing message length cap in flowChat.ts)
- **Environment issues**: 0 (Auth0 real login now works!)

## Goals Tested

| # | Goal | Type | Status | Notes |
|---|------|------|--------|-------|
| 1 | API Health | API | PASS | 200 OK in <110ms |
| 2 | Flows CRUD | API | WARN | Full CRUD works; soft-delete doesn't filter archived from default flows.list |
| 3 | Flow Chat Endpoint Auth | API | PASS | 401 no auth, 404 bad flow ID — correctly secured |
| 4 | Deployment Router Changes | API | WARN | API correct; test script used wrong field name (deploymentId vs id) |
| 5 | Untested Public Endpoints | API | PASS | marketplace.getReviews, services.get, benchmarks.*, services.listByCreator all work |
| 6 | Admin Router Auth | API | PASS | 403 FORBIDDEN for non-admin on getStats, listUsers |
| 7 | flows.listExecutions | API | PASS | Returns empty array for new flow, correct format |
| 8 | Auth0 Login Flow | UI | PASS | Real Auth0 login works end-to-end! Auth0Provider.tsx changes confirmed working |
| 9 | Dashboard Authenticated | UI | PASS | Shows deployments empty state, user email, full nav |
| 10 | Deployments/Flow Canvas | UI | PASS | 3 tabs (Linked, Bot Teams, Resource Map) load; no JS errors from 1418-line rewrite |
| 11 | Settings Page | UI | PASS | Profile, appearance, account, danger zone all visible |
| 12 | Billing Page | UI | PASS | All billing sections render correctly |
| 13 | Onboarding Wizard | UI | PASS | 2/3 steps verified (name + persona selection with 13 cards) |
| 14 | Docs Sub-pages | UI | PASS | getting-started, api, architecture all load with full content |
| 15 | Auth Bypass Attempts | Chaos | PASS | All auth bypass attempts blocked |
| 16 | Input Validation | Chaos | WARN | No explicit message length cap in flowChat.ts (LOW finding) |
| 17 | tRPC Input Injection | Chaos | PASS | Prototype pollution stripped by Zod, SQL injection handled via parameterized queries |
| 18 | Rate Limiting/DoS | Chaos | PASS | Global rate limiter active (300req/60s), dev debug endpoints not exposed in prod |

## Key Findings

### Auth0 Real Login Now Works!
- After Auth0Provider.tsx changes (SSR loading fix, window.location.origin redirectUri), real Auth0 UI login works end-to-end
- Previous ROPG token injection method (FP-002) is now obsolete for UI testing
- All authenticated pages (dashboard, deployments, settings, billing) now testable in full sessions
- This is a major unlock for future QA cycles

### Deployments.tsx Rewrite Clean
- 1418-line rewrite of Deployments.tsx with new FlowExecutionTimeline and FlowNodeConfigPanel components
- 3 tabs: Linked Deployments, Bot Teams (flow canvas), Resource Map
- No JavaScript errors from the rewrite — only pre-existing React #418 hydration mismatch

### New Flow Chat Endpoint Secure
- POST /api/flows/:flowId/chat enforces Bearer JWT auth correctly
- 401 without token, 404 for nonexistent flow IDs (not 500)
- SQL injection in flow ID: path traversal blocked by Express routing, SQL injection handled by Drizzle ORM parameterized queries
- WARN: No explicit message length cap before forwarding to LLM gateway (credit abuse risk)

### Strong Security Posture
- Response headers: CSP (default-src 'none'), HSTS, X-Frame-Options SAMEORIGIN, X-Content-Type-Options nosniff
- Global rate limiter: 300 req/60s confirmed via Ratelimit header
- Admin procedures return 403 (not 401) for non-admin users — correct role-based access

### flows.list Behavior Note
- After soft delete (default), archived flows still appear in flows.list
- Callers must filter by status (draft/published) to exclude archived items
- Not a bug, but worth documenting for frontend consumers

## Warnings

### flows.list includes archived flows by default
- After `flows.delete` (soft delete, `hard: false`), archived flows appear in unfiltered `flows.list`
- Frontend must filter by `status: "draft"` or `"published"` to exclude archived
- Risk: UI could show deleted flows unless frontend correctly filters

### No message length cap in flowChat.ts
- Route handler checks for empty body but no `max()` guard on message length
- Express body-parser 100KB is the only backstop
- Authenticated users could send near-100KB messages and burn agent credits
- Recommendation: Add `if (userMessage.length > 10000)` check before gateway call

## Healer Actions
None needed — no real bugs found, only WARNs.

## Next Run Priorities
1. Test the Bot Teams/flow canvas UI with actual flow creation and execution
2. Test chat page (/d/[id]) — requires a deployment to exist (onboarding wizard now verified)
3. Test flow canvas edge/node interactions (drag, connect, configure) in Deployments.tsx
4. Test mobile viewport for new Deployments.tsx components
5. Complete onboarding wizard (Step 3: Choose Runtime, LLM provider, deploy)
6. Test /analytics and /beta pages (never tested)
7. Follow up on flowChat.ts message length cap (LOW security finding)

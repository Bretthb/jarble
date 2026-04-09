---
name: QA Regression Sweep PRs 30-43 (Apr 8 2026)
description: Verified all fixes from PRs #30-#43 are live on api.jarble.ai; 1 true regression found (systemPrompt HTML not blocked), 1 spec gap (description not in create schema)
type: project
---

Ran a 23-test regression sweep against https://api.jarble.ai on Apr 8 2026.

## Results: 21 PASS, 1 FAIL, 1 SPEC-GAP

**Why:** Verifying overnight QA didn't run due to suspected git-push sandbox restriction in overnight agent.

**How to apply:** When re-running security regression tests, note the systemPrompt HTML issue is open.

## FAIL: Test 5 (systemPrompt HTML not blocked)
- `deployment.create` with `systemPrompt: "<img src=x onerror=alert(1)>"` returns 200 and stores the HTML
- `noHtmlTags` refine is NOT applied to `systemPrompt` field in create/update schemas
- Only `name` field has HTML protection in the create schema
- Context: systemPrompt goes to LLM APIs, not rendered in browser - may be intentional. But it also appears in admin panels and logs.
- Severity: LOW (not a traditional XSS vector since it's LLM input, but worth tracking)

## SPEC-GAP: Test 5 spec says "description with HTML"
- `description` field does NOT exist in `deployment.create` schema (only in `update`)
- Zod strips unknown keys silently - HTML is never stored but also never rejected
- The test spec was slightly wrong about which field to target

## All PRs Verified as Working
- PR #30/#34/#35/#37 security: debug/db 401 no-auth, 403 M2M, stack stripped, HTML name rejected, max-length 400, storageMb max 400, rate limiting 429
- PR #35/#37/#38 flows: 51-node 400, dangling-edge 400, startedAt non-null, IDOR 403 (both node.deploymentId and node.config.deploymentId paths)
- PR #34 deployment getById: 404 NOT_FOUND for nonexistent
- PR #37 middleware: 413 for 15MB body, CORS no echo for evil.com
- PR #38 artifact sync: no 429 for different artifact IDs (503 pod-not-running, NOT 429)
- PR #43 org limits: 10th org OK, 11th returns 403 FORBIDDEN with clear message

## Rate limit found: 30 req/min window on deployment.create
- Requests 1-28: 400 (validation errors, expected)
- Requests 29-35: 429 (rate limited)
- The window appears to be 30 requests per minute

## Org limit is 10 (not 5)
- Confirmed from both code (`ownedOrgs.length >= 10`) and live test

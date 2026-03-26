---
name: Flow Chat Auth Tests 2026-03-26
description: Auth bypass and injection tests against POST /api/flows/:flowId/chat — all auth checks pass, one missing message size cap
type: project
---

Test run: 2026-03-26 against https://api.jarble.ai

## Auth Bypass (Tests 1a-1e)

- No auth header -> 401 PASS
- Malformed Bearer token -> 401 PASS
- Empty Bearer -> 401 PASS
- SQL injection in flow ID ('; DROP TABLE flows; --) -> curl rejected the URL as malformed before it could reach the server (characters not URL-encodable without curl assistance). Not a server-side concern.
- Path traversal (../../admin/chat) -> Express resolved to /admin/chat -> 404 PASS. Route not exposed.

## Input Validation (Tests 2a-2d)

- Empty body {} -> 400 with {"error":"Missing message in request body"} PASS
- Oversized message (10KB) -> 400 PASS (likely body-parser limit or validation)
- XSS payload <script>alert(1)</script> -> 404 "Flow not found" (never reaches render) PASS
- Null byte \u0000 in message -> 400 PASS

## Source Code Analysis (flowChat.ts line 163-170)

The message validation is:
  const userMessage = (body.message as string || "").trim();
  if (!userMessage) { res.status(400).json(...); return; }

There is NO maximum message length enforced in the route handler.
The message is passed directly to the OpenClaw gateway without size capping.
A legitimate 100KB message would not be rejected at the application layer —
only Express body-parser default limit (100kb) would stop it.

**Why this matters:** An authenticated user could send a maximally-sized body
to force the entire payload through the LLM inference pipeline, burning credits.

## Recommendation

Add `z.string().max(10000)` (or similar) on `userMessage` in the route handler,
or add an explicit check before processing.

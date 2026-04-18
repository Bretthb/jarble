---
name: platform_audit_march_2026
description: Comprehensive 9-agent audit results from 2026-03-17 — critical bugs, security gaps, and feature ideas
type: project
---

Full audit ran 2026-03-17 with 9 specialized agents. Report saved to `AUDIT-REPORT.md` in repo root.

**Critical fixes needed:**
- Sentry `sendDefaultPii: true` leaks auth tokens (instrumentation-client.ts:8)
- Sentry `attachRpcInput: true` leaks tRPC inputs to Sentry (middleware.ts:14)
- `NODE_ENV` defaults to "development" — debug endpoints exposed if unset in prod (env.ts:5)
- Auth0Provider wraps all pages — kills SSR/SEO for public/docs pages

**Confirmed bugs:**
- Diagnostics model comparison always mismatches (prefix vs unprefixed) — diagnose.ts:301
- Deploy sets `running` before pod is ready — deployment.ts:659
- QR stream catch block leaks connections — sse.ts:402
- editMessage race condition — useCanvasChat.ts:674
- TEMPLATE secret reverts to "personal" on every config sync
- sandpack_sandbox missing from generated manifest JSON

**Feature ideas from user:**
- Theme bug: bot too aggressively switches theme on contextual mentions (e.g., "windows 98")
- Slash commands system for web chat (/theme, /commands, all OpenClaw CLI commands)
- WhatsApp/messaging platforms are secondary "connect your own" extras, web chat is primary

**Why:** Pre-production hardening. These findings block a safe production deployment.
**How to apply:** Reference AUDIT-REPORT.md for full details. Fix C1-C4 before any production deploy. Fix H1-H11 before public beta.

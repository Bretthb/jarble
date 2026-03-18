# Jarble Platform — Comprehensive Audit Report

**Date:** 2026-03-17
**Branch:** UI-Tambo-ALL
**Agents:** 9 specialized agents ran in parallel
**Scope:** API endpoints, frontend UI, K8s/pods, SSE streams, auth/security, Stripe billing, code quality, MCP server, OpenClaw runtime

---

## CRITICAL — Fix Before Production

### C1. Sentry `sendDefaultPii: true` leaks auth tokens to Sentry
**File:** `Jarble-mvp/instrumentation-client.ts:8`
**Issue:** Browser SDK sends Authorization Bearer tokens, cookies, and request bodies to Sentry on every error event.
**Fix:** Remove `sendDefaultPii: true` (defaults to `false`).

### C2. Sentry `attachRpcInput: true` sends all tRPC payloads to Sentry
**File:** `jarble-api-main/src/trpc/middleware.ts:14`
**Issue:** Every tRPC procedure input — API keys, personal data, Stripe data, deployment configs — is forwarded to Sentry.
**Fix:** Remove `attachRpcInput: true` or gate it behind `NODE_ENV === "development"`.

### C3. `NODE_ENV` defaults to `"development"` — debug endpoints exposed if unset in prod
**File:** `jarble-api-main/src/utils/env.ts:5`
**Issue:** If `NODE_ENV` is not explicitly set, the app runs in dev mode. Debug endpoints (`/debug/db` dumps ALL tables including auth0Id, encrypted API keys, emails, system prompts) are fully exposed with zero auth.
**Fix:** Remove the `"development"` default. Either require it explicitly or default to `"production"`.

### C4. Auth0Provider wraps entire app — kills SSR/SEO for all public pages
**File:** `Jarble-mvp/app/layout.tsx`
**Issue:** Root layout wraps everything in Auth0Provider (client component). Even static docs and the landing page go through client-side loading gate, defeating SSR. The home page also uses `dynamic()` import with no SSR.
**Fix:** Split layouts — public pages (`/`, `/about`, `/pricing`, `/docs/*`, `/explore`, `/marketplace`) in a layout group without Auth0Provider. Authenticated pages in a separate `(app)/` group.

---

## HIGH — Fix Before Deploy

### H1. Deploy mutation sets `running` before pod is actually ready
**File:** `jarble-api-main/src/trpc/routers/deployment.ts:659`
**Issue:** After `createDeployment` returns (K8s API accepts the Deployment object), DB status is immediately set to `running`. Pod may still be pulling image, running init container, or doing npm install.
**Fix:** Either poll for readiness (like `start` does) or let status reconciler handle it (keep as `creating`).

### H2. Diagnostics model comparison always mismatches — confirmed bug
**File:** `jarble-api-main/src/routes/diagnose.ts:301`
**Issue:** Pod model is provider-prefixed (`anthropic/claude-sonnet-4-20250514`), DB model is unprefixed (`claude-sonnet-4-20250514`). They never match, causing perpetual false warnings.
**Fix:** Strip provider prefix before comparison.

### H3. QR stream catch block leaks connections
**File:** `jarble-api-main/src/routes/sse.ts:402-407`
**Issue:** If `streamExecInPod` throws after SSE headers are sent, the response is left open without cleanup. Connection count leaks until client disconnects.
**Fix:** Add `res.end()` and explicit `releaseConnection()` in the catch block when `res.headersSent` is true.

### H4. No config sync triggered after starting a stopped deployment
**File:** `jarble-api-main/src/trpc/routers/deployment.ts:955-963`
**Issue:** If user changes system prompt while bot is stopped, then starts it, old config persists. ConfigMap not updated during `start`.
**Fix:** Trigger `syncConfigsToPvc` after start completes.

### H5. Gateway token comparison not timing-safe
**File:** `jarble-api-main/src/routes/podApi.ts:70`
**Issue:** Uses `!==` instead of `timingSafeEqual`. Other webhook routes correctly use `secureCompare()`.
**Fix:** Use existing `secureCompare()` pattern.

### H6. `editMessage` race condition — fires `sendMessage` with stale message list
**File:** `Jarble-mvp/hooks/useCanvasChat.ts:674-691`
**Issue:** `setMessages` is async, but `sendMessage` is called immediately after, reading stale `messagesRef.current`.
**Fix:** Compute truncated list before setState, use setTimeout(0) or flushSync to ensure flush before sendMessage.

### H7. TEMPLATE secret reverts to "personal" on every config sync
**File:** `jarble-api-main/src/k8s/secrets.ts:26`
**Issue:** `updateDeploymentSecret` defaults `template` to `"personal"`. Callers in configSync don't pass the actual template value.
**Fix:** Pass `deployment.template` through `buildDeploymentFields`.

### H8. `sandpack_sandbox` missing from generated manifest JSON
**File:** `shared/component-manifest/generated/component-data.json`
**Issue:** Component exists in manifest source, Zod schema, registry, and frontend file — but not in generated JSON. Pod MCP server can't validate props. No `show_sandpack_sandbox` tool.
**Fix:** Run `npx tsx scripts/generate-mcp-manifest.ts`.

### H9. Malformed JSON bodies return 500 instead of 400
**File:** `jarble-api-main/src/index.ts:158`
**Issue:** Express `SyntaxError` from `express.json()` hits global error handler which returns generic 500.
**Fix:** Check for `SyntaxError` type and return 400.

### H10. Config-changed webhook has no auth verification in dev
**File:** `jarble-api-main/src/routes/webhooks.ts:84-98`
**Issue:** Without `CONFIG_WEBHOOK_SECRET`, any caller who knows a deployment ID can trigger config syncs.
**Fix:** Require the secret even in dev, or add auth.

### H11. Required env vars not enforced in production
**Issue:** `AUTH0_M2M_SECRET`, `API_KEY_ENCRYPTION_KEY`, `STRIPE_WEBHOOK_SECRET` are all optional. If unset in prod, API keys stored as plaintext, webhooks return 503.
**Fix:** Add startup check that fails if these are missing when `NODE_ENV=production`.

---

## MEDIUM — Should Fix

### M1. No centralized auth middleware — inconsistent auth guard patterns
**Issue:** `/d/[id]` uses useEffect redirect, dashboard shows "Please log in" card, no Next.js middleware. Inconsistent UX with flash of unauthenticated content.
**Fix:** Add `middleware.ts` for centralized auth redirect on protected routes.

### M2. ConfigSync Tier 2/3 doesn't check if chat is active before restarting
**File:** `jarble-api-main/src/services/configSync.ts:~500`
**Issue:** If user changes model while chatting, Tier 2 restarts the process mid-conversation.
**Fix:** Check `isDeploymentActive()` before Tier 2/3, defer restart until session ends.

### M3. Pods running as root (UID 0)
**File:** `jarble-api-main/src/k8s/lifecycle.ts:265-267`
**Issue:** Runtime container runs as root. `allowPrivilegeEscalation: false` is set but still UID 0.
**Fix:** Switch to `runAsUser: 1000`.

### M4. No `reconnect` event handler in useStatusStream
**File:** `Jarble-mvp/hooks/useStatusStream.ts`
**Issue:** Server sends `reconnect` event at 1-hour max lifetime. Frontend doesn't listen for it — reconnects via error backoff instead (1s+ delay).
**Fix:** Add `reconnect` event listener for immediate reconnect.

### M5. No backpressure handling on log stream
**File:** `jarble-api-main/src/routes/sse.ts:132`
**Issue:** `res.write()` return value unchecked. High-volume logs could buffer without bound.
**Fix:** Check return value, pause/resume log stream on drain.

### M6. Stripe webhook subject to global rate limiter
**File:** `jarble-api-main/src/index.ts:89`
**Issue:** `globalLimiter` applied before webhook route registration. Under heavy event load, legitimate webhooks could be dropped.
**Fix:** Register webhook route before `globalLimiter`, or add skip function.

### M7. 22 phantom component names in renderUi.ts
**File:** `jarble-api-main/src/mcp/tools/renderUi.ts:34,41`
**Issue:** Tool description lists `gauge`, `radar`, `treemap`, `funnel`, etc. that don't exist. LLM may attempt to use them.
**Fix:** Generate description from manifest at build time.

### M8. `SENTRY_DSN` bypasses env.ts Zod validation
**File:** `jarble-api-main/src/instrument.ts`
**Issue:** Reads `process.env.SENTRY_DSN` directly instead of through validated `env` object.
**Fix:** Add to `env.ts` schema, use `env.SENTRY_DSN`.

### M9. No per-route error boundaries
**Issue:** Only global ErrorBoundary exists. A crash in billing page takes down the whole app.
**Fix:** Add `error.tsx` to `app/d/[id]/`, `app/dashboard/`, `app/billing/`, `app/onboarding/[id]/`.

### M10. Debug status update accepts nonexistent deployment IDs
**File:** `jarble-api-main/src/routes/debug.ts:43-59`
**Issue:** `db.update().where()` silently succeeds for any ID. Returns `{"success":true}` for fabricated IDs.
**Fix:** Check row exists before updating.

### M11. ThemeContext FOUC (Flash of Unstyled Content)
**Issue:** Server renders with "light" theme, client may initialize with "dark" from localStorage. Brief flash before dark kicks in.
**Fix:** Cookie/server-side theme approach, or CSS transition on theme apply.

### M12. `/debug-sentry` route missing Express handler params
**File:** `jarble-api-main/src/index.ts:126`
**Issue:** Handler is `() => { throw ... }` instead of `(_req, _res) => { throw ... }`. Fragile in some Express versions.
**Fix:** Add `_req, _res` parameters.

---

## LOW — Polish / Cleanup

- **L1.** No JSON 404 catch-all — returns HTML `Cannot GET /nonexistent`
- **L2.** 404 for `/.well-known/agent.json` — only `/.well-known/jarble-mesh.json` exists
- **L3.** Missing `"use client"` on ThemeContext, ErrorBoundary, DevNav (work via import chain but fragile)
- **L4.** DevNav links to nonexistent routes (`/forgot-password`, `/bot/demo-bot/configure`, `/component-showcase`)
- **L5.** Unused `ServiceMetricsBadge` import in `/explore` page
- **L6.** MCP server fallback list missing 5 components (`sandpack_sandbox`, `embed`, `reasoning`, `tool`, `sources`)
- **L7.** Debug logs endpoint returns 500 instead of 503 when no pod found
- **L8.** Stack traces in dev mode expose full Windows file paths
- **L9.** `extractUIBlocks` import in tamboAgent.ts appears unused (only types needed)
- **L10.** ConfigMap key collision possible in operator mode for same-basename files
- **L11.** No `loading.tsx` files for App Router route transitions
- **L12.** `/register` page is a client-side redirect — should be server redirect

---

## FEATURE IDEAS

### Theme Bug & Slash Commands
- **Theme bug:** Bot too aggressively detects theme intent. Typing "windows 98" contextually (not as a theme request) triggers `set_theme`. Needs better intent gating or explicit commands only.
- **Slash commands:** Add `/command` system to web chat:
  - `/theme windows98` — explicit theme switching
  - All OpenClaw CLI commands surfaced as `/commands`
  - Separates "chat with bot" from "control the bot"
  - Mirrors Discord bot UX users already know

### WhatsApp/Messaging (Secondary Path)
- WhatsApp QR pairing, Discord, Slack, Telegram are now optional "connect your own" extras
- Web chat (`/d/[id]`) is the primary interface
- QR stream bugs are real but lower priority

### Architecture Improvements
- **Plan upgrade/downgrade:** No mechanism to change runtime tier after checkout. Need Stripe subscription update flow.
- **Short-lived exchange tokens for SSE:** Avoid long-lived JWTs in query parameters and logs.
- **Batch readConfigsFromPvc:** Replace N individual `execInPod(cat)` calls with single `tar` command.
- **Rate-limit reasoning/suggestion calls:** Every chat turn fires 2 OpenRouter calls. Add per-deployment cooldown.
- **Add CI manifest check:** `npm run check:manifest` in CI to catch sync gaps early.
- **Move reasoning parser to separate file:** `tamboAgent.ts` is ~1100 lines. `createReasoningTracker()` is cleanly separable.
- **ConfigSync timeout on deploy IIFE:** Add 5-min timeout around `createDeployment`.
- **Storage enforcement oscillation guard:** Add cooldown after Tier 3 restart.
- **Email notifications for billing events:** Trial expiration warnings, payment failure notices.
- **Redis-backed idempotency:** For multi-replica webhook processing at scale.
- **Stripe Connect:** Schema ready (`creatorProfiles.stripeConnectAccountId`), no flows implemented. Blocks marketplace monetization.

---

## Agent Reports Summary

| Agent | Domain | Verdict |
|-------|--------|---------|
| **api-tester** | 85+ tRPC procedures, 25 REST routes | All auth correctly enforced. 3 broken endpoints. |
| **frontend-tester** | 32 pages, all flows | Generally well-built. Auth0Provider SSR blocking is biggest issue. |
| **k8s-tester** | Deployment lifecycle, config sync, PVCs | Well-architected 3-tier sync, status reconciler. Deploy sets running too early. |
| **sse-tester** | 4 SSE endpoints | "Production-quality" overall. QR catch block bug, missing reconnect handler. |
| **auth-tester** | JWT, Auth0, endpoint protection | Well-architected. NODE_ENV default is critical gap. |
| **billing-tester** | Stripe checkout, webhooks, subscriptions | Excellent test coverage (24 tests). Pending subscription handoff well-mitigated. |
| **code-reviewer** | Full branch diff | 2 critical privacy issues (Sentry PII), 1 race condition, solid overall. |
| **mcp-tester** | 44 components, MCP tools, rendering | 43/44 synced. sandpack_sandbox missing from generated JSON. |
| **openclaw-tester** | Runtime handler, chat path, config sync | Confirmed diagnostics model mismatch bug. Config sync well-designed. |

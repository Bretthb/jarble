# Jarble MVP — Launch Checklist

> Last updated: Feb 23, 2026

This document captures what's built, what's broken, what's missing, and the exact path to ship.

---

## TL;DR — Where We Are

The product is functionally complete for a v1 launch. The core loop works end-to-end in dev:
**Sign up → deploy a bot → connect Telegram/WhatsApp → chat with it.**

What's blocking launch is **production infrastructure**, not features. The app hasn't been deployed to the real cluster yet. A handful of reliability issues need fixing first.

---

## What's Built and Working

### Core Product
- **Deployment wizard** — 4-step guided flow: pick runtime → configure LLM → deploy → connect platform
- **Bot lifecycle** — start, stop, restart, delete deployments via K8s
- **Chat interface** (`/d/[id]`) — direct WebSocket proxy to the pod, real-time streaming responses via Tambo/SSE
- **Management tools** — Status, Platforms, Logs, Prompt, LLM, Skills, Restart as inline chat action buttons (no extra LLM call)
- **Platform connections** — Telegram (full pairing flow), WhatsApp (QR code), Discord, Slack (token entry + config sync)
- **Config sync** — DB is source of truth → renders to PVC files + K8s secrets bidirectionally
- **LLM providers** — OpenRouter, OpenAI, Anthropic, Google. BYOK or Jarble-managed credits
- **Skills marketplace** — DB schema, tRPC router, and frontend tab (skills file sync to pod not yet wired)
- **SSE streams** — real-time status updates, log streaming, WhatsApp QR streaming
- **Deployments graph** — React Flow node graph showing all bots + credit pool links

### Billing & Auth
- **Stripe subscriptions** — checkout, subscription lifecycle, webhook handlers (all 4 events), idempotency
- **Subscription enforcement** — periodic validation, free trial (7-day), cancel-at-period-end, orphan cleanup
- **Storage enforcement** — periodic checks, auto-stop bots over quota
- **Auth0** — JWT + JWKS, email/password + Google/GitHub OAuth, email verification check on all protected routes
- **Hardware-based pricing** — dynamic price_data from vCPU/RAM/storage specs, no pre-created Stripe products needed

### Infrastructure
- **K8s per deployment** — Deployment + Secret + PVC (20Gi Longhorn) + Service, namespace `jarble`
- **Security hardening** — non-root containers, all capabilities dropped, no service account token, NetworkPolicy egress rules
- **Liveness/readiness probes** — K8s restarts hung pods automatically
- **Background status reconciler** — `statusReconciler.ts`, paginated 100/cycle, runs continuously
- **MCP server** — Streamable HTTP endpoint, 15 tools covering all management operations + PVC filesystem access
- **Mock K8s mode** — `MOCK_K8S=true` for local dev without a cluster

---

## What's Broken / Not Production-Ready

### P0 — Blocks Launch

| Issue | Status | Fix |
|-------|--------|-----|
| **Not deployed to production** | Not started | Merge `k8-debug` to `main`, deploy to Hetzner K3s |
| **Auth0 email provider not configured** | Partial (Action installed, no SMTP) | Connect Resend or SendGrid in Auth0 dashboard |
| **Drizzle migrations not regenerated** | Deferred | Run `npm run db:generate` + test against MySQL in staging |
| **Stripe webhooks not wired in prod** | Not started | Add endpoint in Stripe dashboard, copy `STRIPE_WEBHOOK_SECRET` to prod `.env` |
| **K8s resource cleanup on delete** | Unknown | Audit `deployment.ts` delete path — confirm all 4 resources (Deployment, Secret, PVC, Service) are deleted |

### P1 — Fix Before First Users

| Issue | Status | Fix |
|-------|--------|-----|
| **Telegram pairing flaky** — stdin exec hangs, polling UX rough | Partial fix (30s timeout added) | Investigate `execInPodWithStdin` WebSocket handling; add better progress UI |
| **First-boot latency** — npm install takes 2-3 min | Known | Pre-bake `openclaw@latest` into container image (eliminates install + npm cache corruption) |
| **npm cache corruption** — `ENOTEMPTY` on PVC | Known/intermittent | Baked image fixes this. Short-term: wipe `/data/.npm` in init script |
| **Deployment stuck at "creating"** — status reconciler may miss slow boots | Known | Background reconciler exists; verify it catches these correctly |
| **No re-pair from config mode** | Missing | Add "Reconnect" button in DeploymentConfiguration platform tab |

### P2 — Polish Before Marketing Push

| Issue | Status | Notes |
|-------|--------|-------|
| **Platform connection testing not real** | Stub | `testConnection()` returns mock; implement Discord `/users/@me`, Slack `auth.test`, Telegram `getMe` |
| **Skills file sync not wired** | DB + UI done | Wire `skills/*` file sync in `openclaw.ts:renderConfigs` |
| **Hot config reload research** | Not started | OpenClaw may support file watcher on `/data/config` — if so, eliminates pod restart on credential save |
| **Telegram token uniqueness** | Missing | Prevent two deployments using same bot token (causes 409 conflict) |
| **Conversation history isolation** | Known limitation | Session key is per-user not per-thread; gateway shares context across conversations |

---

## Critical Path to Launch

### Step 1 — Branch & Migrations (1 day)
```
1. Merge k8-debug → develop-monorepo- → main
2. Run: cd jarble-api-main && npm run db:generate
3. Review generated migrations
4. Test against MySQL in staging environment
```

### Step 2 — Production Environment (1 day)
```
1. Provision Hetzner K3s cluster (Terraform in /infrastructure/terraform)
2. Configure kubectl context for cluster
3. Create jarble namespace: kubectl create namespace jarble
4. Set all prod env vars (DATABASE_URL, AUTH0_*, STRIPE_*, ENCRYPTION_KEY, etc.)
5. Deploy API and frontend
```

### Step 3 — Auth0 Email (2 hours)
```
1. Auth0 Dashboard → Branding → Email Provider → Resend (easiest)
2. Test with new email/password signup
3. Verify email flow works end-to-end
```

### Step 4 — Stripe Webhooks (1 hour)
```
1. Stripe Dashboard → Webhooks → Add endpoint
2. URL: https://api.jarble.ai/api/stripe/webhook
3. Events: checkout.session.completed, customer.subscription.updated,
           customer.subscription.deleted, invoice.payment_failed
4. Copy signing secret → STRIPE_WEBHOOK_SECRET in prod .env
5. Do a test checkout end-to-end
```

### Step 5 — K8s Delete Audit (2 hours)
```
1. Read jarble-api-main/src/k8s/deployment.ts delete path
2. Confirm deleteDeployment() removes Deployment + Secret + PVC + Service
3. Test deletion in staging — verify no orphaned resources
4. Check what happens on partial failure (e.g., PVC delete fails)
```

### Step 6 — Smoke Test Full Flow (1 day)
```
1. Sign up with new email → verify email received
2. Go through onboarding wizard → deploy OpenClaw bot
3. Connect Telegram → complete pairing → send a message → bot responds
4. Connect WhatsApp → scan QR → chat
5. Stop bot → confirm K8s scales to 0
6. Delete bot → confirm all K8s resources cleaned up
7. Start Stripe checkout → complete subscription → verify deployment active
8. Cancel subscription → verify deployment stopped
```

### Step 7 — Pre-built Image (1-2 days) — Eliminates 2-3 min first boot
```
1. Build Docker image with openclaw@latest pre-installed
2. Push to ghcr.io/jarble-ai/openclaw:latest
3. Remove npm install step from entrypoint (just start)
4. Test cold start time (target: < 30s)
```

---

## MVP Feature Scope

**IN for v1 launch:**
- Deploy OpenClaw bots to Hetzner K8s
- Connect Telegram and WhatsApp
- BYOK (OpenRouter, OpenAI, Anthropic, Google) + Jarble-managed credits
- Start / stop / restart / delete bots
- Real-time chat via web dashboard
- Management via action buttons (Status, Logs, Prompt, LLM, Restart)
- Stripe billing with hardware-based pricing + free 7-day trial
- Auth0 authentication (email + Google OAuth)

**OUT for v1 (post-launch):**
- Discord, Slack connections (UI exists, reliability not tested)
- Skills marketplace (UI + DB exists, file sync not wired)
- Re-pair platform from config mode
- Hot config reload (no pod restart)
- Mobile app
- MCP marketplace

---

## Launch Estimate

| Phase | Time |
|-------|------|
| Branch merge + migrations | 1 day |
| Production deployment | 1 day |
| Auth0 + Stripe wiring | 0.5 day |
| K8s delete audit + fix | 0.5 day |
| Smoke testing | 1 day |
| Pre-built image | 1-2 days |
| **Total** | **~5-6 days** |

The pre-built image is technically optional for launch but practically required — a 2-3 minute first boot with npm cache corruption risk is a bad first experience. Ship it before the first users.

---

## Post-Launch Priority Queue

1. Pre-built image (if not done before launch)
2. Re-pair from config mode
3. Real platform connection testing (Discord, Slack, Telegram `getMe`)
4. Hot config reload research (eliminate pod restart latency)
5. Skills file sync
6. Telegram token uniqueness enforcement
7. Per-user resource quotas
8. Idle pod shutdown (scale to 0 after 24h inactivity → cold start on next message)
9. Audit logging
10. PVC backups (Longhorn snapshots / Velero)

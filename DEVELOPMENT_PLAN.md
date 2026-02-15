# Jarble Development Plan — MVP to Production

> **Created:** February 2025
> **Status:** Active
> **Tool:** Claude Code (primary development tool)
> **Copy this into Notion for tracking**

---

## Current State Summary

The Jarble platform is approximately **40% complete**. Here's what's working and what's not:

| Area | Status | Notes |
|------|--------|-------|
| Deployment CRUD + K8s | **Done** | Create, deploy, delete pods — all working |
| Auth0 Authentication | **Done** | JWT verification, auto user creation |
| Dashboard UI | **Done** | List, delete, navigate to config |
| Onboarding Wizard | **Done** | 4-step flow, deploys to K8s |
| Database (3 tables) | **Done** | users, deployments, tiers |
| PostgreSQL Support | **Done** | Multi-provider (MySQL, Postgres, SQLite) |
| Config Tabs UI | **Partial** | UI built, most tabs don't persist |
| Platform Integrations | **Not Started** | UI exists, no backend |
| Stripe Billing | **Not Started** | Frontend buttons exist, no API |
| Usage/Credit Tracking | **Not Started** | No tables or logic |
| Tier Enforcement | **Not Started** | Free users can do anything |

---

## Development Phases

### Phase 1: Schema Expansion & Data Layer (Week 1-2)

**Goal:** Expand the database from 3 tables to the full schema needed for production.

#### Steps:

- [ ] **1.1** Review and finalize `deployments` table columns (runtime-specific config like system prompts live on pod PVC, NOT in DB)
  - DB stores only metadata: name, status, runtime, image, tier — no system_prompt, no model config
  - Runtime-specific config (e.g. OpenClaw's soul.md) is read/written via pod storage
  - Files: `schema.ts`, `schema.sqlite.ts`, `schema.pg.ts`
  - Generate migration: `npm run db:generate` and `npm run db:generate:pg`

- [ ] **1.2** Add subscription fields to `users` table: `subscription_status` (varchar, default 'free'), `subscription_id` (varchar, nullable), `current_tier_id` (integer FK), `phone_number` (varchar, nullable)
  - Same 3 schema files + migrations

- [ ] **1.3** Create `platforms` table — stores platform definitions (Discord, Slack, WhatsApp, etc.)
  - Columns: id, name, slug, description, icon, config_schema (JSON), is_active, created_at
  - Seed with initial platforms: discord, slack, telegram, whatsapp, web-chat

- [ ] **1.4** Create `deployment_platforms` table — stores per-deployment platform credentials
  - Columns: id, deployment_id (FK), platform_id (FK), credentials (text, encrypted), config (JSON), is_active, created_at, updated_at
  - This is where Discord tokens, Slack webhook URLs, etc. go

- [ ] **1.5** Create `usage_records` table — tracks token/credit usage per deployment
  - Columns: id, deployment_id (FK), user_id (FK), tokens_used, credits_consumed, action (varchar), metadata (JSON), created_at

- [ ] **1.6** Create `deployment_tasks` table — tracks async K8s operations
  - Columns: id, deployment_id (FK), type (varchar: deploy/restart/delete/update), status (pending/running/completed/failed), error (text), started_at, completed_at

- [ ] **1.7** Update `db/init.ts` to create all new tables in SQLite and seed platforms
  - Update seed data with new fields

- [ ] **1.8** Update `db/index.ts` `getActiveTables()` to export all new tables
  - Ensure `tables` object includes: users, deployments, tiers, platforms, deploymentPlatforms, usageRecords, deploymentTasks

---

### Phase 2: Backend API Expansion (Week 2-3)

**Goal:** Build the tRPC routers for all new functionality.

#### Steps:

- [ ] **2.1** Update `deployment.ts` router — runtime-aware config read/write
  - Add `getConfig` query: reads runtime-specific config from pod PVC (e.g. soul.md for OpenClaw)
  - Add `updateConfig` mutation: writes config to pod PVC via K8s exec or runtime API
  - Add `restart` mutation: re-deploys the K8s pod
  - Config lives on pod storage, NOT in DB — API acts as a proxy between frontend and pod

- [ ] **2.2** Create `platform.ts` router — CRUD for available platforms
  - `list` query: return all active platforms
  - `getById` query: single platform with config schema

- [ ] **2.3** Create `deployment-platform.ts` router — manage per-deployment platform connections
  - `list` query: platforms connected to a deployment
  - `connect` mutation: save encrypted credentials for a platform
  - `disconnect` mutation: remove platform connection
  - `validate` mutation: test credentials against platform API
  - **Important:** Encrypt credentials before storing (use Node.js `crypto` with a `ENCRYPTION_KEY` env var)

- [ ] **2.4** Create `usage.ts` router — credit/usage tracking
  - `getSummary` query: total usage for current billing period
  - `getHistory` query: paginated usage records
  - `checkQuota` query: remaining credits for user's tier

- [ ] **2.5** Update `user.ts` router — add subscription awareness
  - `getProfile` should return subscription status and current tier
  - Add `getSubscription` query: detailed subscription info
  - Update `me` to include tier info

- [ ] **2.6** Update `tier.ts` router — add enforcement helpers
  - Add `getLimits` query: returns max deployments, credits, features for a tier
  - Add tier validation middleware (check max deployments before allowing create)

- [ ] **2.7** Update K8s `deployment.ts` — tier-based resources + runtime selection
  - Add tier-based resource limits (Free: 256Mi/500m, Pro: 2Gi/1000m, Agency: 4Gi/2000m)
  - Update container image selection based on `runtime` field
  - Add K8s exec helper for reading/writing files on pod PVC (for runtime config)

---

### Phase 3: Stripe Integration (Week 3-4)

**Goal:** Complete billing flow — checkout, webhooks, subscription management.

#### Steps:

- [ ] **3.1** Install `stripe` npm package in API
  - Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to env validation
  - Create `src/services/stripe.ts` service module

- [ ] **3.2** Create Express routes for Stripe (NOT tRPC — webhooks need raw body)
  - `POST /api/stripe/create-checkout-session` — creates Stripe checkout for selected tier
  - `POST /api/stripe/create-portal-session` — creates billing portal link
  - `POST /api/stripe/webhook` — handles Stripe events (needs `express.raw()` middleware)

- [ ] **3.3** Implement webhook handler for key events:
  - `checkout.session.completed` → update user subscription status + tier
  - `customer.subscription.updated` → sync tier changes
  - `customer.subscription.deleted` → downgrade to free tier
  - `invoice.payment_failed` → flag account, send warning

- [ ] **3.4** Create Stripe products/prices in Stripe Dashboard
  - Map to tiers: Free (no Stripe), Pro ($19/mo), Agency ($99/mo)
  - Store Stripe price IDs in tiers table or env vars

- [ ] **3.5** Add tier enforcement middleware
  - Before `deployment.create`: check if user is within their tier's deployment limit
  - Before `deployment.deploy`: check if user has credits remaining
  - Return clear error messages: "Upgrade to Pro to create more deployments"

- [ ] **3.6** Update frontend `SubscribeButton.tsx` to hit correct API endpoints
  - Currently calls `/api/stripe/checkout` — update to match actual route
  - Handle success/cancel redirect URLs

---

### Phase 4: Frontend Wiring (Week 4-5)

**Goal:** Connect all the existing UI components to the real backend.

#### Steps:

- [ ] **4.1** Wire `GeneralTab.tsx` — runtime-aware config
  - Use `trpc.deployment.getConfig` to load runtime config from pod (e.g. soul.md for OpenClaw)
  - Use `trpc.deployment.updateConfig` to write back
  - Show different fields based on `runtime` (OpenClaw shows system prompt, other runtimes show their own config)

- [ ] **4.2** Wire `ModelTab.tsx` — runtime-aware model selection
  - Model config lives on pod storage, not DB
  - Read/write via `trpc.deployment.getConfig` / `updateConfig`
  - Integrate with OpenRouter API key validation

- [ ] **4.3** Wire `PlatformsTab.tsx` — real credential storage
  - Replace `setTimeout` mocks with `trpc.deploymentPlatform.connect` calls
  - Add real validation via `trpc.deploymentPlatform.validate`
  - Show connection status from backend
  - Add disconnect functionality

- [ ] **4.4** Wire `SkillsTab.tsx` — persist skill configuration
  - Decide: skills as JSON config on deployment? Or separate table?
  - Save skill toggles to deployment config
  - Load on tab open

- [ ] **4.5** Wire `AdvancedTab.tsx` — functional controls
  - Rate limiting: store in deployment config, inject to K8s
  - Webhook URL: store in deployment, pass to pod
  - "Reset Deployment Data" → calls K8s to wipe PVC and restart
  - Remove duplicate delete button

- [ ] **4.6** Fix `OnboardingWizard.tsx` Step 4 (Connect WhatsApp)
  - Step 4 currently shows mock QR code
  - Options: (a) skip for now and redirect to config page, or (b) implement WhatsApp connection flow
  - At minimum: show clear "Configure in Settings" message

- [ ] **4.7** Add subscription/billing pages
  - Pricing page: integrate with Stripe checkout
  - Account settings: show current plan, manage subscription via Stripe portal
  - Usage dashboard: show credits used / remaining

- [ ] **4.8** Add proper error handling
  - tRPC error boundaries on all pages
  - Toast notifications for all mutations
  - Loading skeletons for all queries

---

### Phase 5: Production Hardening (Week 5-7)

**Goal:** Make the platform production-ready and secure.

#### Steps:

- [ ] **5.1** Credential encryption service
  - Create `src/services/encryption.ts`
  - AES-256-GCM encryption for platform credentials
  - `ENCRYPTION_KEY` env var (32-byte key)
  - Encrypt before DB write, decrypt on read

- [ ] **5.2** Rate limiting
  - Add `express-rate-limit` to API
  - Tier-based limits: Free (100 req/min), Pro (500), Agency (2000)
  - Apply to tRPC endpoint and Stripe routes

- [ ] **5.3** Input validation hardening
  - Audit all Zod schemas for proper constraints
  - Add max length limits to all string fields
  - Sanitize user inputs (deployment names, descriptions)

- [ ] **5.4** Logging & monitoring
  - Structured logging (pino) — already using it
  - Add request ID tracking
  - Log all K8s operations with deployment IDs
  - Add health check for DB connectivity

- [ ] **5.5** Database migrations for production
  - Finalize Postgres schema
  - Run `db:generate:pg` for all schema changes
  - Test migrations against RDS Postgres
  - Create rollback scripts

- [ ] **5.6** K8s namespace isolation
  - Each user gets their own namespace (or label-based isolation)
  - Network policies: pods can't talk to each other
  - Resource quotas per namespace

- [ ] **5.7** Terraform infrastructure
  - Codify Hetzner VPS provisioning
  - K3s cluster auto-join on new nodes
  - Longhorn storage + block storage setup
  - Traefik ingress configuration

- [ ] **5.8** CI/CD pipeline
  - GitHub Actions: lint → type-check → test → build → deploy
  - API: Docker build → push to registry → K8s rolling update
  - Frontend: Vercel auto-deploy on push

- [ ] **5.9** Backup strategy
  - Longhorn snapshot schedule (daily)
  - RDS automated backups
  - Disaster recovery runbook

---

### Phase 6: Launch Prep (Week 7-8)

**Goal:** Get ready for first users.

#### Steps:

- [ ] **6.1** End-to-end testing
  - Sign up → choose tier → create deployment → configure → deploy → verify running
  - Stripe checkout → webhook → subscription active
  - Delete deployment → K8s resources cleaned up

- [ ] **6.2** Documentation
  - User-facing: "Getting Started" guide
  - API docs: auto-generated from tRPC types
  - Internal: runbook for common operations

- [ ] **6.3** Monitoring & alerting
  - Uptime monitoring (API health endpoint)
  - K8s pod failure alerts
  - Stripe webhook failure alerts
  - Disk usage alerts (Longhorn volumes)

- [ ] **6.4** Security audit
  - Auth0 configuration review
  - CORS policy verification
  - Rate limit testing
  - Credential encryption verification

- [ ] **6.5** Soft launch
  - Deploy to production K3s cluster
  - Invite 5-10 beta users
  - Monitor logs and fix issues
  - Iterate on UX based on feedback

---

## File Change Tracker

This tracks which files need changes in each phase:

### Phase 1 Files
```
jarble-api-main/src/db/schema.ts          ← add columns, new tables
jarble-api-main/src/db/schema.sqlite.ts   ← mirror changes
jarble-api-main/src/db/schema.pg.ts       ← mirror changes
jarble-api-main/src/db/init.ts            ← new tables + seeds
jarble-api-main/src/db/index.ts           ← export new tables
drizzle/                                   ← new MySQL migration
drizzle-pg/                                ← new Postgres migration
```

### Phase 2 Files
```
jarble-api-main/src/trpc/routers/deployment.ts    ← expand mutations
jarble-api-main/src/trpc/routers/user.ts           ← subscription fields
jarble-api-main/src/trpc/routers/tier.ts           ← enforcement
jarble-api-main/src/trpc/routers/platform.ts       ← NEW
jarble-api-main/src/trpc/routers/deployment-platform.ts ← NEW
jarble-api-main/src/trpc/routers/usage.ts          ← NEW
jarble-api-main/src/trpc/index.ts                  ← register new routers
jarble-api-main/src/k8s/deployment.ts              ← tier-based resources
```

### Phase 3 Files
```
jarble-api-main/src/services/stripe.ts     ← NEW
jarble-api-main/src/index.ts               ← add Stripe routes
jarble-api-main/package.json               ← add stripe dependency
Jarble-mvp/views/SubscribeButton.tsx       ← fix endpoints
```

### Phase 4 Files
```
Jarble-mvp/views/deployment-config/GeneralTab.tsx
Jarble-mvp/views/deployment-config/ModelTab.tsx
Jarble-mvp/views/deployment-config/PlatformsTab.tsx
Jarble-mvp/views/deployment-config/SkillsTab.tsx
Jarble-mvp/views/deployment-config/AdvancedTab.tsx
Jarble-mvp/views/OnboardingWizard.tsx
Jarble-mvp/views/Dashboard.tsx             ← usage indicators
```

### Phase 5-6 Files
```
jarble-api-main/src/services/encryption.ts ← NEW
jarble-api-main/Dockerfile                 ← production build
terraform/                                 ← NEW directory
.github/workflows/                         ← CI/CD
```

---

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database | PostgreSQL (RDS) | Production-grade, AWS managed, JSON support |
| Local dev DB | SQLite in-memory | Zero-config, fast iteration |
| Billing | Stripe Checkout + Webhooks | Industry standard, hosted UI, PCI compliant |
| Secrets | K8s Secrets (not DB) | Never store API keys in database |
| Storage | Longhorn on Hetzner block storage | Persistent across node failures |
| Auth | Auth0 JWT | Handles OAuth/social login, free tier available |
| API | tRPC over Express | End-to-end type safety, great DX |
| Infra | Terraform + K3s + Hetzner | Cost-effective, horizontally scalable |
| Container image | Per-deployment override via `image` field | Supports multiple runtimes beyond OpenClaw |

---

## Capacity Planning

| Users | Concurrent Pods | Nodes (CX31) | RAM | Storage | Monthly Cost |
|-------|----------------|---------------|-----|---------|-------------|
| 10 | ~5 | 1 | 8GB | 300GB | ~$15 |
| 50 | ~20 | 2-3 | 16-24GB | 1.5TB | ~$60 |
| 100 | ~35 | 3-5 | 24-40GB | 3TB | ~$150 |
| 500 | ~175 | 12-15 | 96-120GB | 15TB | ~$600 |

**Bottleneck:** Node RAM (2-4GB per OpenClaw pod)
**Scaling:** `terraform apply -var="worker_count=N"` to add nodes

---

## Quick Reference: What Claude Code Should Do

When working on Jarble with Claude Code, follow these patterns:

1. **Always test with SQLite first** — run `USE_SQLITE=true npm run dev` for fast iteration
2. **Schema changes** — update all 3 schema files (MySQL, SQLite, Postgres) together
3. **After API changes** — refresh frontend deps: `rm -rf node_modules/.pnpm/jarble-api* node_modules/jarble-api && pnpm install`
4. **Use `tables` import** — never import directly from a specific schema file in routers
5. **Type casting** — use `(ctx.db as any)` for Drizzle operations that TypeScript fights about
6. **tRPC routers** — register in `src/trpc/index.ts` after creating
7. **K8s resources** — always clean up on delete (Deployment → Secret → PVC)
8. **Stripe routes** — use Express routes (not tRPC) because webhooks need raw body parsing

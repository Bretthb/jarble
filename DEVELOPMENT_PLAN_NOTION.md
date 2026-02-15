# Jarble Development Plan — MVP to Production

> **Last Updated:** February 2025
> **Primary Dev Tool:** Claude Code
> **Platform:** No-code AI deployment platform (OpenClaw + future runtimes)

---

## Where We Are Now (~40% Complete)

### What's Working

- **Deployment CRUD + K8s** — Create, deploy, delete pods on K3s. PVC + Secret + Deployment all wired up
- **Auth0 Authentication** — JWT verification, auto user creation on first login
- **Dashboard** — Lists deployments, status badges (running/creating/failed), delete with confirmation
- **Onboarding Wizard** — 4-step flow: Name → Runtime → Deploy → Connect. Actually triggers K8s
- **Database** — 3 tables (users, deployments, tiers) across MySQL, PostgreSQL, and SQLite
- **Multi-DB Support** — `DB_PROVIDER` env var switches between MySQL, Postgres, SQLite
- **Config UI** — 5-tab layout (General, Model, Platforms, Skills, Advanced) built but mostly not wired
- **tRPC API** — 5 routers: deployment, user, tier, template, openrouter

### What's Not Working

- **Stripe** — Frontend buttons exist but backend endpoints don't. Clicking Subscribe will crash
- **Platform Integrations** — PlatformsTab UI built, but all API calls are `setTimeout` mocks
- **Model/Config Persistence** — ModelTab, SkillsTab, AdvancedTab are all local state only
- **Tier Enforcement** — Free users can create unlimited deployments
- **Usage Tracking** — No tables, no logic, no UI

---

## Key Architecture Decisions

### Data Split: DB vs Pod Storage vs ConfigMaps

This is the most important design decision. Three types of data, three storage locations:

| What | Where | Why |
|------|-------|-----|
| **Deployment metadata** (name, status, runtime, image, tier, user) | **PostgreSQL (RDS)** | Relational, queryable, survives everything |
| **Runtime config** (soul.md, model settings, skills config) | **Pod PVC (block storage)** | Runtime-specific, persists across restarts, owned by the container |
| **Base templates** (default soul.md, default configs per runtime) | **K8s ConfigMaps** | Easy to update without rebuilding images, versioned per runtime |

**Why not store runtime config in the DB?**
- Different runtimes have completely different config formats
- OpenClaw uses `soul.md`, LangChain might use `config.json`, custom runtimes could use anything
- Config belongs with the pod — it's part of the runtime's persistent data on block storage
- Adding a new runtime doesn't require a schema migration

### Deploy Flow: Image + ConfigMap + Wizard Data

```
User clicks "Deploy" in wizard
    │
    ├─ 1. API creates K8s Deployment
    │     └─ Image pulled from container registry (e.g. registry.jarble.ai/openclaw:v1.2)
    │
    ├─ 2. Init container runs
    │     ├─ Mounts ConfigMap "openclaw-defaults" at /defaults
    │     ├─ Mounts PVC at /data
    │     └─ If /data is empty: copies /defaults/* → /data/
    │
    ├─ 3. API applies wizard inputs via K8s exec
    │     └─ Writes user's system prompt to /data/soul.md
    │
    └─ 4. Main container starts
          └─ OpenClaw reads config from /data/ — ready to go
```

**On container crash/restart:**
- K8s pulls same image (stateless code)
- Re-mounts same PVC (persistent data untouched)
- OpenClaw boots with all user's data intact

**On image update:**
- New code runs, but PVC data is preserved
- `.initialized` flag prevents overwriting user's customized config

### Multiple Templates

Each runtime can have multiple starter templates as separate ConfigMaps:

```
ConfigMap: openclaw-defaults           ← generic personal assistant
ConfigMap: openclaw-support-template   ← customer support focused
ConfigMap: openclaw-sales-template     ← sales agent focused
ConfigMap: langchain-defaults          ← LangChain starter
```

The `runtime` + `template` fields on the deployment table tell the init container which ConfigMap to use.

### Config Read/Write (After Deploy)

When user edits config in the frontend:

```
Frontend → trpc.deployment.updateConfig({ id, file: "soul.md", content: "..." })
    → API does K8s exec into pod: writes content to /data/soul.md
    → Pod picks up changes (hot-reload or restart)
```

When user opens config page:

```
Frontend → trpc.deployment.getConfig({ id, file: "soul.md" })
    → API does K8s exec into pod: reads /data/soul.md
    → Returns content to frontend
```

---

## Current Database Schema (3 Tables)

```sql
-- What we have now
users (id, email, name, auth0_id, stripe_customer_id, created_at, updated_at)
deployments (id, user_id, name, description, template, runtime, image, status, error, tier_id, created_at, updated_at)
tiers (id, name, description, price, credits_per_month, features, is_active, created_at)
```

---

## Phase 1: Schema Expansion (Week 1-2)

**Goal:** Go from 3 tables to 7. Add subscription tracking, platform credentials, usage logging.

### 1.1 — Expand `users` table

Add columns:
- `subscription_status` varchar(50) default 'free' — free/active/past_due/canceled
- `subscription_id` varchar(255) nullable — Stripe subscription ID
- `current_tier_id` integer FK → tiers.id — which plan they're on
- `phone_number` varchar(50) nullable — for future SMS/WhatsApp verification

Files to edit: `schema.ts`, `schema.sqlite.ts`, `schema.pg.ts`

### 1.2 — Expand `tiers` table

Add column:
- `max_deployments` integer not null default 1 — how many deployments this tier allows

Seed values (placeholder — pricing TBD):
- Free: max_deployments=1, price=TBD, credits=TBD
- Pro: max_deployments=1, price=TBD, credits=TBD
- Agency: max_deployments=2, price=TBD, credits=TBD

### 1.3 — Review `deployments` table

Current columns are good. **No new columns needed** — runtime config lives on pod PVC, not in DB.

Confirm existing columns are correct:
- `runtime` — which container type (openclaw, langchain, custom)
- `image` — container registry image URL override
- `template` — which ConfigMap template to use for init
- `status` — creating/pending/running/failed/stopped
- `tier_id` — links to user's tier for resource limits

### 1.4 — Create `platforms` table

Platform definitions (Discord, Slack, WhatsApp, etc.):

```
platforms
├── id (serial PK)
├── name (varchar 100) — "Discord"
├── slug (varchar 50, unique) — "discord"
├── description (text)
├── icon (varchar 255) — icon URL or name
├── config_schema (text/JSON) — defines what credentials this platform needs
├── is_active (boolean, default true)
└── created_at (timestamp)
```

Seed with: discord, slack, telegram, whatsapp, web-chat, teams, facebook-messenger

### 1.5 — Create `deployment_platforms` table

Per-deployment platform connections with encrypted credentials:

```
deployment_platforms
├── id (serial PK)
├── deployment_id (FK → deployments.id)
├── platform_id (FK → platforms.id)
├── credentials (text) — AES-256-GCM encrypted JSON
├── config (text/JSON) — non-sensitive platform config
├── is_active (boolean, default true)
├── created_at (timestamp)
└── updated_at (timestamp)
```

### 1.6 — Create `usage_records` table

Token/credit tracking per deployment:

```
usage_records
├── id (serial PK)
├── deployment_id (FK → deployments.id)
├── user_id (FK → users.id)
├── tokens_used (integer)
├── credits_consumed (numeric)
├── action (varchar 100) — "chat", "completion", "embedding"
├── metadata (text/JSON)
└── created_at (timestamp)
```

### 1.7 — Create `deployment_tasks` table

Tracks async K8s operations for audit trail:

```
deployment_tasks
├── id (serial PK)
├── deployment_id (FK → deployments.id)
├── type (varchar 50) — deploy/restart/delete/update/config-write
├── status (varchar 50) — pending/running/completed/failed
├── error (text)
├── started_at (timestamp)
└── completed_at (timestamp)
```

### 1.8 — Update init.ts and index.ts

- Create all new tables in SQLite for local dev
- Seed platforms table with 7 platform definitions
- Seed tiers with max_deployments values
- Update `getActiveTables()` to export all 8 tables
- Generate migrations: `npm run db:generate` + `npm run db:generate:pg`

---

## Phase 2: Backend API Expansion (Week 2-3)

**Goal:** New tRPC routers + K8s exec for runtime config + deploy gate.

### 2.1 — Deploy Gate: tier enforcement before deployment

This is the critical check that runs before any deployment is created or deployed:

```
User clicks "Deploy"
    │
    ├─ 1. Is user authenticated? (tRPC middleware — already done)
    │
    ├─ 2. What tier are they on?
    │     └─ users.current_tier_id → tiers.max_deployments
    │     └─ If no subscription (current_tier_id is null) → treat as Free tier
    │
    ├─ 3. How many active deployments do they have?
    │     └─ SELECT COUNT(*) FROM deployments WHERE user_id = ? AND status != 'deleted'
    │
    ├─ 4. Are they within their limit?
    │     ├─ YES → proceed with deploy
    │     └─ NO → return error with upgrade prompt
    │           → Frontend shows: "You've reached your deployment limit. Upgrade to unlock more."
    │           → CTA button → Stripe checkout for next tier
    │
    └─ 5. Do they have credits remaining? (Phase 3+)
          └─ Check usage_records vs tier.credits_per_month
```

Implementation:
- Create `src/middleware/tierCheck.ts` — reusable middleware for tier enforcement
- Hook into `deployment.create` and `deployment.deploy` mutations
- Return structured error: `{ code: "TIER_LIMIT", currentCount, maxAllowed, currentTier, nextTier }`
- Frontend uses this to show the upgrade modal with Stripe checkout link

### 2.2 — Deployment router: runtime-aware config

Add to existing `deployment.ts` router:
- `getConfig` query — K8s exec into pod, read file from PVC, return content
- `updateConfig` mutation — K8s exec into pod, write file to PVC
- `restart` mutation — delete pod (K8s auto-recreates from Deployment)
- `getFiles` query — list files in pod's /data directory

The API acts as a proxy between the frontend and the pod's filesystem.

### 2.3 — New `platform.ts` router

- `list` query — all active platforms with their config schemas
- `getById` query — single platform details

### 2.4 — New `deployment-platform.ts` router

- `list` query — platforms connected to a specific deployment
- `connect` mutation — encrypt credentials with AES-256-GCM, store in DB
- `disconnect` mutation — remove platform connection
- `validate` mutation — test credentials against platform's API

Encryption: Node.js `crypto`, AES-256-GCM, `ENCRYPTION_KEY` env var (32 bytes)

### 2.5 — New `usage.ts` router

- `getSummary` query — total usage for current billing period
- `getHistory` query — paginated usage records
- `checkQuota` query — remaining credits for user's tier

### 2.6 — Update `user.ts` router

- `getProfile` returns subscription status + current tier
- New `getSubscription` query — detailed billing info
- `me` includes tier data

### 2.7 — Update `tier.ts` router

- `getLimits` query — max deployments, credits, features for a tier
- Tier validation middleware — check limits before allowing deployment creation

### 2.8 — K8s layer updates

- Tier-based resource limits:
  - Free: 256Mi RAM / 500m CPU
  - Pro: 2Gi RAM / 1000m CPU
  - Agency: 4Gi RAM / 2000m CPU
- Image selection from `runtime` field
- **New: K8s exec helper** for reading/writing files on pod PVC
- **New: Init container spec** that mounts ConfigMap → copies to PVC on first boot

---

## Phase 3: Stripe Integration (Week 3-4)

**Goal:** Working checkout, webhooks, subscription lifecycle.

### 3.1 — Stripe service module

- Install `stripe` package
- Create `src/services/stripe.ts`
- Validate `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on startup

### 3.2 — Express routes (NOT tRPC — webhooks need raw body)

- `POST /api/stripe/create-checkout-session` — redirects user to Stripe
- `POST /api/stripe/create-portal-session` — Stripe billing portal
- `POST /api/stripe/webhook` — receives Stripe events (with `express.raw()`)

### 3.3 — Webhook handler

| Stripe Event | Action |
|-------------|--------|
| `checkout.session.completed` | Set user subscription_status='active', assign tier |
| `customer.subscription.updated` | Sync tier changes |
| `customer.subscription.deleted` | Downgrade to free tier |
| `invoice.payment_failed` | Flag account, warn user |

### 3.4 — Stripe Dashboard setup

- Create products: Pro ($19/mo), Agency ($99/mo)
- Store Stripe price IDs in tiers table or env vars
- Free tier has no Stripe product

### 3.5 — Tier enforcement middleware

- Before `deployment.create`: "You've reached 1/1 deployments on Free. Upgrade to Pro."
- Before `deployment.deploy`: "No credits remaining. Upgrade or wait until next billing cycle."

### 3.6 — Frontend integration

- Fix `SubscribeButton.tsx` to call correct endpoints
- Handle success/cancel redirect URLs

---

## Phase 4: Frontend Wiring (Week 4-5)

**Goal:** Connect existing UI components to real backend.

### 4.1 — GeneralTab: runtime-aware config

- Call `trpc.deployment.getConfig` to load soul.md (for OpenClaw) or equivalent
- Call `trpc.deployment.updateConfig` to save
- Show different fields based on `runtime` value

### 4.2 — ModelTab: runtime-aware model selection

- Model config is part of pod storage config
- Read/write via getConfig/updateConfig
- Integrate OpenRouter API key validation (already have the router)

### 4.3 — PlatformsTab: real credential storage

- Replace all `setTimeout` mocks with `trpc.deploymentPlatform.connect`
- Real credential validation via `trpc.deploymentPlatform.validate`
- Show live connection status from backend

### 4.4 — SkillsTab: persist to pod config

- Skills are part of the runtime config (stored on PVC)
- Read/write via getConfig/updateConfig

### 4.5 — AdvancedTab: functional controls

- Rate limiting → runtime config on PVC
- Webhook URL → runtime config on PVC
- "Reset Deployment Data" → wipe PVC, re-init from ConfigMap

### 4.6 — OnboardingWizard Step 4

- Currently shows mock QR code for WhatsApp
- Replace with "Configure in Settings →" redirect to config page
- Real WhatsApp pairing can come later

### 4.7 — Subscription/billing pages

- Wire Pricing page to Stripe checkout
- Account settings with current plan + Stripe portal link
- Usage dashboard showing credits used/remaining

### 4.8 — Error handling

- tRPC error boundaries on all pages
- Toast notifications for all mutations
- Loading skeletons for queries

---

## Phase 5: Production Hardening (Week 5-7)

### 5.1 — Credential encryption service
`src/services/encryption.ts` — AES-256-GCM, `ENCRYPTION_KEY` env var

### 5.2 — Rate limiting
`express-rate-limit` — Free: 100 req/min, Pro: 500, Agency: 2000

### 5.3 — Input validation
Audit all Zod schemas. Max lengths, sanitization on deployment names/descriptions.

### 5.4 — Logging & monitoring
Request ID tracking, K8s operation logging, DB health check endpoint.

### 5.5 — Database migrations
Finalize Postgres schema, test against RDS, create rollback scripts.

### 5.6 — K8s isolation
Network policies (pods can't talk to each other), resource quotas.

### 5.7 — Terraform
Hetzner VPS provisioning, K3s auto-join, Longhorn + block storage, Traefik ingress.

### 5.8 — CI/CD
GitHub Actions: lint → typecheck → test → build → deploy. Vercel for frontend.

### 5.9 — Backups
Longhorn daily snapshots, RDS automated backups, disaster recovery runbook.

---

## Phase 6: Launch Prep (Week 7-8)

### 6.1 — End-to-end testing
Full user journey: sign up → pick tier → create deployment → configure → deploy → verify running.

### 6.2 — Documentation
Getting Started guide, auto-generated API docs from tRPC types, internal runbook.

### 6.3 — Monitoring & alerting
Uptime checks, pod failure alerts, Stripe webhook failure alerts, disk usage alerts.

### 6.4 — Security audit
Auth0 config review, CORS verification, rate limit testing, encryption verification.

### 6.5 — Soft launch
Deploy to production. Invite 5-10 beta users. Monitor, fix, iterate.

---

## Infrastructure & Capacity

### Storage Architecture

```
Container Registry (Harbor/GHCR)
    └── Runtime images (openclaw:v1.2, langchain:v1.0, etc.)

K8s ConfigMaps
    └── Base template configs per runtime (default soul.md, etc.)

Longhorn PVC (Hetzner block storage)
    └── Per-deployment persistent data (/data/soul.md, conversations, etc.)

AWS RDS (PostgreSQL)
    └── Platform data (users, deployments, tiers, credentials, usage)
```

### Capacity Planning

| Users | Concurrent Pods | Hetzner Nodes | RAM | Storage | Cost/mo |
|-------|----------------|---------------|-----|---------|---------|
| 10 | ~5 | 1 | 8GB | 300GB | ~$15 |
| 50 | ~20 | 2-3 | 16-24GB | 1.5TB | ~$60 |
| 100 | ~35 | 3-5 | 24-40GB | 3TB | ~$150 |
| 500 | ~175 | 12-15 | 96-120GB | 15TB | ~$600 |

**Bottleneck:** Node RAM (2-4GB per OpenClaw pod)
**Scaling:** `terraform apply -var="worker_count=N"`
**Storage:** ~30GB block storage per user

---

## Claude Code Reference

When working on this codebase with Claude Code:

1. **Test with SQLite first** — `USE_SQLITE=true npm run dev`
2. **Schema changes** — update all 3 files: `schema.ts`, `schema.sqlite.ts`, `schema.pg.ts`
3. **After API changes** — refresh frontend: `rm -rf node_modules/.pnpm/jarble-api* node_modules/jarble-api && pnpm install`
4. **Use `tables` import** — never import directly from a specific schema file
5. **Type casting** — `(ctx.db as any)` for Drizzle ops that TypeScript fights
6. **Register routers** — add to `src/trpc/index.ts` after creating
7. **K8s cleanup** — always delete in order: Deployment → Secret → PVC
8. **Stripe routes** — Express routes, not tRPC (webhooks need raw body)
9. **Runtime config** — never store in DB, always read/write via K8s exec to pod PVC
10. **ConfigMaps** — base templates per runtime, copied to PVC on first boot only

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, Tailwind, shadcn/ui |
| API | Express 4, tRPC 11, Zod 3 |
| Database | Drizzle ORM 0.45 → PostgreSQL (prod) / SQLite (dev) |
| Auth | Auth0 + jose JWT verification |
| K8s | K3s on Hetzner, @kubernetes/client-node |
| Storage | Longhorn PVCs on Hetzner block storage |
| Billing | Stripe Checkout + Webhooks |
| Infra | Terraform, Traefik ingress |
| CI/CD | GitHub Actions, Vercel |
| Logging | Pino 8 |
| Language | TypeScript 5.3 (strict) |

# Jarble Platform Architecture

> **Last Updated:** February 2025
> Current state of the monorepo: `jarble-api-main` (Express/tRPC API) + `Jarble-mvp` (Next.js frontend)

---

## 1. High-Level Architecture

Jarble is a platform for deploying containerized AI workloads (currently OpenClaw, extensible to other runtimes) with a no-code onboarding experience. Users create "deployments" that run as Kubernetes pods on a K3s cluster. OpenClaw is initially configured with WhatsApp as its user interface (as a starting point), but the platform is designed to support additional interfaces in the future.

**Production Stack:**

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 on Vercel |
| API | Express + tRPC on K3s (Hetzner) |
| Database | AWS RDS (MySQL) / In-memory SQLite (dev) |
| Compute | K3s pods (Hetzner) with Longhorn storage |
| Auth | Auth0 (JWT) |
| External | OpenRouter (LLM), Stripe (billing) |

---

## 2. Monorepo Structure

```
develop-monorepo/
├── jarble-api-main/             # Express + tRPC backend
│   ├── src/
│   │   ├── index.ts             # Server entry (Express, CORS, tRPC handler)
│   │   ├── db/
│   │   │   ├── schema.ts        # MySQL schema (Drizzle ORM)
│   │   │   ├── schema.sqlite.ts # SQLite schema (dev mirror)
│   │   │   ├── index.ts         # DB client factory + table exports
│   │   │   └── init.ts          # SQLite table creation + seed data
│   │   ├── trpc/
│   │   │   ├── index.ts         # Router composition + AppRouter type export
│   │   │   ├── context.ts       # Request context (user + db)
│   │   │   ├── middleware.ts     # publicProcedure / protectedProcedure
│   │   │   └── routers/
│   │   │       ├── deployment.ts # Deployment CRUD + K8s operations
│   │   │       ├── user.ts      # User profile
│   │   │       ├── tier.ts      # Subscription tiers
│   │   │       ├── template.ts  # Hardcoded bot templates
│   │   │       └── openrouter.ts# OpenRouter health/models/validate
│   │   ├── k8s/
│   │   │   └── deployment.ts    # K8s client (PVC, Secret, Deployment CRUD)
│   │   ├── services/
│   │   │   └── auth.ts          # Auth0 JWT verification + user upsert
│   │   └── utils/
│   │       ├── env.ts           # Zod env validation
│   │       └── logger.ts        # Pino logger
│   ├── k8s/
│   │   └── deployment.yaml      # K8s manifests for the API pod itself
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
│
├── Jarble-mvp/                  # Next.js 15 frontend
│   ├── app/                     # App Router pages
│   │   ├── layout.tsx           # Root layout (fonts, meta, providers)
│   │   ├── providers.tsx        # Auth0 → tRPC → Theme → Error Boundary
│   │   ├── globals.css          # Tailwind v4 theme + CSS variables
│   │   ├── page.tsx             # Landing page (/)
│   │   ├── login/page.tsx       # Auth0 login (/login)
│   │   ├── dashboard/page.tsx   # Dashboard (/dashboard)
│   │   ├── pricing/page.tsx     # Pricing (/pricing)
│   │   ├── about/page.tsx       # About (/about)
│   │   ├── onboarding/
│   │   │   └── [id]/page.tsx    # Wizard (/onboarding/[id])
│   │   └── d/[id]/
│   │       └── configure/page.tsx # Config (/d/[id]/configure)
│   ├── views/                   # Page-level view components
│   │   ├── Home.tsx             # Landing page content
│   │   ├── Login.tsx            # Login view
│   │   ├── Dashboard.tsx        # Deployment list + management
│   │   ├── OnboardingWizard.tsx # 4-step deployment creation
│   │   ├── DeploymentConfiguration.tsx # Config hub (5 tabs)
│   │   ├── Pricing.tsx          # Pricing tiers
│   │   ├── About.tsx            # About page
│   │   └── deployment-config/   # Configuration tab components
│   │       ├── types.ts         # DeploymentFormData, Tab types, platform configs
│   │       ├── GeneralTab.tsx   # Name, description, system prompt
│   │       ├── ModelTab.tsx     # Provider, model, temperature, max tokens
│   │       ├── PlatformsTab.tsx # Platform integrations + credential modal
│   │       ├── SkillsTab.tsx    # Pre-built skill toggles
│   │       └── AdvancedTab.tsx  # Rate limits, webhooks, deployment info
│   ├── components/              # Shared components
│   │   ├── ui/                  # 50+ shadcn/ui components
│   │   ├── auth/                # Auth0Provider, LoginButton, LogoutButton
│   │   ├── WizardLoader.tsx     # Animated deployment loader
│   │   ├── ErrorBoundary.tsx    # Error boundary
│   │   └── ...                  # IntegrationsMarquee, DevNav, etc.
│   ├── lib/
│   │   ├── trpc.ts              # tRPC React client (imports AppRouter from API)
│   │   ├── utils.ts             # cn() helper
│   │   └── platformConfigs.ts   # Platform credential schemas + validation
│   ├── contexts/
│   │   └── ThemeContext.tsx      # Light/dark theme provider
│   ├── hooks/
│   │   └── useMobile.tsx        # Breakpoint detection (768px)
│   ├── package.json
│   └── tsconfig.json
│
├── ARCHITECTURE.md              # Full docs with Mermaid diagrams (GitHub)
├── ARCHITECTURE-notion.md       # Notion-importable version (this file)
└── MIGRATION_PLAN.md            # Future 7-table schema migration plan
```

---

## 3. System Architecture Diagram

> **Diagram: System Architecture**
> To render this diagram, paste the code below into [mermaid.live](https://mermaid.live/edit) and embed the resulting image.

```
flowchart TB
    subgraph Internet
        User([User / Browser])
    end
    subgraph Vercel
        NextJS[Next.js 15 App Router]
    end
    subgraph Hetzner K3s Cluster
        subgraph API Pod x2 replicas
            Express[Express Server :3001]
            tRPC[tRPC Router]
            DrizzleORM[Drizzle ORM]
            K8sClient[@kubernetes/client-node]
        end
        subgraph Deployment Pods
            D1[dep-abc123 OpenClaw]
            D2[dep-def456 OpenClaw]
            D3[dep-ghi789 custom]
        end
        Longhorn[(Longhorn Block Storage)]
        Traefik[Traefik Ingress]
    end
    subgraph External Services
        Auth0[Auth0 JWT Auth]
        RDS[(AWS RDS MySQL)]
        OpenRouter[OpenRouter LLM API]
        Stripe[Stripe Billing]
        %% WhatsApp Business API removed — WhatsApp is just the initial UI for OpenClaw, not an external service dependency
    end
    User -->|HTTPS| NextJS
    NextJS -->|tRPC over HTTPS with Bearer JWT| Traefik
    Traefik --> Express
    Express --> tRPC
    tRPC --> DrizzleORM
    tRPC --> K8sClient
    DrizzleORM --> RDS
    K8sClient -->|Create / Delete / Status| Deployment Pods
    Deployment Pods --> Longhorn
    Deployment Pods --> OpenRouter
    %% Deployment Pods --> WhatsApp (removed)
    tRPC -.->|Verify JWT| Auth0
    tRPC -.->|Health / Models| OpenRouter
    tRPC -.->|Billing| Stripe
```

**How data flows:**

1. User visits Next.js frontend on Vercel
2. Frontend sends tRPC requests over HTTPS with Bearer JWT to Hetzner K3s
3. Traefik ingress routes to Express API pod
4. Express hands off to tRPC router
5. tRPC verifies JWT via Auth0 JWKS, then processes request
6. Drizzle ORM queries AWS RDS (MySQL) for data
7. K8s client creates/manages deployment pods on the cluster
8. Deployment pods use Longhorn storage and connect to OpenRouter

---

## 4. API Architecture

### Request Lifecycle

1. **Browser** sends `POST /trpc/deployment.create` with `Authorization: Bearer {JWT}`
2. **Express** receives request, checks CORS origin
3. **tRPC middleware** extracts Bearer token from header
4. **Auth service** verifies JWT using jose + Auth0 JWKS (cached)
5. **Auth service** finds or creates user in DB by `auth0Id`
6. **Context** created: `{ user, db }`
7. **protectedProcedure** confirms `ctx.user` exists (throws UNAUTHORIZED if not)
8. **Router handler** executes business logic (e.g., INSERT INTO deployments)
9. **Response** returned via SuperJSON serialization

### Express Server Configuration

| Setting | Value |
|---------|-------|
| Port | `env.PORT` (default 3001) |
| CORS | Dynamic origin check (frontend URL + localhost variants) |
| Body Parser | `express.json()` |
| tRPC Adapter | `createExpressMiddleware` at `/trpc` |
| Health Check | `GET /health` returns `{ status: "ok", timestamp }` |
| Debug (dev only) | `GET /debug/db` dumps all tables |

### Middleware

- **publicProcedure** - Any request, `ctx.user` may be null
- **protectedProcedure** - Requires valid JWT, `ctx.user` guaranteed non-null, throws `UNAUTHORIZED` if missing

---

## 5. Database Schema

### Tables

#### `users`

| Column | Type | Constraints |
|--------|------|------------|
| `id` | varchar(255) | PK, nanoid |
| `email` | varchar(255) | UNIQUE, NOT NULL |
| `name` | varchar(255) | nullable |
| `auth0_id` | varchar(255) | UNIQUE, NOT NULL |
| `stripe_customer_id` | varchar(255) | nullable |
| `created_at` | timestamp | DEFAULT NOW() |
| `updated_at` | timestamp | DEFAULT NOW(), ON UPDATE |

#### `deployments`

| Column | Type | Constraints |
|--------|------|------------|
| `id` | varchar(255) | PK, nanoid |
| `user_id` | varchar(255) | FK -> users.id, NOT NULL |
| `name` | varchar(255) | NOT NULL |
| `description` | text | nullable |
| `template` | varchar(100) | nullable |
| `runtime` | varchar(100) | NOT NULL, DEFAULT 'openclaw' |
| `image` | varchar(255) | nullable (Docker image override) |
| `status` | varchar(50) | NOT NULL, DEFAULT 'creating' |
| `error` | text | nullable |
| `tier_id` | int | FK -> tiers.id, nullable |
| `created_at` | timestamp | DEFAULT NOW() |
| `updated_at` | timestamp | DEFAULT NOW(), ON UPDATE |

#### `tiers`

| Column | Type | Constraints |
|--------|------|------------|
| `id` | int | PK, AUTO_INCREMENT |
| `name` | varchar(100) | NOT NULL |
| `description` | text | nullable |
| `price` | decimal(10,2) | NOT NULL |
| `credits_per_month` | int | NOT NULL |
| `features` | text | JSON string |
| `is_active` | boolean | DEFAULT true |
| `created_at` | timestamp | DEFAULT NOW() |

### Relationships

- **users** 1:N **deployments** (one user has many deployments)
- **tiers** 1:N **deployments** (one tier assigned to many deployments)

### Deployment Status Values

| Status | Meaning |
|--------|---------|
| `pending` | DB record created, not yet deployed to K8s |
| `creating` | K8s deployment in progress |
| `running` | Pod is healthy and serving |
| `failed` | K8s deployment or pod crashed |

**Flow:** `pending` -> `creating` -> `running` OR `failed`

### Dual-Database Strategy

| Mode | Database | Driver | Use Case |
|------|----------|--------|----------|
| Production | AWS RDS MySQL | `mysql2` + Drizzle | Real data |
| Development | In-memory SQLite | `better-sqlite3` + Drizzle | `USE_SQLITE=true` |

Both schemas are kept in sync. `db/index.ts` exports a unified `tables` object and `db` client regardless of which backend is active.

### Seed Data (SQLite dev mode)

| Table | Records |
|-------|---------|
| tiers | Free ($0, 1k credits), Pro ($19, 10k), Agency ($99, 100k) |
| users | test@jarble.ai (auth0\|test123) |
| deployments | "My First Deployment" (running, openclaw) |

---

## 6. tRPC API Surface

### Router Overview

**5 routers, 16 total procedures:**

| Router | Procedures | Auth |
|--------|-----------|------|
| `deployment` | list, getById, create, deploy, getStatus, update, delete | Protected |
| `user` | me, getProfile, updateProfile | Mixed |
| `tier` | list, getById | Public |
| `template` | list | Public |
| `openrouter` | healthCheck, models, validateApiKey | Protected |

### Deployment Router (Protected)

| Procedure | Type | Input | Output | Side Effects |
|-----------|------|-------|--------|-------------|
| `list` | query | -- | `Deployment[]` | -- |
| `getById` | query | `{ id }` | `Deployment` or undefined | -- |
| `create` | mutation | `{ name, template?, platform?, runtime?, image? }` | `Deployment` | INSERT into DB |
| `deploy` | mutation | `deploymentId` (string) | `{ success, deploymentId }` | Creates K8s PVC + Secret + Deployment (fire-and-forget) |
| `getStatus` | query | `{ id }` | `{ status, phase?, restarts?, error? }` | Queries K8s pod status |
| `update` | mutation | `{ id, name?, description? }` | `Deployment` | UPDATE in DB |
| `delete` | mutation | `{ id }` | `{ success }` | Deletes K8s resources + DB record |

### User Router

| Procedure | Type | Auth | Input | Output |
|-----------|------|------|-------|--------|
| `me` | query | public | -- | `User` or null |
| `getProfile` | query | protected | -- | `User` |
| `updateProfile` | mutation | protected | `{ name?, email? }` | `User` |

### Tier Router (Public)

| Procedure | Type | Input | Output |
|-----------|------|-------|--------|
| `list` | query | -- | `Tier[]` (sorted by price) |
| `getById` | query | `{ id }` | `Tier` or undefined |

### Template Router (Public)

| Procedure | Type | Output |
|-----------|------|--------|
| `list` | query | 3 hardcoded templates: Personal Assistant, Business Helper, Support Agent |

### OpenRouter Router (Protected)

| Procedure | Type | Input | Output |
|-----------|------|-------|--------|
| `healthCheck` | query | -- | `{ ok, status?, error? }` |
| `models` | query | -- | Model list from OpenRouter API |
| `validateApiKey` | mutation | `{ apiKey }` | `{ valid }` |

---

## 7. Kubernetes Deployment Layer

### Resources Created Per Deployment

Each deployment creates **3 K8s resources** in the `jarble` namespace:

| Resource | Name Pattern | Details |
|----------|-------------|---------|
| PersistentVolumeClaim | `pvc-{deploymentId}` | 5Gi, ReadWriteOnce, storageClass: longhorn |
| Secret | `secret-{deploymentId}` | 6 env vars (see below) |
| Deployment | `dep-{deploymentId}` | 1 replica, labeled `jarble.ai/deployment-id` |

### Secret Environment Variables

| Env Var | Source |
|---------|--------|
| `DEPLOYMENT_ID` | deploymentId |
| `USER_ID` | userId |
| `DEPLOYMENT_NAME` | config.name |
| `TEMPLATE` | config.template or "personal" |
| `RUNTIME` | config.runtime or "openclaw" |
| `OPENROUTER_API_KEY` | From API env |

### Container Configuration

| Setting | Value |
|---------|-------|
| Image | `config.image` or `jarble/bot-base:latest` |
| CPU request / limit | 500m / 1000m |
| Memory request / limit | 2Gi / 4Gi |
| Volume mount | `/data` (from PVC) |

### K8s Functions

- **`createDeployment(deploymentId, userId, config)`** - Creates PVC -> Secret -> K8s Deployment
- **`deleteDeployment(deploymentId)`** - Deletes Deployment -> Secret -> PVC (ignores 404s)
- **`getDeploymentPodStatus(deploymentId)`** - Queries pods by label, returns status

### Pod Status Determination Logic

1. **No pods found** -> `not_found`
2. **Container waiting** (CrashLoopBackOff / ImagePullBackOff / ErrImagePull) -> `failed`
3. **Restarts >= 5** -> `failed`
4. **Phase == Running AND container ready** -> `running`
5. **Anything else** -> `creating`

---

## 8. Authentication Flow

### How Authentication Works

1. User clicks "Sign In" on the frontend
2. Frontend calls `loginWithRedirect()` (Auth0 SDK)
3. Auth0 shows login form (email, Google, GitHub)
4. User authenticates, Auth0 redirects back with tokens
5. `Auth0Provider` stores tokens, `useAuth0()` available everywhere
6. On every tRPC call, frontend adds `Authorization: Bearer {JWT}` header
7. API extracts token, verifies via jose + Auth0 JWKS (cached)
8. API looks up user by `auth0_id` in DB; creates new user if first login
9. Context `{ user, db }` passed to route handler

### Frontend Provider Stack (nested, outside-in)

1. **Auth0Provider** - Authentication context
2. **TrpcProviders** - Creates tRPC client with Auth0 Bearer token
3. **tRPC.Provider + QueryClientProvider** - Data fetching
4. **ErrorBoundary** - Catches React errors
5. **ThemeProvider** - Light theme (hardcoded)
6. **TooltipProvider** - Radix UI tooltips
7. **Toaster (Sonner)** - Toast notifications
8. **App Content** - Your pages

---

## 9. Frontend Architecture

### Route Map

**Public routes:**

| Route | View | Features |
|-------|------|----------|
| `/` | `Home.tsx` | Hero, integration marquee (20+ platforms), features grid |
| `/login` | `Login.tsx` | Auth0 login (email, Google, GitHub) |
| `/pricing` | `Pricing.tsx` | 4 tiers (Bronze/Silver/Gold/Platinum), monthly/annual toggle |
| `/about` | `About.tsx` | Mission, problem/solution, team |

**Authenticated routes:**

| Route | View | Features |
|-------|------|----------|
| `/dashboard` | `Dashboard.tsx` | Deployment grid, status badges, create/delete |
| `/onboarding/[id]` | `OnboardingWizard.tsx` | 4-step wizard (Name -> Runtime -> Deploy -> Connect) |
| `/d/[id]/configure` | `DeploymentConfiguration.tsx` | 5-tab config (General, Model, Platforms, Skills, Advanced) |

**Navigation flow:**
- Home -> Sign In -> Login -> Auth0 -> Dashboard
- Dashboard -> Create Deployment -> Onboarding Wizard -> Dashboard
- Dashboard -> Configure -> Deployment Configuration -> Dashboard

### Configuration Tabs

| Tab | Contents |
|-----|----------|
| **General** | Deployment name, description, system prompt |
| **Model** | AI provider (Jarble/Anthropic/OpenAI/Google), model, API key, temperature (0-2), max tokens |
| **Platforms** | 7 platform integrations with credential modals |
| **Skills** | 8 toggleable pre-built skills + marketplace CTA |
| **Advanced** | Deployment info (read-only), rate limiting, webhooks, danger zone (reset/delete) |

### Supported Platforms

| Platform | Credential Fields | Docs |
|----------|------------------|------|
| Discord | Bot Token, App ID, Server IDs | discord.com/developers |
| Slack | Bot Token, Signing Secret, App-Level Token | api.slack.com |
| Telegram | Bot Token, Webhook Secret | core.telegram.org/bots |
| WhatsApp | (QR code pairing) | Initial UI for OpenClaw deployments; more interfaces planned |
| Web Chat | Allowed Domains, Primary Color, Welcome Message | -- |
| Microsoft Teams | App ID, App Password, Tenant ID | learn.microsoft.com |
| Facebook Messenger | Page Access Token, Verify Token, App Secret | developers.facebook.com |

### Available AI Models

| Provider | Models |
|----------|--------|
| Jarble Managed | Auto (Recommended) |
| Anthropic | Claude Opus 4.5, Claude Sonnet 4, Claude Haiku |
| OpenAI | GPT-4o, GPT-4 Turbo, GPT-3.5 Turbo |
| Google | Gemini 2.0 Pro, Gemini 2.0 Flash |

### Pre-Built Skills

Customer Support, FAQ Bot, Ticket Creation, Appointment Booking, Lead Qualification, Order Tracking, Product Recommendations, Sentiment Analysis

---

## 10. User Flows

### Deployment Creation Flow

1. **Dashboard:** User clicks "Create Deployment"
2. **Navigate:** `/onboarding/new`
3. **Step 1 - Name:** Enter deployment name (min 2 characters)
4. **Step 2 - Runtime:** Choose runtime (OpenClaw pre-selected by default)
5. **Step 3 - Deploy:** Click "Deploy" button
   - Calls `trpc.deployment.create()` -> creates DB record (status: pending)
   - Calls `trpc.deployment.deploy()` -> triggers K8s deployment (fire-and-forget)
   - K8s creates PVC, Secret, and Deployment resources
   - On success: status -> `running`, advance to Step 4
   - On failure: status -> `failed`, error shown
6. **Step 4 - Connect:** Connect interface (currently WhatsApp QR code pairing)
7. **Finish:** Navigate back to Dashboard

### Deployment Configuration Flow

1. **Dashboard:** User clicks "Configure" on a deployment card
2. **Navigate:** `/d/{id}/configure`
3. **Load:** Fetch deployment via `trpc.deployment.getById`
4. **Edit:** Navigate 5 config tabs, modify fields
5. **Indicator:** "Unsaved changes" badge appears in header
6. **Save:** Click "Save Changes" -> `trpc.deployment.update()`
7. **Confirm:** Toast "Configuration saved!"

### K8s Deployment Lifecycle

```
DB: status = pending
    |
    v  deploy()
DB: status = creating
    |
    v  K8s: createDeployment()
    |       Create PVC
    |       Create Secret
    |       Create Deployment
    |
    +---> Success --> DB: status = running
    |
    +---> Error ----> DB: status = failed, error = message

    |
    v  delete()
    K8s: deleteDeployment() + DB: DELETE
```

---

## 11. Configuration & Environment

### API Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | Server port |
| `NODE_ENV` | No | `development` | Environment mode |
| `FRONTEND_URL` | No | `http://localhost:3000` | CORS origin |
| `USE_SQLITE` | No | -- | `"true"` for in-memory SQLite |
| `DATABASE_URL` | Conditional | -- | MySQL connection (required if not SQLite) |
| `AUTH0_DOMAIN` | No | `test.auth0.com` | Auth0 tenant domain |
| `AUTH0_AUDIENCE` | No | `https://api.jarble.ai` | Auth0 API audience |
| `OPENROUTER_API_KEY` | No | `sk-test-key` | OpenRouter API key |
| `STRIPE_SECRET_KEY` | No | -- | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | No | -- | Stripe webhook signing secret |

### Frontend Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API base URL |
| `NEXT_PUBLIC_AUTH0_DOMAIN` | `jarble-dev.us.auth0.com` | Auth0 domain |
| `NEXT_PUBLIC_AUTH0_CLIENT_ID` | -- | Auth0 client ID |
| `NEXT_PUBLIC_AUTH0_AUDIENCE` | `https://api.jarble.ai` | Auth0 audience |

### K8s API Pod Manifest

| Setting | Value |
|---------|-------|
| Replicas | 2 |
| CPU | 250m request / 500m limit |
| Memory | 256Mi request / 512Mi limit |
| Health | Liveness: `GET /health` (30s), Readiness: `GET /health` (10s) |
| Ingress | `api.jarble.ai` via Traefik with TLS |
| RBAC | Pods, Secrets, PVCs, Deployments (CRUD in `jarble` namespace) |

### K8s Deployment Pod Resources

| Setting | Value |
|---------|-------|
| Replicas | 1 per deployment |
| CPU | 500m request / 1000m limit |
| Memory | 2Gi request / 4Gi limit |
| Storage | 5Gi PVC (Longhorn, ReadWriteOnce) |
| Image | `config.image` or `jarble/bot-base:latest` |

---

## 12. Tech Stack Summary

### Backend (jarble-api-main)

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 (Alpine) |
| Framework | Express 4 |
| API Layer | tRPC 11 (SuperJSON transformer) |
| ORM | Drizzle ORM 0.45 |
| Database | MySQL 8 or PostgreSQL (production) / SQLite (dev) |
| Auth | Auth0 + jose (JWT verification) |
| K8s Client | @kubernetes/client-node 0.20 |
| Validation | Zod 3 |
| Logging | Pino 8 |
| Language | TypeScript 5.3 (strict mode) |

### Frontend (Jarble-mvp)

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15.3 (App Router) |
| Language | TypeScript 5.9 (strict mode) |
| UI | React 19 |
| Styling | Tailwind CSS 4 + shadcn/ui (New York style) |
| Animation | Framer Motion 12 |
| State | React Query 5 (via tRPC) |
| API Client | tRPC React Query 11 |
| Auth | @auth0/auth0-react 2 |
| Forms | React Hook Form 7 + Zod 4 |
| Icons | Lucide React |
| Toasts | Sonner 2 |
| Charts | Recharts 2 |

### Infrastructure

| Component | Technology |
|-----------|-----------|
| Frontend Hosting | Vercel |
| API Hosting | K3s on Hetzner VPS |
| Database | AWS RDS (MySQL) |
| Storage | Longhorn (distributed block storage) |
| Ingress | Traefik |
| Auth | Auth0 |
| LLM | OpenRouter |
| Billing | Stripe |
| Container Registry | Docker Hub (jarble/*) |

---

## Pricing Tiers (Frontend)

| Tier | Monthly | Annual | Connections | Skills | Requests/mo |
|------|---------|--------|-------------|--------|-------------|
| Bronze | Free | Free | 2 | 5 | 1,000 |
| Silver | $19.99 | $159.92 | 5 | 15 | 10,000 |
| Gold | $49.99 | $399.92 | 15 | 50 | 100,000 |
| Platinum | $99.99 | $799.92 | Unlimited | Unlimited | Unlimited |

---

## What's Next

See MIGRATION_PLAN.md for the planned expansion to a 7-table schema including:
- Expanded `users` table (tier, subscription status, phone number)
- Expanded `deployments` table (personality, model, LLM API key, storage tracking)
- `platforms` table (API-driven platform registry)
- `deploymentPlatforms` table (deployment-platform connections)
- `usageRecords` table (token/credit tracking)
- `deploymentTasks` table (pod lifecycle history)
- Expanded `tiers` table (resource limits, Stripe price IDs)

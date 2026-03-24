# Jarble Developer Guide

> A plain-English walkthrough of how Jarble works, written for developers who may not know Kubernetes, infrastructure, or the full stack yet. Uses real-world metaphors to make complex concepts click.

---

## Table of Contents

1. [What Is Jarble?](#1-what-is-jarble)
2. [The Big Picture](#2-the-big-picture)
3. [How the Pieces Fit Together](#3-how-the-pieces-fit-together)
4. [The Frontend (What Users See)](#4-the-frontend-what-users-see)
5. [The Backend API (The Brain)](#5-the-backend-api-the-brain)
6. [Kubernetes — The Server Room](#6-kubernetes--the-server-room)
7. [The Deployment Lifecycle](#7-the-deployment-lifecycle)
8. [LLM Keys and Credit Pools](#8-llm-keys-and-credit-pools)
9. [Platform Credentials](#9-platform-credentials)
10. [Config Sync — The Two-Way Mirror](#10-config-sync--the-two-way-mirror)
11. [Canvas Components & The Shared Manifest](#11-canvas-components--the-shared-manifest)
12. [Real-Time Updates (SSE)](#12-real-time-updates-sse)
    - 12.5. [The Flow Engine (Orchestration)](#125-the-flow-engine-orchestration)
13. [Authentication Flow](#13-authentication-flow)
14. [Payments (Stripe)](#14-payments-stripe)
15. [Encryption](#15-encryption)
16. [Infrastructure (Terraform + Hetzner)](#16-infrastructure-terraform--hetzner)
17. [Runtime Images (Docker)](#17-runtime-images-docker)
18. [The Database](#18-the-database)
19. [Environment Variables](#19-environment-variables)
    - 19.5. [Running Tests](#195-running-tests)
    - 19.6. [Mobile Development Notes](#196-mobile-development-notes)
20. [Local Development Setup](#20-local-development-setup)
21. [Production Deployment](#21-production-deployment)
22. [Common Workflows](#22-common-workflows)
23. [Glossary](#23-glossary)

---

## 1. What Is Jarble?

Jarble is a **no-code AI bot deployment platform**. Users sign up, pick a bot runtime (like OpenClaw or ZeroClaw), configure it with an LLM (like GPT-4 or Claude), and deploy it to messaging platforms (WhatsApp, Discord, Slack, Telegram) — all without writing code.

**Think of it like Shopify, but for AI bots.** Shopify lets non-technical people set up online stores. Jarble lets non-technical people set up AI-powered chatbots.

---

## 2. The Big Picture

Here's the 30,000-foot view of every major piece:

```mermaid
graph LR
    subgraph Browser["User's Browser"]
        FE["Next.js Frontend<br/>port 3000"]
    end

    subgraph Servers["Our Servers"]
        API["Express API<br/>port 3001"]
        K8S["K8s Cluster<br/>(user bots run here)"]
        DB[("Database<br/>SQLite / PostgreSQL")]
    end

    subgraph External["External Services"]
        AUTH0["Auth0<br/>(Login)"]
        STRIPE["Stripe<br/>(Payments)"]
        OR["OpenRouter<br/>(LLM Keys)"]
    end

    FE <-->|"tRPC + REST"| API
    API -->|"manages"| K8S
    API -->|"stores"| DB
    API <-->|"JWT tokens"| AUTH0
    API <-->|"webhooks"| STRIPE
    API <-->|"key provisioning"| OR
```

**In plain English:**
- The **frontend** is what users see in their browser (React/Next.js)
- The **API** is the brain that handles all business logic (Express/Node.js)
- **Kubernetes** is where user bots actually run (like a managed server room)
- **Auth0** handles login (so we don't store passwords)
- **Stripe** handles payments
- **OpenRouter** provides LLM API keys for users who don't have their own

---

## 3. How the Pieces Fit Together

### The Restaurant Metaphor

Think of Jarble as a **restaurant franchise system**:

| Jarble Concept | Restaurant Equivalent |
|---|---|
| **User** | Restaurant owner (franchisee) |
| **Deployment** | One restaurant location |
| **Runtime (OpenClaw/ZeroClaw)** | The kitchen equipment brand |
| **LLM API Key** | The food supplier contract |
| **Credit Pool** | A shared food budget across multiple locations |
| **K8s Pod** | The physical restaurant building |
| **PVC (storage)** | The restaurant's walk-in fridge (persists even if closed) |
| **K8s Secret** | The safe where you keep supplier passwords |
| **Config files** | The menu and recipes |
| **Dashboard** | The franchise management app |
| **Onboarding Wizard** | The "open a new location" workflow |
| **Canvas Components** | Specialty dishes — data tables, charts, maps — plated by the kitchen on demand |
| **Marketplace** | A cookbook store — browse and install new dish recipes |
| **AutoFix** | The chef correcting a misread order before it goes to the kitchen |
| **@jarble/component-manifest** | The master ingredient list shared by kitchen, dining room, and menu printer |
| **Agent Hub** | A catering partner network — your restaurant can call in a specialist caterer (another agent) to handle specific orders |
| **agentCallEvents** | The intercom between the catering dispatch desk and the floor staff, so servers know a specialist is on the way |
| **Benchmarks Router** | A Michelin Guide for AI chefs — diners rate each chef on accuracy, helpfulness, and creativity to build a public leaderboard |
| **Forkability Score** | How copy-ready a chef (agent) is to be franchised — rates completeness of their public profile and community ratings |
| **Platform Agent** | A Jarble-employed house chef — Jarble provides the kitchen, ingredients, and pays for everything; the chef just serves |
| **Resource Tier** | The size of the kitchen we provide to a platform chef: small (0.5 vCPU/1GB), medium (1 vCPU/2GB), large (2 vCPU/3GB) |
| **Dashboard Compose** | The expediting station — one order (compose call) fans out to multiple prep stations (component agents) running in parallel |

When a user "deploys" a bot, they're essentially **opening a new restaurant location** — we set up the building (K8s Pod), stock the fridge (PVC), put the supplier passwords in the safe (Secret), and print the menus (config files).

---

## 4. The Frontend (What Users See)

The frontend is a **Next.js 15** app (React) that runs in the browser.

### Pages

```mermaid
graph LR
    subgraph Public["Public Routes"]
        HOME["/ Home"]
        LOGIN["/login"]
        PRICING["/pricing"]
        ABOUT["/about"]
    end

    subgraph Protected["Protected Routes (require login)"]
        DASH["/dashboard"]
        WIZARD["/onboarding/[id]"]
        CHAT["/d/[id]"]
        CONFIG["/d/[id]/configure"]
        LINKED["/deployments"]
        ANALYTICS["/analytics"]
        BILLING["/billing"]
        SETTINGS["/settings"]
        MARKET["/marketplace"]
    end

    HOME -->|Sign In| LOGIN
    LOGIN -->|Auth0| DASH
    DASH -->|New Bot| WIZARD
    DASH -->|Chat| CHAT
    DASH -->|Configure| CONFIG
    DASH -->|Profile Menu| ANALYTICS
    DASH -->|Profile Menu| BILLING
    DASH -->|Profile Menu| SETTINGS
    DASH -->|Profile Menu| LINKED
    DASH -->|Profile Menu| MARKET
    WIZARD -->|Complete| DASH
```

| Page | URL | What It Does |
|---|---|---|
| Home | `/` | Marketing page — "Deploy AI bots in 2 minutes" |
| About | `/about` | About page |
| Login | `/login` | Auth0 login (Google, GitHub, email) |
| Register | `/register` | Registration page |
| Pricing | `/pricing` | Shows runtime options and costs |
| **Dashboard** | `/dashboard` | Lists all your bots with status, controls |
| **Onboarding** | `/onboarding/[id]` | Step-by-step wizard to create a new bot |
| **Chat** | `/d/[id]` | Deployment chat interface — Tambo + canvas grid |
| **Config** | `/d/[id]/configure` | Edit an existing bot (6 tabs) |
| Linked Deployments | `/deployments` | Shows credit pool sharing between bots |
| Analytics | `/analytics` | Usage stats, credit meters, sortable table |
| **Billing** | `/billing` | Billing overview, subscriptions, invoices |
| Settings | `/settings` | Profile, theme, password reset |
| **Marketplace** | `/marketplace` | Browse and install community-built canvas components |
| **Marketplace Detail** | `/marketplace/[id]` | Component detail, reviews, and install button |

### How the Frontend Talks to the Backend

We use **tRPC** — a type-safe way for the frontend to call backend functions. Think of it like calling a function on the server directly from your React code:

```tsx
// This looks like a normal function call, but it's actually an HTTP request
const { data: deployments } = trpc.deployment.list.useQuery();

// This is a mutation (changes data on the server)
const deleteMutation = trpc.deployment.delete.useMutation();
deleteMutation.mutate({ id: "abc123" });
```

**Why tRPC instead of fetch/axios?**
- Automatic TypeScript types from server to client (no manual API types)
- Built-in caching, retries, and loading states via React Query
- Automatic JSON serialization with SuperJSON (handles Dates, etc.)

### Key Frontend Patterns

**1. Auth Guard Pattern**
Every protected page checks if you're logged in:
```tsx
const { isAuthenticated, isLoading } = useAuth0();
if (isLoading) return <Spinner />;
if (!isAuthenticated) return <Redirect to="/login" />;
```

**2. Real-Time Status via SSE**
The Dashboard doesn't poll for status updates. Instead, it opens a persistent connection (Server-Sent Events) that pushes changes instantly:
```tsx
const { getStatus } = useStatusStream({ enabled: isAuthenticated });
const liveStatus = getStatus(deployment.id); // "running", "stopped", etc.
```
Think of SSE like a **radio station** — you tune in once, and the server broadcasts updates whenever something changes. Much more efficient than calling the server every 3 seconds.

**3. Config-Driven UI**
The onboarding wizard and config tabs are driven by a single config file (`wizardStepConfig.ts`). Adding a new runtime doesn't require touching UI code — just add config entries:
```typescript
RUNTIME_EXTRA_STEPS = {
  openclaw: [llm, deploy, whatsapp],
  zeroclaw: [llm, deploy],
  // Add new runtime here → wizard automatically shows correct steps
}
```

### Provider Tree (How Everything Gets Wired)

```mermaid
graph TD
    A0["Auth0Provider"] --> TP["TrpcProviders"]
    TP --> QC["QueryClientProvider"]
    QC --> EB["ErrorBoundary"]
    EB --> TH["ThemeProvider"]
    TH --> TT["TooltipProvider"]
    TT --> PAGE["Your Page Component"]

    A0 -.-|"useAuth0()"| PAGE
    TP -.-|"trpc.*.useQuery()"| PAGE
    QC -.-|"caching + retries"| PAGE
    TH -.-|"light / dark mode"| PAGE
```

Every component inside this tree can call `useAuth0()` for auth and `trpc.*` for API calls.

---

## 5. The Backend API (The Brain)

The API is an **Express.js** server with **tRPC** for structured endpoints and plain REST for things like webhooks and streaming.

### Two Types of Endpoints

**1. tRPC Procedures** (174 total across 15 routers)
Structured, typed function calls. Protected by JWT auth. Used for all normal CRUD operations.

```
trpc.deployment.list              → List your bots
trpc.deployment.create            → Create a new bot
trpc.deployment.update            → Change bot settings
trpc.deployment.delete            → Delete a bot
trpc.deployment.platformFork      → Admin: fork as platform agent
trpc.openrouter.provisionKey      → Get a new LLM API key
trpc.marketplace.browse           → Browse marketplace components
trpc.marketplace.install          → Install a component on a deployment
trpc.skills.listCatalog           → List available skills
trpc.services.list                → Browse service marketplace
trpc.services.install             → Install a service bundle on a deployment
trpc.benchmarks.rateDeployment    → Rate an agent in a domain
trpc.benchmarks.leaderboard       → Domain leaderboard
trpc.benchmarks.adminFeature      → Admin: feature an agent
trpc.flows.list                   → List user's orchestration flows
trpc.flows.create                 → Create a new orchestration flow
trpc.flows.generateFromPrompt     → Generate a flow from natural language
trpc.admin.getStats               → Platform-wide statistics (admin only)
trpc.admin.listUsers              → All users with deployment counts (admin only)
trpc.admin.sendBetaInvite         → Send beta welcome email (admin only)
```

**2. REST Endpoints** (33 total)
Plain HTTP routes for things that can't use tRPC:
- **Webhooks** (Stripe, Auth0, config-changed) — external services POST to us
- **SSE Streams** (logs, status, WhatsApp QR, chat) — long-lived connections that push data
- **Artifact endpoints** (workspace artifact sync) — exec into pod to read/write workspace JSON
- **Flow execution** (`POST /api/flows/:flowId/execute`, `GET .../stream`, `POST .../resume`) — orchestration flow engine with SSE progress streaming and human-in-the-loop pause/resume
- **Beta signup** (`POST /api/beta-signup`) — public waitlist, no auth required
- **Service proxy** (HMAC-signed skill routing) — forwards buyer skill calls to creator remote APIs
- **Agent Hub** (`POST /api/agent-hub/call`, `GET /api/agent-hub/discover`) — agent-to-agent delegation; call endpoint fans out SSE events via `agentCallEvents` EventEmitter
- **Public API** (`GET /api/public/leaderboard/:domainSlug`, `GET /api/public/agents/:deploymentId/profile`) — unauthenticated leaderboard and agent profile endpoints with forkability scores
- **Pod Compose** (`POST /api/pod/compose`) — fans out up to 8 component agent calls in parallel; used by the `compose_dashboard` MCP tool
- **MCP endpoints** (Streamable HTTP + proxy) — for external MCP clients
- **Diagnostic endpoint** — structured health checks for a deployment
- **Health check** — for Kubernetes to know we're alive
- **Debug endpoints** (dev only) — inspect DB state

### Background Services

Four background services start automatically at API boot (skipped in dev/SQLite mode):

**Subscription Enforcement** (every 5 minutes):
- Stops free-trial bots past their expiration date
- Stops paid bots without a valid Stripe subscription
- Stops bots at end of cancelled billing period
- Validates active subscriptions against Stripe API
- Cleans up orphaned deployments (every 30 min)

**Storage Enforcement** (every 5 minutes):
- Checks disk usage (`df /data`) inside each running pod
- Stops pods exceeding their storage quota (>= 100%)
- Clears storage errors when usage drops below limit

**Status Reconciler** (every 30 seconds):
- Reconciles DB deployment status with actual K8s pod status
- Fixes deployments stuck at "creating" (e.g., after API restart mid-deploy)

**Service Health Check** (every 5 minutes):
- Pings the health endpoint of each published hosted/remote service
- Updates service availability status in DB (marks degraded services)

### Hardware-Based Pricing

Monthly subscription price is calculated dynamically from hardware specs:

| Resource | Rate |
|---|---|
| vCPU | $10.00/mo per 1.0 vCPU |
| RAM | $2.50/mo per GB |
| Storage | $0.08/mo per GB |

The `calculateMonthlyPriceCents()` utility in `src/utils/pricing.ts` computes this. Example: a bot with 2 vCPU, 2 GB RAM, 30 GB storage = $20 + $5 + $2.40 = **$27.40/month**.

### How Auth Works on the Backend

Every request goes through this flow:

```mermaid
flowchart TD
    REQ([Request arrives]) --> CHECK{"Bearer token<br/>in header?"}

    CHECK -->|No| PUBLIC["Request is 'public'<br/>(only some endpoints allow this)"]

    CHECK -->|Yes| VERIFY["Verify JWT with<br/>Auth0 JWKS public keys"]
    VERIFY --> VALID{"Token valid?"}

    VALID -->|No| REJECT["401 Unauthorized"]
    VALID -->|Yes| EXTRACT["Extract user info<br/>from JWT claims"]
    EXTRACT --> FIND{"User exists<br/>in DB?"}

    FIND -->|Yes| ATTACH["Attach user to<br/>request context"]
    FIND -->|No| CREATE["Auto-create user record"]
    CREATE --> ATTACH

    ATTACH --> PROCEED(["Proceed to handler ✅"])

    style REJECT fill:#ef4444,color:#fff
    style PROCEED fill:#22c55e,color:#fff
```

### The Router System

Backend code is organized into **routers** (like controllers in MVC):

```mermaid
graph TD
    REQ["Incoming Request<br/>POST /trpc/deployment.list"] --> MW["Auth Middleware<br/>JWT verification"]
    MW --> ROUTER{"Which Router?"}

    ROUTER -->|"deployment.*"| DEPLOY["deployment.ts<br/>37 procedures"]
    ROUTER -->|"openrouter.*"| OR["openrouter.ts<br/>10 procedures"]
    ROUTER -->|"user.*"| USER["user.ts<br/>6 procedures"]
    ROUTER -->|"billing.*"| BILL["billing.ts<br/>4 procedures"]
    ROUTER -->|"platformCredentials.*"| PLAT["platformCredentials.ts<br/>7 procedures"]
    ROUTER -->|"runtimeCatalog.*"| RUNTIME["runtimeCatalog.ts<br/>4 procedures"]
    ROUTER -->|"template.*"| TMPL["template.ts<br/>4 procedures"]
    ROUTER -->|"skills.*"| SKILLS["skills.ts<br/>4 procedures"]
    ROUTER -->|"marketplace.*"| MKT["marketplace.ts<br/>23 procedures"]
    ROUTER -->|"services.*"| SVC["services.ts<br/>26 procedures"]
    ROUTER -->|"benchmarks.*"| BM["benchmarks.ts<br/>14 procedures"]
    ROUTER -->|"flows.*"| FLOWS["flows.ts<br/>8 procedures"]
    ROUTER -->|"admin.*"| ADMIN["admin.ts<br/>19 procedures"]
    ROUTER -->|"agentCredits.*"| AC["agentCredits.ts<br/>4 procedures"]
    ROUTER -->|"apiKeys.*"| AK["apiKeys.ts<br/>4 procedures"]

    DEPLOY --> DB[("Database")]
    DEPLOY --> K8S["K8s Cluster"]
    OR --> ORAPI["OpenRouter API"]
    BILL --> STRIPE_API["Stripe API"]
    PLAT --> DB
    MKT --> DB
```

```
src/trpc/routers/
  ├── deployment.ts          ← 37 procedures (CRUD + canvas components + lifecycle + platformFork)
  ├── openrouter.ts          ← 10 procedures (LLM key management)
  ├── user.ts                ← 6 procedures (profile, email verify, account deletion)
  ├── billing.ts             ← 4 procedures (overview, invoices, subscriptions, managed key usage)
  ├── platformCredentials.ts ← 7 procedures (Discord/Slack tokens, WhatsApp QR, Telegram pairing)
  ├── runtimeCatalog.ts      ← 4 procedures (list available runtimes)
  ├── skills.ts              ← 4 procedures (skills catalog, install/uninstall)
  ├── marketplace.ts         ← 23 procedures (browse, install, review, creator, admin, builtin schemas)
  ├── services.ts            ← 26 procedures (full lifecycle: draft, publish, install, admin, creator analytics)
  ├── benchmarks.ts          ← 14 procedures (domains, ratings, leaderboard, service metrics + reviews, admin curation)
  ├── template.ts            ← 4 procedures (persona templates: list, getById, getByCategory, getCategories)
  ├── flows.ts               ← 8 procedures (orchestration flow CRUD + execution history + LLM generation)
  ├── admin.ts               ← 19 procedures (user mgmt, deployment control, Prometheus metrics, audit logs, beta)
  ├── agentCredits.ts        ← 4 procedures (credit balance, history, purchase, call history)
  └── apiKeys.ts             ← 4 procedures (developer API key CRUD)
```

### Fire-and-Forget Pattern

Many backend operations (deploying, restarting, syncing configs) take 10-60 seconds. We don't make the user wait:

```typescript
// API returns immediately
res.json({ success: true });

// K8s work happens in the background
void (async () => {
  await createDeployment(id, config);  // Takes 30+ seconds
  await db.update(deployment).set({ status: "running" });
})();
```

**Analogy:** When you order food at a restaurant, the waiter doesn't stand at your table until the food is ready. They take your order, go to the kitchen, and come back when it's done. The frontend watches for the status to change via SSE.

### Rate Limiting

The API has three tiers of rate limiting via `express-rate-limit` (see `src/middleware/rateLimit.ts`):

```mermaid
graph TD
    REQ["Incoming Request"] --> GLOBAL{"Global Limiter<br/>300 req/min per IP"}

    GLOBAL -->|Pass| ROUTE{"Which Route?"}
    GLOBAL -->|Exceeded| REJECT["429 Too Many Requests"]

    ROUTE -->|"/trpc/*"| AUTH{"Auth Limiter<br/>120 req/min per user"}
    ROUTE -->|"/api/stripe/checkout<br/>/api/stripe/portal"| STRIPE{"Stripe Limiter<br/>10 req/min per user"}
    ROUTE -->|Other| HANDLER["Route Handler"]

    AUTH -->|Pass| HANDLER
    AUTH -->|Exceeded| REJECT
    STRIPE -->|Pass| HANDLER
    STRIPE -->|Exceeded| REJECT

    style REJECT fill:#ef4444,color:#fff
    style HANDLER fill:#22c55e,color:#fff
```

| Limiter | Scope | Limit | Key | Skips |
|---------|-------|-------|-----|-------|
| `globalLimiter` | All traffic | 300/min | Client IP | `/health`, webhooks, Auth0 M2M |
| `authLimiter` | tRPC endpoints | 120/min | User ID (JWT `sub`) | — |
| `stripeActionLimiter` | Payment actions | 10/min | User ID (JWT `sub`) | — |

**How user identification works:** The rate limiter extracts the `sub` claim from the JWT by base64url-decoding the payload (no signature verification — that happens later in the actual route handler). If no token is present, it falls back to the client IP.

**Trust proxy:** `app.set("trust proxy", 1)` is set so that `req.ip` returns the real client IP from the `X-Forwarded-For` header (set by Traefik), not the K8s pod IP.

**Response headers:** All limiters use `standardHeaders: "draft-7"`, which adds `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers to every response.

---

## 6. Kubernetes — The Server Room

This is probably the most unfamiliar piece, so let's break it down carefully.

### What Is Kubernetes?

**Think of Kubernetes (K8s) as a building manager for a large apartment complex.**

- The **cluster** is the apartment building itself (multiple servers working together)
- Each **node** is a floor of the building (one physical/virtual server)
- Each **pod** is an apartment (one running container — one user's bot)
- The **namespace** is like a wing of the building (we use `jarble` for all our stuff)

The building manager's job:
- Assign tenants to apartments (schedule pods to nodes)
- If an apartment floods, move the tenant to a new one (auto-restart on crash)
- Keep the lights on (health checks)
- Manage storage lockers (persistent volumes)

### Pod Performance Tuning

Several optimizations have been made to reduce deployment startup time and improve readiness detection:

| Tuning | Old | New | Saving |
|---|---|---|---|
| validate-config init container | Present (pulled full OpenClaw image) | Removed | 10-30s cold boot |
| PVC config writes | N sequential exec calls | 1 batched shell script | ~4s → 300ms |
| Readiness poll interval | Flat 2s | Adaptive: 1s/2s/3s tiers | Faster detection |
| Readiness `initialDelaySeconds` | 20s | 10s | 10s saved per deploy |
| Readiness `periodSeconds` | 10s | 5s | Faster "running" detection |
| Liveness `initialDelaySeconds` | 60s | 90s | Prevents cold-boot kills |
| `terminationGracePeriodSeconds` | 30s | 10s | Faster pod replacement |
| CPU request | Equal to limit | 50% of limit (min 250m) | Burst during npm install |

The adaptive readiness polling tiers in `configSync.ts`:
- **0-20s**: 1s intervals (warm boots with `.initialized` finish in ~15s)
- **20-60s**: 2s intervals
- **60-180s**: 3s intervals (cold boot npm install can take 2-3 min)

### The Three K8s Resources We Create Per Deployment

When a user deploys a bot, we create exactly three things:

```mermaid
graph TB
    subgraph K8S["K8s Namespace: jarble"]
        subgraph DEP["Deployment (The Apartment)"]
            POD["Pod — Running Container<br/>Docker image + CPU/memory limits"]
        end

        SECRET["Secret (The Safe)<br/>API keys, tokens, env vars"]
        PVC["PVC (The Storage Locker)<br/>20-100 GB persistent disk"]

        SECRET -->|"env vars injected"| POD
        PVC -->|"mounted at /data"| POD
    end

    API["Jarble API"] -->|"creates all 3"| DEP
    API -->|"creates"| SECRET
    API -->|"creates"| PVC
```

**1. PVC (Persistent Volume Claim) — "The Storage Locker"**
```
What: A chunk of disk space that survives pod restarts
Why: Bot data (configs, databases, logs) must persist
Size: 20-100 GB (user configurable)
Analogy: A storage locker at the apartment complex. Even if the tenant
         moves to a different apartment, their stuff stays in the locker.
```

**2. Secret — "The Safe"**
```
What: Encrypted key-value pairs injected as environment variables
Contains:
  - DEPLOYMENT_ID, USER_ID, DEPLOYMENT_NAME
  - LLM API key (OPENROUTER_API_KEY, etc.)
  - Platform tokens (DISCORD_BOT_TOKEN, etc.)
  - JARBLE_API_URL (for the bot to call back to us)
Analogy: A safe in the apartment. The tenant (container) can read the
         contents, but they're encrypted at rest in the building's system.
```

**3. Deployment — "The Apartment"**
```
What: The actual running container (the bot itself)
Contains:
  - Docker image (OpenClaw or ZeroClaw runtime)
  - CPU/memory limits
  - Volume mount (PVC attached at /data)
  - Environment variables (from Secret)
  - Health checks
Analogy: The apartment itself. The tenant moves in (container starts),
         unpacks their stuff from the locker (mounts PVC), reads the safe
         (loads secrets), and starts living (bot goes online).
```

### What Happens When You Stop/Start/Delete

| Action | What Happens | Storage | Analogy |
|---|---|---|---|
| **Stop** | Scale replicas to 0 (container dies) | PVC preserved | Tenant moves out, locker stays |
| **Start** | Scale replicas to 1 (new container) | PVC reattached | New tenant moves into same apartment, same locker |
| **Restart** | Stop → 2s pause → Start | PVC preserved | Tenant briefly steps out, comes back |
| **Delete** | Remove Deployment + Secret + PVC | Everything gone | Apartment demolished, locker emptied |

### What's Actually on the PVC (Persistent Data)

The PVC is mounted at `/data` inside every container. Here's the exact directory structure:

**OpenClaw Runtime:**
```
/data/
  .initialized              ← Marker file (skips install on subsequent boots)
  .openclaw/                ← OpenClaw internal home directory
    openclaw.json           ← Agent + channel config (model, provider, channels)
    workspace/              ← OpenClaw workspace state
  config/                   ← Jarble-managed config files (synced both ways)
    soul.md                 ← System prompt / personality
    skills/                 ← Skill definitions (future)
    platforms/              ← Platform config (future)
  runtime/                  ← npm install directory
    node_modules/           ← OpenClaw + all dependencies (~100MB)
    package.json            ← npm package manifest
  logs/                     ← Application logs
```

**ZeroClaw Runtime:**
```
/data/
  .initialized              ← Marker file (skips install on subsequent boots)
  zeroclaw-data/            ← ZeroClaw internal data directory
  config/                   ← Jarble-managed config files (synced both ways)
    config.toml             ← ZeroClaw runtime configuration
  logs/                     ← Application logs
```

```mermaid
graph TB
    subgraph PVC["/data — Persistent Volume (survives restarts)"]
        INIT[".initialized<br/>(marker file)"]

        subgraph CONFIG["config/ — Jarble-Managed (synced both ways)"]
            SOUL["soul.md<br/>(system prompt)"]
            OCJSON["openclaw.json<br/>(model + channels)"]
        end

        subgraph RUNTIME["runtime/ — Installed Once"]
            NM["node_modules/<br/>(~100MB)"]
        end

        subgraph INTERNAL["Runtime Internal Data"]
            OC_HOME[".openclaw/ or zeroclaw-data/<br/>(workspace state)"]
        end

        LOGS["logs/"]
    end

    SYNC["Config Sync<br/>(two-way)"] <-->|"reads/writes"| CONFIG
    ENTRYPOINT["entrypoint.sh<br/>(first boot)"] -->|"creates"| INIT
    ENTRYPOINT -->|"npm install"| RUNTIME

    style CONFIG fill:#22c55e,color:#fff
    style RUNTIME fill:#3b82f6,color:#fff
    style INIT fill:#f59e0b,color:#fff
```

**Key concepts:**
- `/data/config/` is the **synced zone** — files here are managed by both the frontend (push) and the file watcher (pull). This is where the two-way config sync operates.
- `/data/runtime/` is **installed once on first boot** (npm install). It persists across restarts so startup is fast (~3s vs ~30s on first boot).
- `.initialized` is the **gate** — if this file exists, the entrypoint skips installation and goes straight to starting the gateway.
- Everything outside `/data/` is **ephemeral** — the container image is rebuilt from scratch on every restart, but `/data/` is always reattached.

### What Happens to Files During Each Operation

```mermaid
flowchart LR
    subgraph STOP["Stop"]
        S1["Container killed"] --> S2["PVC stays<br/>(all /data/ preserved)"]
        S2 --> S3["Secret stays"]
    end

    subgraph START["Start"]
        ST1["New container boots"] --> ST2["PVC reattached at /data"]
        ST2 --> ST3{".initialized<br/>exists?"}
        ST3 -->|Yes| ST4["Skip install<br/>(~3s startup)"]
        ST3 -->|No| ST5["Full install<br/>(~30s startup)"]
    end

    subgraph DELETE["Delete"]
        D1["Container killed"] --> D2["PVC DELETED<br/>(all data gone!)"]
        D2 --> D3["Secret DELETED"]
        D3 --> D4["⚠️ Unrecoverable<br/>Export ZIP first!"]
    end

    style D2 fill:#ef4444,color:#fff
    style D4 fill:#ef4444,color:#fff
    style S2 fill:#22c55e,color:#fff
    style ST4 fill:#22c55e,color:#fff
```

**Before deleting a deployment**, users can export their configs as a ZIP file via the config page. This downloads all files from `/data/config/` so they can be re-imported later.

### Storage Architecture (Block Storage + Longhorn)

Each worker node has **two types of disk**, and it's important to understand the difference:

```mermaid
graph TB
    subgraph Node["Worker Node (cpx21 — 3 vCPU, 4GB RAM)"]
        subgraph Local["Local Disk (80 GB)"]
            OS["Linux OS + K3s"]
            IMAGES["Container image layers"]
            LH_META["Longhorn metadata"]
        end

        subgraph Block["Hetzner Block Storage (up to 10 TB)"]
            LH_DATA["Longhorn data directory<br/>(mounted at /var/lib/longhorn)"]
        end
    end

    subgraph Longhorn["Longhorn Storage Engine"]
        MGR["Longhorn Manager"]
    end

    subgraph UserPods["User Bot Pods"]
        PVC1["PVC: deploy-abc<br/>30 GB → /data"]
        PVC2["PVC: deploy-def<br/>100 GB → /data"]
    end

    LH_DATA -->|"backing store"| MGR
    MGR -->|"provisions"| PVC1
    MGR -->|"provisions"| PVC2

    style Local fill:#94a3b8,color:#fff
    style Block fill:#22c55e,color:#fff
    style MGR fill:#7c3aed,color:#fff
```

**Analogy:** Think of each worker node as a **warehouse building**:
- The **local disk** is the building itself — walls, roof, electrical, the loading dock. You need it for the building to function, but you don't store customer goods there.
- The **block storage** is the **warehouse floor space** — this is where all the storage lockers (PVCs) are placed. The more floor space you attach, the more/bigger lockers you can fit.
- **Longhorn** is the **warehouse manager** — it carves the floor space into individual lockers and assigns them to tenants (pods).

**The capacity formula:**

```
Block storage needed per node = d x p

Where:
  d = max deployments that fit on the node (limited by CPU + RAM)
  p = max persistent storage per deployment
```

| Resource | cpx21 has | Per deployment (default) | Per deployment (min) |
|----------|-----------|------------------------|---------------------|
| CPU | 3 vCPU | 2 vCPU | 1 vCPU |
| RAM | 4 GB | 2 GB | 256 MB |
| Storage (PVC) | Block storage | 30 GB | 20 GB |
| Max deployments | — | ~1 per node | ~3 per node |

With default specs (2 vCPU, 2GB RAM), only **~1 deployment fits per cpx21 node**. With minimum specs, up to **~3 deployments** fit (CPU-limited). The user can allocate up to **100 GB storage per deployment**, so the block storage volume must be sized accordingly:

- 1 deployment x 100 GB = **100 GB block storage**
- 3 deployments x 100 GB = **300 GB block storage**

Hetzner Block Storage volumes are provisioned by Terraform (`hcloud_volume`, default 100 GB per node) and mounted at `/var/lib/longhorn` on each worker node. Longhorn automatically uses this path — no config changes needed. Hetzner supports up to **10 TB** per block storage volume.

### Status Flow

```mermaid
stateDiagram-v2
    [*] --> pending : deployment.create
    pending --> creating : deployment.deploy
    creating --> running : pod ready
    creating --> failed : crash / bad image / timeout

    running --> stopped : user clicks Stop
    running --> creating : user clicks Restart
    running --> failed : pod crashed

    stopped --> creating : user clicks Start
    stopped --> [*] : user deletes

    failed --> creating : user clicks Restart
    failed --> [*] : user deletes
```

### How We Talk to Kubernetes

Our API server uses the official `@kubernetes/client-node` library. It works in three modes:

```
In production (inside K8s cluster):
  → loadFromCluster() — uses the service account token automatically

In development (your laptop, with cluster):
  → loadFromDefault() — uses your ~/.kube/config file

In development (no cluster — MOCK_K8S=true):
  → All K8s operations use an in-memory store (Map)
  → No kubeconfig needed, no real cluster needed
  → Full API functionality with simulated PVCs, Secrets, Deployments
  → Inspect state via /debug/mock-pvc endpoint
```

**Mock K8s mode** is the easiest way to develop locally. Set `MOCK_K8S=true` and all K8s functions (create, stop, start, delete, logs, exec, storage usage) short-circuit to the in-memory mock store. The mock even simulates storage usage based on actual byte sizes of stored file contents.

### K8s RBAC (Permissions)

Our API server runs with a **ServiceAccount** (`jarble-api`) that has specific permissions:

```yaml
# What our API is allowed to do in the "jarble" namespace:
- pods: get, list, watch, create, delete
- pods/exec: create (run commands inside pods)
- pods/log: get (read container logs)
- secrets: get, list, create, update, delete
- persistentvolumeclaims: get, list, create, delete
- deployments: get, list, create, update, patch, delete
```

It can NOT do things like modify other namespaces, access the master node, or change cluster settings.

---

## 7. The Deployment Lifecycle

Here's the complete journey from "user clicks Deploy" to "bot is running":

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant API as API Server
    participant DB as Database
    participant OR as OpenRouter
    participant K8S as Kubernetes

    User->>FE: Fill out wizard & click Deploy
    FE->>API: deployment.create(name, runtime, llm...)
    API->>DB: Insert deployment record (status: pending)

    opt Included Credits mode
        API->>OR: provisionKey(limitDollars)
        OR-->>API: Tenant API key
        API->>DB: Store encrypted key
    end

    API-->>FE: { id: "abc123" }

    FE->>API: deployment.deploy(id)
    API-->>FE: { success: true } (returns immediately)

    Note over API,K8S: Background (fire-and-forget)
    API->>API: Decrypt API key + credentials
    API->>API: Runtime handler renders configs
    API->>K8S: Create PVC (storage)
    API->>K8S: Create Secret (env vars)
    API->>K8S: Create Deployment (container)
    K8S-->>K8S: Pod starts → entrypoint.sh runs
    K8S-->>API: Pod ready
    API->>DB: Update status → "running"

    Note over FE: SSE status stream detects change
    FE-->>User: Dashboard card turns green ✅
```

### Step 1: User Fills Out the Wizard

```
Name your bot → Choose runtime → Configure LLM → Click Deploy
```

### Step 2: Frontend Calls `deployment.create`

The API creates a **database record** with all the config but does NOT touch K8s yet.

```typescript
// What gets stored in the database:
{
  id: "abc123xyz",           // Random 12-char ID
  name: "My Support Bot",
  runtime: "openclaw",
  llmMode: "included",       // We provide the LLM key
  llmProvider: "openrouter",
  llmApiKey: "enc:iv:tag:cipher",  // Encrypted!
  status: "pending",         // Not deployed yet
}
```

If the user chose "Included Credits" mode, we also provision an OpenRouter API key at this point.

### Step 3: Frontend Calls `deployment.deploy`

Now the real work begins. The API:

1. **Decrypts** the LLM API key
2. **Decrypts** platform credentials (Discord tokens, etc.)
3. **Asks the runtime handler** to render config files:
   ```
   OpenClaw handler produces:
     - soul.md (system prompt)
     - openclaw.json (model + channel config)
   ```
4. **Creates K8s resources** (PVC → Secret → Deployment)
5. **Returns immediately** to the frontend: `{ success: true }`
6. **In the background**: waits for the pod to start, then updates DB status

### Step 4: Pod Starts Up

The Docker container boots and runs the runtime's `entrypoint.sh`:

```
First boot:
  1. Create directory structure (/data/config, /data/runtime, etc.)
  2. Install runtime (npm install openclaw, or copy zeroclaw binary)
  3. Write default config files
  4. Mark as initialized (.initialized file)

Every boot:
  1. Start file watcher (background process)
  2. Start the bot gateway (main process)
```

### Step 5: Bot Goes Online

The gateway starts listening for messages from WhatsApp/Discord/Slack/etc.

The frontend's SSE status stream detects the change: `creating → running`

The dashboard card turns green.

---

## 8. LLM Keys and Credit Pools

### Three Ways to Get an LLM Key

**BYOK (Bring Your Own Key)**
```
User provides their own OpenAI/Anthropic/Google/OpenRouter API key.
We encrypt it and store it. That's it.

Analogy: Bringing your own food to a potluck.
```

> **Dev bypass:** In SQLite/dev mode, any key prefixed with `dev-` (e.g., `dev-test-key`) is accepted as valid without calling the real provider API. This lets you test the full onboarding flow locally without real LLM credentials.

**Included Credits**
```
We provision a tenant API key on OpenRouter with a monthly spending cap.
The user doesn't need to sign up for anything — we handle it.

Analogy: We order catering for your party. You pay us, we pay the caterer.
```

**Platform Mode** (`llmMode: "platform"`)
```
Only available for platform-managed agents (isPlatform: true).
The platform injects its own LLM key (AGENT_LLM_API_KEY) into the pod.
The user has no key at all — the platform pays for every inference.

Analogy: House chefs at a Jarble-owned restaurant. Jarble provides
everything — kitchen, staff, ingredients. The chef just works.
```

Platform mode is set when an admin uses `deployment.platformFork` to clone a user's agent as a platform agent. The key injection happens inside `openclaw.ts:getSecretEntries()`: it checks `deployment.llmMode === "platform"` and substitutes the platform key for whatever the deployment record holds.

### How Credit Pools Work

Multiple bots can share the same LLM budget. This is the **Owner/Linked** model:

```mermaid
graph TD
    POOL["Credit Pool<br/>$25/month limit"]

    OWNER["Bot A (OWNER)<br/>Owns the API key<br/>Controls the spending cap"]
    LINKED1["Bot B (LINKED)<br/>Uses Bot A's key"]
    LINKED2["Bot C (LINKED)<br/>Uses Bot A's key"]

    POOL --- OWNER
    OWNER --> LINKED1
    OWNER --> LINKED2

    OR["OpenRouter API<br/>sk-or-xxx"]
    OWNER ---|"same key"| OR
    LINKED1 ---|"same key"| OR
    LINKED2 ---|"same key"| OR

    style OWNER fill:#22c55e,color:#fff
    style LINKED1 fill:#3b82f6,color:#fff
    style LINKED2 fill:#3b82f6,color:#fff
    style POOL fill:#f59e0b,color:#fff
```

All three bots draw from the same $25/month pool.

**How linking works under the hood:**
1. Bot A gets provisioned with an OpenRouter key (`sk-or-xxx`, hash `abc`)
2. When creating Bot B, user selects "Link to Bot A"
3. We copy Bot A's encrypted key directly into Bot B's record
4. Both bots have the same `llmApiKeyId` (hash), so OpenRouter tracks them as one

**Analogy:** Imagine a corporate credit card. The CEO (owner) has the card. Employees (linked) get copies of the same card number. They all draw from the same monthly limit. If the CEO cancels the card, everyone loses access.

**Rules:**
- You can't delete an owner bot if it has linked children (must unlink first)
- You can't switch an owner from "included" to "BYOK" if it has children
- Usage queries for linked bots resolve to the owner's key hash
- Credit limit changes must happen at the owner level

### The ModelTab UI (3 Sections)

The Model tab on the deployment config page shows different UI depending on the mode:

```
Included Credits (owner):
  ┌─────────────────────────────────┐
  │ Key Status: ● Active            │
  │ Usage: $3.42 / $25.00 [████░░] │
  │ Daily: $0.52  Weekly: $2.10     │
  │                                 │
  │ Credit Limit: [$25] [Update]    │
  │ [Regenerate Key] [Revoke Key]   │
  └─────────────────────────────────┘

Linked (child):
  ┌─────────────────────────────────┐
  │ Shared Pool: $3.42 / $25.00    │
  │ [Go to Pool Owner →]           │
  │ (Read-only — manage at owner)  │
  └─────────────────────────────────┘

BYOK:
  ┌─────────────────────────────────┐
  │ Key Status: ● Configured        │
  │ [sk-or-****...**xx]            │
  │ [New Key Input] [Validate]      │
  └─────────────────────────────────┘
```

### Platform Mode and the Agent Forking Flywheel

Platform mode is part of a two-phase system for discovering and promoting the best agents on the platform:

**Phase 1 — Discovery (the Benchmarks router):**

Users rate agents on accuracy, helpfulness, and creativity within taxonomy domains (e.g., "data-analysis", "creative-writing"). Scores are aggregated in `deploymentDomainScores` and surfaced through:
- `GET /api/public/leaderboard/:domainSlug` — ranked list for any domain (no auth)
- `GET /api/public/agents/:deploymentId/profile` — full public profile (no auth)

Each entry includes a **forkability score** (0-100, computed by `computeForkabilityScore()`), which quantifies how copy-ready an agent is:

| Criterion | Points |
|---|---|
| isPublic === true | 15 |
| Has non-empty bio | 10 |
| Has >= 1 showcase prompt | 10 |
| Has >= 2 specialties | 15 |
| Rating count >= 10 with medium/high confidence | 20 |
| Overall score >= 350 (3.5/5 stars) | 20 |
| Featured by admin | 10 |

**Analogy:** Think of the leaderboard as a **Michelin Guide for AI chefs**. Diners (users) rate each chef's dishes (agent responses) on different criteria. Chefs who earn enough stars get featured, which makes them more attractive to franchise (fork).

**Phase 2 — Platform Agents:**

When an admin sees an agent worth promoting, they call `deployment.platformFork` — which creates a Jarble-managed copy with:
- `isPlatform: true` — bypass subscription and storage enforcement forever
- `resourceTier` — one of `small` (0.5 vCPU/1GB), `medium` (1 vCPU/2GB), `large` (2 vCPU/3GB)
- `llmMode: "platform"` — uses `AGENT_LLM_API_KEY` instead of any user key

**Platform agents never get stopped** by the subscription enforcer or storage enforcer, because the `isPlatform` flag is checked at the top of both enforcement loops.

**Analogy:** Jarble has scouted a great chef from the marketplace and hired them full-time. The chef now works in a Jarble-owned restaurant — Jarble pays for everything, the chef (agent) just serves customers.

---

## 9. Platform Credentials

When a user connects their bot to Discord, Slack, etc., they provide API tokens. Here's how we handle them:

### Storage

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend<br/>(Platforms Tab)
    participant API as API Server
    participant ENC as AES-256-GCM<br/>Encryption
    participant DB as Database

    User->>FE: Enter Discord bot token
    FE->>API: platformCredentials.save({<br/>deploymentId, "discord",<br/>{botToken: "abc123"}})
    API->>ENC: Encrypt JSON blob
    ENC-->>API: enc:iv:tag:ciphertext
    API->>DB: Store encrypted credentials
    API-->>FE: Masked: "abc1****3"
    FE-->>User: Shows "Configured ✓"
```

### How Credentials Get to the Bot

When deploying or syncing configs, the runtime handler transforms credentials into two formats:

```mermaid
graph TD
    DB[("Database<br/>Encrypted credentials")]
    DECRYPT["Decrypt<br/>AES-256-GCM"]
    HANDLER["Runtime Handler<br/>(openclaw.ts)"]

    DB --> DECRYPT --> HANDLER

    HANDLER --> CONFIG["Config File<br/>openclaw.json<br/>{channels: {discord: {token: '...'}}}"]
    HANDLER --> ENV["K8s Secret<br/>DISCORD_BOT_TOKEN=..."]

    CONFIG -->|"written to /data/config/"| POD["K8s Pod"]
    ENV -->|"injected as env var"| POD

    style DB fill:#3b82f6,color:#fff
    style POD fill:#22c55e,color:#fff
```

**1. Config file (openclaw.json)**
```json
{
  "channels": {
    "discord": {
      "token": "actual-bot-token-here",
      "enabled": true,
      "dmPolicy": "pairing"
    }
  }
}
```

**2. Environment variables (K8s Secret)**
```
DISCORD_BOT_TOKEN=actual-bot-token-here
```

Both are set because different runtime versions may read from either source.

### Supported Platforms

| Platform | Required Fields | Env Var Mapping |
|---|---|---|
| Discord | `botToken` | `DISCORD_BOT_TOKEN` |
| Telegram | `botToken` | `TELEGRAM_BOT_TOKEN` |
| Slack | `botToken`, `appToken` | `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` |
| WhatsApp | (QR pairing) | — |
| Teams | `appId`, `appPassword` | `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD` |
| Messenger | `pageAccessToken`, `verifyToken` | `MESSENGER_PAGE_ACCESS_TOKEN`, `MESSENGER_VERIFY_TOKEN` |
| Web | `allowedDomains` | — |

### WhatsApp QR Pairing

WhatsApp is unique among platforms — it doesn't use a static API token. Instead, it requires **QR code pairing** through the WhatsApp Web protocol (via the Baileys library inside OpenClaw).

The pairing flow runs `openclaw channels login --channel whatsapp` inside the deployed K8s pod and streams the QR data to the frontend in real-time:

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend<br/>(WhatsAppQrModal)
    participant HOOK as useQrStream<br/>(EventSource)
    participant API as API Server<br/>(SSE endpoint)
    participant K8S as K8s Pod<br/>(OpenClaw)
    participant WA as WhatsApp<br/>Servers

    User->>FE: Click "Start QR Pairing"
    FE->>HOOK: start()
    HOOK->>API: GET /api/deployments/:id/whatsapp/qr?token=JWT

    Note over API,K8S: K8s exec into pod
    API->>K8S: exec: npx openclaw channels login --channel whatsapp
    K8S->>WA: Request pairing QR
    WA-->>K8S: QR string (stdout)
    K8S-->>API: Stream stdout line-by-line
    API-->>HOOK: SSE event: qr (QR data string)
    HOOK-->>FE: Update qrData state
    FE-->>User: Render QR code (react-qr-code)

    User->>WA: Scan QR with phone
    WA-->>K8S: Session authenticated
    K8S-->>API: stdout: "successfully logged in"
    API->>API: Save WhatsApp credentials + sync configs
    API-->>HOOK: SSE event: connected
    HOOK-->>FE: Show success state
    FE-->>User: "WhatsApp Connected!"
```

**Key implementation details:**

- **`streamExecInPod()`** (`src/k8s/deployment.ts`): Unlike `execInPod()` which waits for the process to exit, this function streams stdout line-by-line via a PassThrough stream. Essential because `openclaw channels login` stays alive until the QR is scanned.
- **QR detection heuristic**: Lines longer than 50 characters containing commas or `@` signs are treated as QR data (Baileys emits QR strings in this format).
- **Connected detection**: Lines containing "successfully logged in", "whatsapp connected", "connection open", or "session saved".
- **90-second timeout**: If no QR is scanned within 90 seconds, the exec is aborted and a timeout event is sent.
- **Auth via query param**: EventSource can't set headers, so the JWT is passed as `?token=` (same pattern as log streaming).

---

## 10. Config Sync — The Two-Way Mirror

**The Problem:** Config changes can happen in two places:
1. **Frontend** — User edits system prompt, changes LLM model, adds Discord token
2. **Inside the container** — Someone (or the bot itself) modifies config files on disk

We need both to stay in sync. This is the **two-way mirror** — changes in one place reflect in the other.

```mermaid
graph LR
    subgraph FE_SIDE["Frontend Side"]
        USER["User saves<br/>config changes"]
    end

    subgraph API_SIDE["API Server"]
        SYNC_PUSH["syncConfigsToPvc()"]
        SYNC_PULL["syncConfigsFromPvc()"]
    end

    subgraph K8S_SIDE["K8s Container"]
        FILES["/data/config/<br/>soul.md, openclaw.json"]
        WATCHER["file-watcher.sh<br/>(inotifywait)"]
    end

    USER -->|"Direction 1: Push"| SYNC_PUSH
    SYNC_PUSH -->|"write files + restart"| FILES

    WATCHER -->|"Direction 2: Pull"| SYNC_PULL
    FILES -.->|"detects changes"| WATCHER
    SYNC_PULL -->|"update DB if different"| USER

    style SYNC_PUSH fill:#22c55e,color:#fff
    style SYNC_PULL fill:#3b82f6,color:#fff
```

### Tiered Sync Strategy

Not every config change requires a full pod restart. `syncConfigsToPvc()` uses a **tiered approach** to minimize downtime:

| Tier | Trigger | What Happens | Downtime |
|---|---|---|---|
| **Tier 1** | System prompt, skills changes only | Write files to PVC, no restart | 0s |
| **Tier 2** | LLM keys, platform tokens changed | Signal entrypoint to hot-restart gateway process | ~5-10s |
| **Tier 3** | Secrets removed or Tier 2 not supported | Full pod restart (scale 0→1) | ~30-60s |

All config files are written in a **single batched exec call** (one WebSocket round-trip per sync, regardless of how many files change). This reduced write latency from ~4s to ~300ms.

### Direction 1: Frontend → Container (Push)

**When it fires:** User saves changes in the config tabs.

```mermaid
sequenceDiagram
    actor User
    participant API as API Server
    participant DB as Database
    participant HANDLER as Runtime Handler
    participant K8S as K8s Pod

    User->>API: deployment.update (save changes)
    API->>DB: Update deployment record
    API-->>User: { success: true }

    Note over API,K8S: Background (fire-and-forget)
    API->>DB: Load deployment + platform creds
    API->>HANDLER: renderConfigs(deployment)
    HANDLER-->>API: soul.md, openclaw.json
    API->>K8S: Write files to /data/config/
    API->>K8S: Update K8s Secret (env vars)
    API->>K8S: Rolling restart (kubectl rollout)
    K8S-->>K8S: Pod restarts with new config
```

**Analogy:** You update the menu on the franchise management app. The system prints new menus and delivers them to the restaurant. The restaurant reopens with the updated menu.

### Direction 2: Container → Frontend (Pull)

**When it fires:** A file in `/data/config/` changes inside the container.

```mermaid
sequenceDiagram
    participant POD as K8s Pod
    participant FW as file-watcher.sh
    participant API as API Server
    participant HANDLER as Runtime Handler
    participant DB as Database

    POD->>POD: File modified in /data/config/
    POD-->>FW: inotifywait detects change
    FW->>FW: Wait 2s (debounce)
    FW->>API: POST /api/config-changed<br/>{deploymentId}
    API->>POD: Read config files from pod
    API->>HANDLER: parseConfigs(files)
    HANDLER-->>API: Structured data
    API->>DB: Compare with current values

    alt Values differ
        API->>DB: Update database
        Note over API: No restart needed<br/>(pod already has new files)
    else Values same
        Note over API: Skip update<br/>(prevents circular sync)
    end
```

**Analogy:** The chef at the restaurant changes a recipe. They call headquarters to update the master recipe book. But only if the recipe actually changed — if they just opened and closed the file, nothing happens.

### Why "Only Update If Different"?

This prevents **circular sync**:
1. Frontend changes systemPrompt → writes to PVC → file watcher fires
2. File watcher → reads PVC → compares to DB → same value → no update
3. Without the comparison: DB update → triggers another PVC write → infinite loop

---

## 11. Canvas Components & The Shared Manifest

### How Bots Render Rich UI

When a bot wants to display a chart, table, or interactive widget, it outputs a special fenced code block:

```
```jarble_ui
{"component": "data_table", "props": {"columns": ["Name","Score"], "rows": [["Alice",95]]}}
```
```

The frontend parses these blocks as the SSE stream arrives (incrementally, using a brace-depth JSON parser), validates the props, applies AutoFix repairs if needed, and renders the component in the canvas grid.

### The @jarble/component-manifest Package

**The problem:** The same component definitions needed to appear in three places:
- Frontend (Zod schemas for validation, layout hints for the grid)
- API/MCP server (component names for the `list_components` tool)
- Bot system prompt (compact reference so the LLM knows what components exist)

**The solution:** A shared package at `shared/component-manifest/` consumed by all layers.

```mermaid
graph TD
    MANIFEST["@jarble/component-manifest<br/>shared/component-manifest/index.ts"]

    MANIFEST --> REG["Jarble-mvp/components/canvas/registry.ts<br/>(Zod schemas + component mapping)"]
    MANIFEST --> RESOLVER["jarble-api-main/src/utils/componentResolver.ts<br/>(builtin name validation)"]
    MANIFEST --> LIST["jarble-api-main/src/mcp/tools/listComponents.ts<br/>(component descriptions for LLM)"]
    MANIFEST --> OC["jarble-api-main/src/runtimes/handlers/openclaw.ts<br/>(generatePromptReference for soul.md)"]
    MANIFEST --> MCP["jarble-api-main/src/mcp/jarble-ui-server.js<br/>(via generated JSON snapshot)"]

    style MANIFEST fill:#7c3aed,color:#fff
```

**Key exports:**
- `COMPONENT_MANIFEST` — keyed by component name, includes schema + layout + splittable config
- `generatePromptReference()` — produces compact LLM-friendly reference (10 inline, rest summarized → ~878 tokens saved vs old 36-inline format)
- `generateMcpReference()` — full MCP tool descriptions
- `COMPONENT_SCHEMAS` — Zod schemas for all components
- `DEFAULT_CARD_SIZES`, `MANIFEST_SPLITTABLE` — derived from manifest, replace old hardcoded objects

### Sandbox-First Rendering Strategy

The bot system prompt now designates the **sandbox component as the default** for dashboards, analytics, charts, and any visualization involving two or more visual elements. The `promptGuidance` fields in the component manifest encode this policy directly so every LLM sees it:

| Component | Guidance |
|---|---|
| `sandbox` | "YOUR DEFAULT for dashboards, analytics, charts, data viz, and any request needing 2+ visual elements. Build the ENTIRE UI in ONE sandbox with Tailwind + Chart.js/D3." |
| `chart` | "AVOID — use sandbox instead for better results. Only use as a last resort for the simplest possible single chart." |
| `metric_card` | "ONLY for a standalone single KPI display. For dashboards or requests with charts+metrics together, use sandbox instead." |
| `stat_grid` | "ONLY for a standalone metrics display with no charts. For dashboards or analytics requests, use sandbox instead." |

The sandbox `defaultSize` is 800×650. Combined with Tailwind (loaded via CDN) and Chart.js or D3, one sandbox can replace what previously required 3-5 separate typed components. This reduces token usage in system prompts and produces more coherent layouts.

### AutoFix Prop Repair (`lib/autoFixProps.ts`)

LLMs frequently produce props that are _close_ but not quite right. AutoFix runs before Zod validation to silently repair common mistakes:

```mermaid
flowchart LR
    INPUT["Raw props from jarble_ui block"]
    AUTOFIX["autoFixProps.ts<br/>20 repair rules"]
    ZOD["Zod schema validation<br/>(@jarble/component-manifest)"]
    RENDER["Render component"]
    WARN["Log warning, render with<br/>raw props anyway"]

    INPUT --> AUTOFIX --> ZOD
    ZOD -->|Pass| RENDER
    ZOD -->|Fail| WARN --> RENDER
```

**Zod-tolerant rendering (Session 18):** `CanvasRenderer` no longer shows an error card for Zod validation failures. Instead, it logs a warning and renders with the post-AutoFix props. This fixes cases like `metric_card` receiving a numeric `change` field (a valid runtime type) that Zod's string schema rejects. Error cards are still shown for actual React render crashes (caught by the component's error boundary).

The `COMPONENT_NAME_MAP` in `autoFixProps.ts` also maps several common LLM misnames to the correct component: `render_page`, `dashboard`, and `fullscreen` all resolve to the `page` component.

Sentry breadcrumbs record every repair that fires, so we can identify which rules are most needed and add new ones.

### Canvas Grid

The `/d/[id]` page shows a CSS grid where bot responses appear as cards:

```
User message → bot streams text + UI blocks → cards appear in grid
```

**Grid features:**
- Drag any card to swap positions with another
- **Split**: cards from multi-item components (stat_grid, key_value, descriptions) can split into individual cards
- **Merge**: compatible cards can be combined
- No borders or padding on components — they fill their card area (`p-3 h-full`)

### Error Resilience in Chat + Canvas

Three guards prevent the chat/canvas pipeline from getting stuck or crashing:

**1. Safe SSE sendEvent** (`tamboAgent.ts`)
The `sendEvent()` helper wraps `JSON.stringify()` in a try/catch. If an event contains non-serializable data (e.g., circular references from certain tool outputs), it sends a fallback error event instead of crashing the SSE stream. Internal error details are redacted before reaching the client.

**2. Pending Block Timeout** (`useCanvasChat.ts`)
UI blocks (`jarble_ui` fenced blocks) are tracked as "pending" while streaming. If a block is still open after **10 seconds** (e.g., the stream was interrupted mid-block), it is automatically discarded. All pending blocks are also cleared when the stream ends (`RUN_FINISHED` event).

**3. Component Expansion Limits** (`componentResolver.ts`)
Custom component templates are validated before they reach the canvas:
- Max 20 children per layout definition
- Max 50 KB definition size (JSON)
- Max 256 KB total resolved props size (after variable substitution)

Oversized props return an empty result rather than crashing the renderer.

### Marketplace Sandbox (Double-Iframe Security)

Marketplace sandbox-tier components run arbitrary HTML/CSS/JS. They use a **double-iframe** architecture for security:

```
Outer iframe: sandboxed (no same-origin, allow-scripts only)
  └── Inner iframe: user's HTML + JS runs here
      └── Communicates with outer via postMessage
```

This prevents sandbox code from accessing the Jarble app's DOM, cookies, or localStorage. The CSP further restricts what the sandbox can load — only origins in `TRUSTED_CDN_ORIGINS` are allowed.

**Defense-in-depth CDN validation**: `sandboxCore.ts:buildDocument()` validates all library URLs AND extracted `<script src>` / `<link href>` tags from the `html` prop against `TRUSTED_CDN_ORIGINS` **on the client side**, as an additional layer on top of the server-side validation in `uiBlockParser.ts`.

---

## 12. Real-Time Updates (SSE)

### What Is SSE?

**Server-Sent Events** is a way for the server to push data to the browser over a single HTTP connection.

**Analogy:** Imagine subscribing to a news ticker. You open the connection once, and headlines appear as they happen. You don't need to keep refreshing the page.

Compared to alternatives:
- **Polling** (old way): "Are we there yet? Are we there yet?" every 3 seconds
- **WebSockets**: Two-way walkie-talkie — overkill when we only need server→client
- **SSE** (what we use): One-way radio broadcast — simple, efficient, auto-reconnects

### Status Stream

```mermaid
sequenceDiagram
    participant FE as Frontend<br/>(useStatusStream)
    participant API as API Server
    participant K8S as Kubernetes

    FE->>API: GET /api/deployments/status/stream?token=JWT
    Note over FE,API: Persistent SSE connection opens

    loop Every 5 seconds
        API->>K8S: Check all user pod statuses
        K8S-->>API: Pod statuses

        alt Status changed
            API-->>FE: data: {type:"delta", statuses:{id:"running"}}
            Note over FE: Dashboard card updates instantly
        end
    end

    loop Every 30 seconds
        API-->>FE: : ping (keep-alive)
    end

    Note over FE: Auto-reconnects if connection drops
```

### Log Stream

```mermaid
sequenceDiagram
    participant FE as Frontend<br/>(useLogStream)
    participant API as API Server
    participant K8S as K8s Pod

    FE->>API: GET /api/deployments/:id/logs/stream?token=JWT
    Note over FE,API: Persistent SSE connection opens

    API->>K8S: Follow pod logs (tail -f style)

    loop Each new log line
        K8S-->>API: "[2026-02-16 10:32:01] INFO: Bot connected"
        API-->>FE: data: {type:"log", line:"..."}
        Note over FE: Parse timestamp, colorize severity<br/>ERROR=red, WARN=yellow, INFO=blue
    end
```

Think of it like `tail -f` but in your browser.

### Agent Orchestration Events

When one bot calls another through the marketplace Agent Hub, the chat SSE stream surfaces that delegation in real time. The flow uses an **in-process EventEmitter bridge** so the Agent Hub HTTP handler can notify active SSE streams without shared state or a message broker:

```mermaid
sequenceDiagram
    participant Pod as Bot Pod<br/>(MCP call_agent)
    participant HUB as POST /api/agent-hub/call
    participant EE as agentCallEvents<br/>(EventEmitter, in-process)
    participant SSE as POST /api/tambo-agent<br/>(active stream)
    participant FE as Frontend<br/>(useCanvasChat)

    Pod->>HUB: {callerDeploymentId, serviceId, skillName}
    HUB->>EE: emit("start", event)
    EE-->>SSE: listener fires (if deploymentId matches)
    SSE-->>FE: CUSTOM jarble.agent.call.start
    Note over FE: setActiveAgentCall({serviceId, skillName})

    HUB->>HUB: executeAgentCall()
    HUB->>EE: emit("end", {creditsCharged, success})
    EE-->>SSE: listener fires
    SSE-->>FE: CUSTOM jarble.agent.call.end
    Note over FE: setActiveAgentCall(null)
```

**Key implementation details:**
- `agentCallEvents` is a module-level `EventEmitter` (`src/utils/agentCallEvents.ts`) shared by the same Node.js process. Works because the API is single-process (not multi-worker).
- The SSE handler registers `onAgentCallStart` / `onAgentCallEnd` listeners when the stream opens and removes them on `close`/`finish` to prevent listener leaks.
- `setMaxListeners(100)` is set to accommodate many concurrent chat streams without Node.js warnings.
- The frontend `useCanvasChat` hook updates `activeAgentCall` state, which the chat UI can use to render an inline delegation indicator while the sub-agent is working.

### Why `?token=` Instead of Headers?

The browser's `EventSource` API (used for SSE) can't set custom headers. So we pass the JWT as a query parameter instead of in the `Authorization` header. The backend accepts both formats.

---

## 12.5. The Flow Engine (Orchestration)

### What Is a Flow?

A **flow** is a visual DAG (directed acyclic graph) of nodes connected by edges. Each node represents one step of work — calling a deployment (bot), running a transform, evaluating a condition, or rendering an output. Flows let you chain multiple bots and services into multi-step agent pipelines without writing code.

**Analogy:** Think of a flow like a **factory assembly line**. Each station (node) does one job, then passes the product to the next station (edge). The line can branch (condition node) or merge (multiple inputs to one node). A human-in-the-loop node is like a quality control checkpoint — the line pauses until a human approves and the line resumes.

### Node Types

| Type | What It Does |
|---|---|
| `deployment` | Calls a bot deployment (sends a message, gets a response) |
| `transform` | Transforms the previous node's output (filter, format, extract) |
| `condition` | Branches to different nodes based on a condition expression |
| `output` | Renders the result (renders a UI component, logs, returns to caller) |

### How Execution Works

```mermaid
flowchart TD
    START([User POSTs to /api/flows/:flowId/execute]) --> CREATE["Create FlowExecutionEngine<br/>(executionId generated)"]
    CREATE --> TOPOLOGICAL["Topological sort of nodes<br/>(respects edge dependencies)"]
    TOPOLOGICAL --> LOOP{Next node?}

    LOOP -->|Yes| EXECUTE["Execute node<br/>(call deployment / transform / etc.)"]
    EXECUTE --> EMIT["Emit step:started / step:finished events"]
    EMIT --> LOOP

    LOOP -->|Human-in-the-loop| PAUSE["Emit flow:paused<br/>(with inputSchema)"]
    PAUSE --> WAIT["Wait for POST .../resume"]
    WAIT --> RESUME["Resume from paused node<br/>with user input"]
    RESUME --> LOOP

    LOOP -->|No more nodes| COMPLETE["Emit flow:state { status: completed }"]
    COMPLETE --> PERSIST["Write final state to flow_executions table"]
```

The engine runs in the background (fire-and-forget from the POST handler). The client connects to the `GET .../stream` SSE endpoint to receive real-time events. If the client disconnects and reconnects, the `jarble.flow.snapshot` event sends the current state so the client can catch up.

### How to Add a New Flow Node Type

1. Add the type to the `FlowNodeSchema` enum in `jarble-api-main/src/trpc/routers/flows.ts`
2. Add an execution handler in `jarble-api-main/src/services/flowEngine.ts` — the `executeNode(node, context)` switch statement
3. The new type automatically appears in the canvas editor (frontend reads the schema via tRPC)
4. Add a corresponding node component in `Jarble-mvp/components/canvas/flow/` if custom rendering is needed

### The AI Flow Builder

Users can describe a flow in plain English and the system generates a `FlowDefinition` using the `WORKFLOW_AGENT_SYSTEM_PROMPT`. The `flows.generateFromPrompt` mutation:

1. Sends the user's prompt to the configured `AGENT_LLM_MODEL`
2. The LLM returns a JSON plan: `{ plan: [{ step, action, service, skill, description, dependsOn }], summary, parallelizable }`
3. The server converts the plan into `FlowNode[]` and `FlowEdge[]` (auto-layouts on a grid)
4. Returns `{ definition, summary, estimatedSteps, parallelizable }` — unsaved, ready to pass to `flows.create`

---

## 13. Authentication Flow

We use **Auth0** for authentication. We never see or store user passwords.

### The Login Flow

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant AUTH0 as Auth0
    participant API as API Server
    participant DB as Database

    User->>FE: Click "Sign In"
    FE->>AUTH0: Redirect to hosted login
    User->>AUTH0: Login with Google / GitHub / Email
    AUTH0->>FE: Redirect to /dashboard + auth code
    FE->>AUTH0: Exchange code for JWT
    AUTH0-->>FE: Access token (JWT)
    Note over FE: Token stored via Auth0 SDK

    FE->>API: GET /trpc/user.me<br/>Authorization: Bearer <JWT>
    API->>AUTH0: Verify JWT via JWKS public keys
    AUTH0-->>API: Token valid ✓
    API->>DB: Find user by Auth0 ID

    alt First-time user
        API->>DB: Auto-create user record
        Note over DB: Extract name + email from JWT claims
    end

    API-->>FE: User profile
    FE-->>User: Dashboard loads ✅
```

**Analogy:** Auth0 is like a bouncer at a club. You show the bouncer your ID (Google/GitHub/email), the bouncer stamps your hand (gives you a JWT), and every time you want a drink (API call), you show your stamp.

### User Provisioning

When someone logs in for the first time:
1. Backend verifies the JWT
2. Looks for a user with that Auth0 ID in our database
3. If not found: **auto-creates** a user record (no signup form needed)
4. Extracts name and email from the JWT claims

### Email Verification

Users must verify their email before deploying bots (prevents abuse). The flow:
1. Auth0 sends verification email on signup
2. We check `emailVerified` flag on every deploy attempt
3. If not verified: show banner + block deployment
4. User can click "Resend" (calls Auth0 Management API)
5. Auth0 Post Login Action webhook notifies us when verified

---

## 14. Payments (Stripe)

### The Payment Flow

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant API as API Server
    participant STRIPE as Stripe
    participant DB as Database

    User->>FE: Click "Subscribe" on pricing page
    FE->>API: POST /api/stripe/checkout {tier: "openclaw"}
    API->>STRIPE: Create Checkout Session
    STRIPE-->>API: Session URL
    API-->>FE: Redirect URL
    FE->>STRIPE: Redirect to Stripe payment page
    User->>STRIPE: Enter credit card & pay
    STRIPE-->>FE: Redirect back to app

    Note over STRIPE,API: Webhook (async)
    STRIPE->>API: checkout.session.completed
    API->>DB: Store pendingStripeSubscriptionId on user

    Note over User,FE: Later...
    User->>FE: Create new deployment
    FE->>API: deployment.create(...)
    API->>DB: Consume pending subscription → link to deployment
    Note over DB: Deployment is now "paid" ✅
```

### Subscription Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Active : checkout.session.completed

    Active --> Cancelling : User clicks Cancel
    note right of Cancelling: cancel_at_period_end = true<br/>Bot keeps running<br/>User sees "X days left"

    Cancelling --> Active : User clicks Reactivate
    Cancelling --> Stopped : Billing period ends<br/>(subscription.deleted)
    note right of Stopped: K8s scaled to 0<br/>PVC data preserved

    Active --> PaymentFailed : invoice.payment_failed
    note right of PaymentFailed: Warning shown on dashboard

    PaymentFailed --> Active : Payment succeeds
    PaymentFailed --> Stopped : Subscription cancelled
```

### The "Pending Subscription" Pattern

**The Problem:** Stripe sends the webhook (with subscription ID) almost immediately after checkout. But the user hasn't created a deployment yet — they're still on the redirect page.

**The Solution:**
1. Webhook arrives → store `pendingStripeSubscriptionId` on the user
2. User creates deployment → consume the pending subscription
3. Clear the pending fields

**Fallback:** If the timing is weird, there's a `linkSubscription` mutation that searches Stripe for unlinked subscriptions.

### Webhook Idempotency

Stripe may re-deliver events (retries, network issues). We prevent duplicate processing via the `processedWebhookEvents` table:

1. Webhook arrives → check if `eventId` exists in the table
2. If exists → skip (already processed)
3. If not → insert the row first (atomically), then process
4. Concurrent inserts (multiple workers) are caught by primary key constraint → treated as "already being handled"

This makes the webhook handler safe against duplicate deliveries across multiple API replicas.

---

## 15. Encryption

### What Gets Encrypted

| Data | Where Stored | Algorithm |
|---|---|---|
| LLM API keys | `deployments.llmApiKey` | AES-256-GCM |
| Platform tokens | `platformCredentials.credentials` | AES-256-GCM |

### How It Works

```mermaid
graph LR
    subgraph Encrypt["Encryption"]
        PLAIN["Plaintext<br/>sk-or-v1-abc123..."]
        IV["Random 16-byte IV"]
        KEY["API_KEY_ENCRYPTION_KEY<br/>(env var)"]
        AES["AES-256-GCM"]
        STORED["Stored in DB<br/>enc:iv:tag:ciphertext"]

        PLAIN --> AES
        IV --> AES
        KEY --> AES
        AES --> STORED
    end

    subgraph Decrypt["Decryption"]
        STORED2["enc:iv:tag:ciphertext"]
        SPLIT["Split by ':'"]
        AES2["AES-256-GCM"]
        VERIFY["Auth tag verification<br/>(tamper detection)"]
        RESULT["Plaintext key"]

        STORED2 --> SPLIT --> AES2
        AES2 --> VERIFY --> RESULT
    end

    style PLAIN fill:#ef4444,color:#fff
    style STORED fill:#22c55e,color:#fff
    style STORED2 fill:#22c55e,color:#fff
    style RESULT fill:#ef4444,color:#fff
```

**Development mode:** If `API_KEY_ENCRYPTION_KEY` is not set, keys are stored as `plain:sk-or-v1-abc123...` (not encrypted). This is fine for local dev with SQLite.

**Analogy:** AES-256-GCM is like a lockbox with a tamper-evident seal. You need the key to open it, and if anyone tries to modify the contents without the key, the seal breaks and decryption fails.

### When Keys Get Decrypted

Keys are decrypted ONLY when they need to leave our system:
- Injecting into K8s Secrets (so the bot container can use them)
- Config sync (writing openclaw.json with actual tokens)
- Key validation (checking if a user's BYOK key works)

They are NEVER decrypted for display. The frontend only sees masked versions.

---

## 16. Infrastructure (Terraform + Hetzner)

### What Is Terraform?

**Terraform is like a blueprint for your servers.** Instead of manually clicking buttons in a hosting dashboard, you write a file that describes what you want, and Terraform builds it for you.

```
terraform plan   → "Here's what I would build" (preview)
terraform apply  → "Building it now" (creates servers)
terraform destroy → "Tearing it all down" (deletes everything)
```

### What We Provision

On **Hetzner Cloud** (a German hosting provider, way cheaper than AWS):

```mermaid
graph TB
    subgraph Hetzner["Hetzner Cloud (~$24/mo)"]
        FIP["Floating IP<br/>~$1/mo<br/>Public DNS entry"]

        subgraph PN["Private Network (10.0.0.0/16)"]
            MASTER["Master Node (cpx21)<br/>3 CPU, 4GB RAM<br/>~$7.59/mo"]
            WORKER1["Worker Node 1 (cpx21)<br/>3 CPU, 4GB RAM<br/>~$7.59/mo"]
            WORKER2["Worker Node 2 (cpx21)<br/>3 CPU, 4GB RAM<br/>~$7.59/mo"]
        end

        FIP --> MASTER

        MASTER -->|"K3s server"| WORKER1
        MASTER -->|"K3s server"| WORKER2

        TRAEFIK["Traefik Ingress"] --> MASTER
        LONGHORN["Longhorn Storage"] -.-> WORKER1
        LONGHORN -.-> WORKER2
    end

    INTERNET["Internet"] --> FIP

    style MASTER fill:#f59e0b,color:#fff
    style WORKER1 fill:#3b82f6,color:#fff
    style WORKER2 fill:#3b82f6,color:#fff
```

```
Master Node → Runs K3s server, installs Longhorn, creates "jarble" namespace
Worker Nodes → Join the K3s cluster, run user bot containers
Floating IP → Public IP that DNS points to, routes through Traefik
Private Network → Internal communication between nodes, not internet-accessible

Total: ~$24/month for the base cluster
```

### K3s vs K8s

**K3s is a lightweight version of Kubernetes** designed for edge/small deployments. Same API, same concepts, but packaged as a single binary instead of 10+ components. Perfect for our scale.

**Analogy:** K3s is to K8s what a compact car is to a semi-truck. Same road rules, same fuel, but much easier to park.

### Longhorn Storage + Hetzner Block Storage

Longhorn is a **distributed storage system** for Kubernetes. When we create a PVC (storage locker), Longhorn:
- Allocates the disk space from the node's **Hetzner Block Storage** volume
- Replicates data across nodes (survives node failure)
- Handles attach/detach when pods move between nodes

**Analogy:** Longhorn is like a RAID array spread across multiple buildings. Even if one building burns down, your data is safe in the others.

**Why Block Storage?** The cpx21 only has 80 GB local disk (for OS + K3s + images). Users can allocate up to 100 GB per deployment, so PVCs must live on separately attached Hetzner Block Storage volumes (up to 10 TB each). The required size follows the formula **d x p** — deployments per node multiplied by max storage per deployment. See Section 6 "Storage Architecture" for a detailed breakdown.

**How it works:** Terraform provisions `hcloud_volume` resources (default 100 GB, ext4-formatted) per worker node. The agent `user_data` script mounts each volume at `/var/lib/longhorn` before K3s starts, so Longhorn discovers the block storage on node registration. The mount is persisted via `/etc/fstab` with `nofail` (safe boot) and `discard` (TRIM for SSD).

### TLS (cert-manager + Let's Encrypt)

HTTPS certificates are automatically provisioned via **cert-manager** and **Let's Encrypt**:

```mermaid
graph LR
    CM["cert-manager<br/>(installed via Terraform)"] --> CI["ClusterIssuer<br/>letsencrypt-prod"]
    CI --> ACME["Let's Encrypt ACME<br/>HTTP-01 challenge"]
    ACME --> CERT["Certificate<br/>jarble-api-tls"]
    CERT --> ING["Ingress<br/>api.jarble.ai"]
    ING --> TRAEFIK["Traefik"]

    style CERT fill:#22c55e,color:#fff
```

| Resource | File | Purpose |
|----------|------|---------|
| ClusterIssuer | `k8s/cert-manager.yaml` | Configures Let's Encrypt ACME with HTTP-01 solver through Traefik |
| Ingress TLS | `k8s/deployment.yaml` | `spec.tls` block references the issuer, stores cert in `jarble-api-tls` secret |
| cert-manager install | `terraform/main.tf` | Auto-installed in K3s master `user_data` (v1.14.5) |

**How it works:** When the Ingress is created with the `cert-manager.io/cluster-issuer` annotation, cert-manager automatically requests a certificate from Let's Encrypt, proves domain ownership via an HTTP-01 challenge (served through Traefik), and stores the signed certificate in a K8s Secret. Certificates auto-renew before expiry.

### Terraform CI/CD

Infrastructure changes are managed through a GitHub Actions pipeline (`.github/workflows/terraform.yml`):

```mermaid
graph LR
    subgraph Triggers
        PR["PR to main"]
        PUSH["Push to main"]
        MANUAL["Manual Dispatch"]
    end

    subgraph Pipeline
        CHECK["Format & Validate"]
        PLAN["Plan"]
        APPROVE["Manual Approval<br/>(production environment)"]
        APPLY["Apply"]
    end

    subgraph State
        TFC["Terraform Cloud<br/>(free tier)<br/>State + Locking"]
    end

    PR --> CHECK --> PLAN -->|"PR comment"| PR
    PUSH --> CHECK --> PLAN --> APPROVE --> APPLY
    MANUAL --> CHECK --> PLAN --> APPROVE --> APPLY
    PLAN <--> TFC
    APPLY <--> TFC

    style APPROVE fill:#f59e0b,color:#fff
    style TFC fill:#7c3aed,color:#fff
```

| Trigger | What Happens |
|---------|-------------|
| PR to main (`infrastructure/terraform/**`) | fmt check, validate, plan — posts plan as PR comment |
| Push to main | Plan + apply with manual approval gate |
| Manual: `plan-only` | Run plan without applying |
| Manual: `apply` | Plan + apply with approval |
| Manual: `destroy` | Requires typed confirmation string + approval (two safety layers) |

**Remote state:** Terraform Cloud (free tier) stores state and provides locking. Execution mode is "Local" — plan/apply runs in GitHub Actions runners (or locally), not in TFC runners. Both local and CI operations share the same state.

**Required secrets:** `HCLOUD_TOKEN` (Hetzner API), `TF_API_TOKEN` (Terraform Cloud), `SSH_PUBLIC_KEY` (server access key content).

---

## 17. Runtime Images (Docker)

### What Is a Docker Image?

Think of a Docker image as a **recipe for a sandwich**:
- The recipe lists all ingredients (OS, Node.js, tools)
- The recipe has instructions (install dependencies, set up directories)
- When you "make" the sandwich (run the container), you get an identical result every time

### OpenClaw Image

```dockerfile
Base: Node.js 22 on Debian
Added tools: git, tini (process manager), inotify-tools (file watcher), curl
Directory structure: /data/{config, runtime, logs, .openclaw}
Gateway port: 18789

First boot:
  npm install openclaw@latest
  Write default soul.md ("You are a helpful AI assistant")
  Generate openclaw.json config
  Touch .initialized marker

Every boot:
  Start file watcher (background)
  Start gateway: npx openclaw gateway --port 18789
```

### ZeroClaw Image

```dockerfile
Base: Debian (slim) with pre-built Rust binary (~3.4MB)
Added tools: curl, tini, inotify-tools
Directory structure: /data/{config, zeroclaw-data, logs}
Gateway port: 3000
Health check: zeroclaw doctor (every 30s)

First boot:
  Write default config.toml
  Touch .initialized marker

Every boot:
  Start file watcher (background)
  Start gateway: zeroclaw gateway --port 3000
```

### The Entrypoint Pattern

Both runtimes follow the same pattern:

```mermaid
flowchart TD
    START([Container Starts]) --> CHECK{".initialized<br/>file exists?"}

    CHECK -->|No — First Boot| INSTALL["Install runtime<br/>(npm install / copy binary)"]
    INSTALL --> DEFAULTS["Create default config files<br/>(soul.md, openclaw.json)"]
    DEFAULTS --> MARK["Create .initialized marker"]
    MARK --> WATCHER

    CHECK -->|Yes — Subsequent Boot| WATCHER["Start file-watcher.sh<br/>(background process)"]
    WATCHER --> GATEWAY["Start bot gateway<br/>(foreground process)"]
    GATEWAY --> ONLINE(["Bot is online 🟢"])

    style INSTALL fill:#f59e0b,color:#fff
    style ONLINE fill:#22c55e,color:#fff
```

**Why check `.initialized`?** Because PVC data persists across restarts. We don't want to reinstall everything every time the container starts — that would take minutes. First boot takes ~30 seconds; subsequent boots take ~3 seconds.

---

## 18. The Database

### Multi-Database Support

| Environment | Database | Connection |
|---|---|---|
| **Development** | SQLite (in-memory) | No setup needed, auto-creates tables + seed data. Set `USE_SQLITE=true` or `DB_PROVIDER=sqlite` |
| **Production** | PostgreSQL | `DATABASE_URL` env var, Drizzle migrations in `drizzle-pg/`. Set `DB_PROVIDER=postgres` |
| **Legacy** | MySQL | Separate schema file, migrations in `drizzle/`. Set `DB_PROVIDER=mysql` |

> **New: `DB_PROVIDER` env var** — explicitly selects the database backend (`sqlite`, `mysql`, `postgres`). Takes precedence over the legacy `USE_SQLITE` flag.

### Tables

```mermaid
erDiagram
    users ||--o{ deployments : "owns"
    users {
        int id PK
        string auth0Id UK
        string email
        string name
        boolean emailVerified
        string stripeCustomerId
        string pendingStripeSubscriptionId
    }

    deployments ||--o{ platformCredentials : "has"
    deployments {
        string id PK
        int userId FK
        string name
        string status
        string runtimeSlug
        string llmMode
        string llmProvider
        string llmApiKey
        string llmApiKeyId
        string llmApiKeySourceDeploymentId FK
        string stripeSubscriptionId
        boolean isFree
    }

    runtimeCatalog {
        int id PK
        string slug UK
        string name
        string image
        int monthlyPrice
        boolean active
    }

    platformCredentials {
        int id PK
        string deploymentId FK
        string platformId
        text credentials
    }

    processedWebhookEvents {
        string eventId PK
        string eventType
        timestamp processedAt
    }

    skillsCatalog {
        int id PK
        string slug UK
        string name
        boolean isActive
    }

    deploymentSkills {
        string id PK
        string deploymentId FK
        int skillId FK
    }

    creatorProfiles {
        string id PK
        string userId FK
        string displayName
    }

    marketplaceComponents {
        string id PK
        string creatorId FK
        string name UK
        string tier "template or sandbox"
        string status "draft/pending/published/rejected"
    }

    componentVersions {
        string id PK
        string componentId FK
        string version
        text template
    }

    componentInstalls {
        string id PK
        string deploymentId FK
        string componentId FK
    }

    componentPurchases {
        string id PK
        string userId FK
        string componentId FK
    }

    componentReviews {
        string id PK
        string userId FK
        string componentId FK
        int rating
    }

    marketplaceServices {
        string id PK
        string creatorId FK
        string name
        string hostingModel "package or hosted"
        text instructionSnippet
        string status "draft/pending/published/rejected"
    }

    serviceInstalls {
        string id PK
        string deploymentId FK
        string serviceId FK
        timestamp installedAt
    }

    serviceCredentials {
        string id PK
        string deploymentId FK
        string packageId FK
        text signingSecret "AES-256-GCM encrypted HMAC secret"
        text remoteApiConfig "ServiceCard JSON"
    }

    auditLogs {
        string id PK
        string userId FK
        string action
        string targetType
        string targetId
        text metadata
        string ipAddress
        timestamp createdAt
    }

    betaSignups {
        string id PK
        string name
        string email UK
        string status "pending or invited"
        text useCase
        string experience
        timestamp invitedAt
        timestamp createdAt
    }

    orchestrationFlows {
        string id PK "flw_xxx"
        string userId FK
        string name
        text description
        text definition "JSON: { nodes: FlowNode[], edges: FlowEdge[] }"
        string status "draft | published | archived"
        boolean isPublic
        int forkCount
        string forkedFromId FK
        timestamp createdAt
        timestamp updatedAt
    }

    flowExecutions {
        string id PK "fex_xxx"
        string flowId FK
        string userId FK
        string status "pending | running | completed | failed | cancelled"
        text stepResults "JSON: Record<nodeId, { status, result, error, durationMs }>"
        int totalCreditsCharged
        text error
        timestamp startedAt
        timestamp completedAt
        timestamp createdAt
    }
```

### The ORM (Drizzle)

We use **Drizzle ORM** — a type-safe SQL builder. It's like writing SQL but with TypeScript autocomplete:

```typescript
// Instead of raw SQL:
// SELECT * FROM deployments WHERE userId = ? ORDER BY createdAt DESC

// We write:
const deployments = await db
  .select()
  .from(deploymentsTable)
  .where(eq(deploymentsTable.userId, userId))
  .orderBy(desc(deploymentsTable.createdAt));
```

### Seed Data (Dev Only)

When running locally with SQLite, the database auto-creates:
- 2 runtimes (OpenClaw, ZeroClaw) in the catalog
- 1 test user (test@jarble.ai)
- 1 test deployment (running, free trial)

---

## 19. Environment Variables

### Frontend (`.env.local`)

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001    # Backend URL
NEXT_PUBLIC_AUTH0_DOMAIN=jarble-dev.us.auth0.com
NEXT_PUBLIC_AUTH0_CLIENT_ID=1VR30862...
NEXT_PUBLIC_AUTH0_AUDIENCE=https://api.jarble.ai

# Optional monitoring (omit to disable)
NEXT_PUBLIC_SENTRY_DSN=https://xxx@sentry.io/xxx
NEXT_PUBLIC_POSTHOG_KEY=phc_xxx
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com  # default
```

### Backend (`.env`)

```bash
# Server
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Database
DB_PROVIDER=sqlite                    # sqlite | mysql | postgres (overrides USE_SQLITE)
USE_SQLITE=true                       # Legacy: same as DB_PROVIDER=sqlite
DATABASE_URL=mysql://user:pass@localhost:3306/jarble  # Not needed for SQLite

# Mock K8s (local dev without a real cluster)
MOCK_K8S=true                         # Enables in-memory K8s simulation

# Auth0
AUTH0_DOMAIN=jarble-dev.us.auth0.com
AUTH0_AUDIENCE=https://api.jarble.ai
AUTH0_M2M_SECRET=shared-secret-for-email-webhook
AUTH0_MGMT_CLIENT_ID=management-api-client-id
AUTH0_MGMT_CLIENT_SECRET=management-api-secret

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# OpenRouter
OPENROUTER_API_KEY=sk-or-...          # For model listing
OPENROUTER_MANAGEMENT_KEY=sk-or-...   # For tenant key provisioning

# Encryption (32-byte hex = 64 hex chars)
API_KEY_ENCRYPTION_KEY=0123456789abcdef...

# Agent / Flow LLM (for flow generation, platform agents, dashboard compose)
AGENT_LLM_API_KEY=sk-ant-...            # Falls back to OPENROUTER_API_KEY
AGENT_LLM_PROVIDER=openrouter           # anthropic | openai | openrouter | google
AGENT_LLM_MODEL=anthropic/claude-sonnet-4-20250514

# Admin & Beta
ADMIN_USER_IDS=user_abc,user_def        # Comma-separated user IDs granted super_admin on login
RESEND_API_KEY=re_...                   # For sending beta invite emails (optional)

# Monitoring
PROMETHEUS_URL=http://prometheus:9090   # Cluster Prometheus URL for admin metrics (optional)
```

---

## 19.5. Running Tests

### API Tests

```bash
cd jarble-api-main
npm run test          # Run all Vitest unit tests
npm run typecheck     # TypeScript type-check (no output = pass)
```

The API test suite has **82 test files** covering routers, services, utilities, and the flow engine. Tests run against an in-memory SQLite database — no external dependencies required.

Key test areas:
- `src/trpc/routers/*.test.ts` — tRPC procedure tests (input validation, auth guards, DB interactions)
- `src/services/*.test.ts` — Service unit tests (flowEngine, auditLog, prometheus)
- `src/utils/*.test.ts` — Utility function tests (encryption, env, slugs)

### Frontend Tests

```bash
cd Jarble-mvp
npm run test          # Run all Vitest unit tests
npm run check         # TypeScript type-check
npm run check:manifest  # Verify manifest ↔ component sync
```

The frontend test suite has **37 test files** covering hooks, utilities, component rendering, and canvas logic.

### Running Both Test Suites

```bash
# From the monorepo root
cd jarble-api-main && npm run test
cd ../Jarble-mvp && npm run test
```

---

## 19.6. Mobile Development Notes

The frontend is primarily designed for desktop (the deployment wizard, canvas workspace, and configuration tabs require significant horizontal space). However, the public-facing chat page (`/d/[id]`) is fully responsive.

**Breakpoints used (Tailwind v4):**

| Breakpoint | Width | Behavior |
|---|---|---|
| default (mobile) | < 640px | Single-column layout, sidebar hidden |
| `sm` | ≥ 640px | Form columns start expanding |
| `md` | ≥ 768px | Sidebar visible, two-column layouts |
| `lg` | ≥ 1024px | Full canvas workspace, three-column |
| `xl` | ≥ 1280px | Dashboard optimized |

**Chat page (`/d/[id]`) responsive behavior:**
- On mobile, the canvas panel hides and only the chat panel shows
- The conversation history sidebar is hidden below `md` breakpoint (accessible via toggle)
- Canvas cards render in a single scrollable column on mobile

**Wizard and dashboard:**
- The onboarding wizard is capped at `max-w-2xl` and centers on large screens
- The main dashboard requires at least `md` width to display the deployment grid usably
- The service marketplace tabs collapse to a scrollable tab strip below `sm`

---

## 20. Local Development Setup

### Prerequisites

- Node.js 22+
- npm
- Git

### Quick Start

```bash
# Clone the repo
git clone https://github.com/Jarble-AI/develop-monorepo.git
cd develop-monorepo

# Install frontend dependencies
cd Jarble-mvp
npm install

# Install backend dependencies
cd ../jarble-api-main
npm install

# Start both servers (in separate terminals):

# Terminal 1 — API (port 3001)
cd jarble-api-main
npm run dev

# Terminal 2 — Frontend (port 3000)
cd Jarble-mvp
npm run dev
```

The API starts with an **in-memory SQLite database** pre-seeded with test data. No database setup needed.

### What Works Locally Without External Services

| Feature | Works Locally? | Notes |
|---|---|---|
| Frontend UI | Yes | Full navigation and forms |
| Auth0 login | Yes | Uses dev tenant (pre-configured) |
| Dashboard | Yes | Shows seeded test deployment |
| Onboarding wizard | Yes | All steps render. Use `dev-*` prefix keys to bypass LLM validation |
| tRPC queries | Yes | SQLite has seed data |
| K8s deployment | Yes (mock) | Set `MOCK_K8S=true` — uses in-memory simulation |
| Stripe payments | Partial | Need Stripe test keys. Subscription/storage enforcement skipped in dev |
| OpenRouter provisioning | Partial | Need management key |
| Config sync | Yes (mock) | With `MOCK_K8S=true`, config files read/write to in-memory store |
| LLM key validation | Yes (bypass) | Keys prefixed with `dev-` are accepted without calling provider APIs |
| Marketplace browsing | Yes | Reads from SQLite marketplace tables (empty on fresh start) |
| Service marketplace | Yes | Reads from SQLite service tables. Hosted service proxy requires creator API running |
| Artifact workspace | Partial | Needs a running pod (exec-based). Works with real or mock K8s |
| Canvas chat (/d/[id]) | Partial | Needs a running pod for actual chat. UI renders without it |
| Sentry / PostHog | No | Omit `NEXT_PUBLIC_SENTRY_DSN` and `NEXT_PUBLIC_POSTHOG_KEY` to disable |
| Manifest CI check | Yes | Run `npm run check:manifest` from `jarble-api-main/` |
| Agent hub | Yes | `/api/agent-hub/discover` works immediately. `/api/agent-hub/call` requires published marketplace services |
| Benchmarks / leaderboard | Yes | tRPC procedures and public REST endpoints work with SQLite (empty on fresh start) |
| Platform agents / platformFork | Yes | Admin-only mutation works with MOCK_K8S. Requires `AGENT_LLM_API_KEY` or `OPENROUTER_API_KEY` for platform mode inference |
| Dashboard compose | Partial | `POST /api/pod/compose` requires `AGENT_LLM_API_KEY` or `OPENROUTER_API_KEY` and pod gateway auth |
| Flow engine (create/run) | Yes | tRPC flows.* and flow execution REST routes work with SQLite. SSE streaming works locally |
| Flow AI builder | Partial | `flows.generateFromPrompt` requires `AGENT_LLM_API_KEY` or `OPENROUTER_API_KEY` |
| Admin panel | Partial | Admin tRPC procedures work locally with `ADMIN_USER_IDS` set. Prometheus metrics need a running Prometheus |
| Beta signups | Yes | `POST /api/beta-signup` writes to SQLite. Email sending requires `RESEND_API_KEY` |

---

## 21. Production Deployment

### End-to-End Deployment Flow

```mermaid
graph TB
    subgraph Dev["Development"]
        CODE["Push code to main"]
    end

    subgraph CI["GitHub Actions CI/CD"]
        API_CI["build-api-image.yml<br/>→ ghcr.io/jarble-ai/api"]
        RT_CI["build-runtime-images.yml<br/>→ ghcr.io/jarble-ai/openclaw<br/>→ ghcr.io/jarble-ai/zeroclaw"]
        TF_CI["terraform.yml<br/>→ Plan / Apply"]
    end

    subgraph Infra["Hetzner Cloud (via Terraform)"]
        K3S["K3s Cluster"]
        TRAEFIK["Traefik + TLS"]
        LONGHORN["Longhorn Storage"]
    end

    subgraph K8s["K8s Namespace: jarble"]
        SECRETS["Secrets<br/>(DB, Auth0, Stripe, Keys)"]
        API_DEP["API Deployment<br/>(2 replicas)"]
        ING["Ingress<br/>api.jarble.ai"]
        BOTS["User Bot Pods<br/>(managed by API)"]
    end

    CODE -->|"jarble-api-main/**"| API_CI
    CODE -->|"runtimes/**"| RT_CI
    CODE -->|"infrastructure/terraform/**"| TF_CI

    TF_CI -->|"terraform apply"| K3S
    API_CI -->|"image pull"| API_DEP
    RT_CI -->|"image pull"| BOTS

    K3S --> TRAEFIK --> ING --> API_DEP
    K3S --> LONGHORN --> BOTS
    SECRETS --> API_DEP
    API_DEP -->|"creates/manages"| BOTS

    style API_CI fill:#22c55e,color:#fff
    style RT_CI fill:#22c55e,color:#fff
    style TF_CI fill:#f59e0b,color:#fff
```

### CI/CD Pipeline

Three GitHub Actions workflows handle CI/CD:

| Workflow | Trigger | What It Does |
|---|---|---|
| `build-api-image.yml` | Push to main when `jarble-api-main/**` changes | Builds and pushes `ghcr.io/jarble-ai/api:latest` (+ `:sha` tag) |
| `build-runtime-images.yml` | Push to main when `runtimes/**` changes | Builds and pushes `ghcr.io/jarble-ai/openclaw:latest` and `ghcr.io/jarble-ai/zeroclaw:latest` |
| `terraform.yml` | Push/PR when `infrastructure/terraform/**` changes | Terraform fmt, validate, plan (PR comment), apply (with approval gate) |

All three support `workflow_dispatch` for manual runs. The Terraform workflow additionally supports `plan-only`, `apply`, and `destroy` modes via manual dispatch.

### API Container Boot Sequence

The API image uses an `entrypoint.sh` that runs three steps on every boot:

```
1. node dist/db/migrate.pg.js    → Apply Drizzle migrations (idempotent)
2. node dist/db/seed.pg.js       → Seed runtime_catalog (ON CONFLICT DO NOTHING)
3. exec node dist/index.js       → Start the API server
```

The migration runner uses `drizzle-orm/node-postgres/migrator` (a production dependency) rather than `drizzle-kit` (which is a devDependency and not in the production image).

### Deploying to the K3s Cluster

```bash
# 1. Provision infrastructure (one-time)
cd infrastructure/terraform
terraform apply

# 2. Create the secrets (from template)
cd jarble-api-main/k8s
cp secrets.yaml.example secrets.yaml
# Edit secrets.yaml with real values
kubectl apply -f secrets.yaml

# 3. Deploy the API
kubectl apply -f deployment.yaml

# 4. Verify
kubectl get pods -n jarble
kubectl logs -n jarble deployment/jarble-api
```

The `deployment.yaml` creates: ServiceAccount, RBAC Role + Binding, Deployment (2 replicas), ClusterIP Service, and Ingress (`api.jarble.ai` via Traefik).

### Required Secrets

See `jarble-api-main/k8s/secrets.yaml.example` for the full template. Critical ones:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `DB_PROVIDER` | Yes | Must be `"postgres"` |
| `AUTH0_DOMAIN` | Yes | Your Auth0 tenant |
| `AUTH0_AUDIENCE` | Yes | JWT audience validation |
| `OPENROUTER_API_KEY` | Yes | LLM model listing + health check |
| `API_KEY_ENCRYPTION_KEY` | Yes (prod) | 64-char hex for AES-256-GCM |
| `STRIPE_*` | Optional | Enables paid subscriptions |
| `OPENROUTER_MANAGEMENT_KEY` | Optional | Enables "Included Credits" key provisioning |
| `AGENT_LLM_API_KEY` | Optional | LLM key for platform agents and dashboard compose. Falls back to `OPENROUTER_API_KEY` |
| `AGENT_LLM_PROVIDER` | Optional | Provider for platform/compose calls (`openrouter`/`anthropic`/`openai`/`google`; default: `openrouter`) |
| `AGENT_LLM_MODEL` | Optional | Model for platform/compose calls (default: `anthropic/claude-sonnet-4-20250514`) |

---

## 22. Common Workflows

### "I need to add a new runtime"

1. Create Docker image: `runtimes/yourruntime/Dockerfile` + `entrypoint.sh`
2. Create runtime handler: `src/runtimes/handlers/yourruntime.ts`
   - Implement `renderConfigs()`, `parseConfigs()`, `getSecretEntries()`
3. Register in `src/runtimes/index.ts`
4. Add to runtime catalog (database seed or migration)
5. Add wizard steps in `wizardStepConfig.ts`:
   ```typescript
   RUNTIME_EXTRA_STEPS.yourruntime = [llmStep, deployStep];
   ```
6. Done — the wizard and config UI automatically adapt

### "I need to add a new platform (e.g., LINE)"

1. Add credential fields to `PLATFORM_CREDENTIAL_KEYS` in `platformCredentials.ts`:
   ```typescript
   line: { channelAccessToken: "channelAccessToken", channelSecret: "channelSecret" }
   ```
2. Add env var mapping to `PLATFORM_ENV_MAP`:
   ```typescript
   line: { channelAccessToken: "LINE_CHANNEL_ACCESS_TOKEN" }
   ```
3. Add to OpenClaw handler's channel config rendering
4. Add UI for the platform in `PlatformsTab`

### "I need to add a new tRPC procedure"

1. Add to the relevant router in `src/trpc/routers/`:
   ```typescript
   myNewProcedure: protectedProcedure
     .input(z.object({ id: z.string() }))
     .mutation(async ({ ctx, input }) => {
       // Business logic here
       return { success: true };
     }),
   ```
2. Use it in the frontend:
   ```tsx
   const mutation = trpc.deployment.myNewProcedure.useMutation();
   mutation.mutate({ id: "abc123" });
   ```
3. Types flow automatically — no manual API type definitions needed

### "I need to understand why a deployment failed"

Check in this order:
1. **Dashboard** — Status badge shows "failed"
2. **Chat page → Diagnose** — Hit `GET /api/deployments/:id/diagnose` for structured health checks
3. **Deployment config → Logs tab** — Container logs (if it started at all)
4. **API server logs** — Look for `[ERROR]` entries with the deployment ID
5. **K8s directly** — `kubectl describe pod deploy-<id> -n jarble`
6. **Database** — Check `deployments.error` column for error message

### "I need to add a new canvas component"

1. Add a component entry file in `shared/component-manifest/components/mycomponent.ts`:
   ```typescript
   export const myComponentEntry: ComponentManifestEntry = {
     name: "my_component",
     description: "...",
     category: "display",
     schema: myComponentSchema,
     layout: { defaultSize: { w: 4, h: 3 }, layoutHint: "auto" },
   };
   ```
2. Register it in `shared/component-manifest/index.ts` and `schemas/index.ts`
3. Create `Jarble-mvp/components/canvas/components/CanvasMyComponent.tsx` — **no wrapper styling**, use `p-3 h-full`
4. Add to `Jarble-mvp/components/canvas/registry.ts`
5. Add the component name to `BUILTIN_COMPONENTS` in `jarble-api-main/src/mcp/jarble-ui-server.js` and `src/utils/componentResolver.ts`
6. Run `npm run check:manifest` from `jarble-api-main/` to verify everything is wired correctly
7. Run `npm run generate-mcp-manifest` if you need to regenerate the MCP JSON snapshot

### "I need to understand the AutoFix system"

When a bot renders a UI block, the flow is:
```
Bot output: ```jarble_ui { "component": "DataTable", "props": {...} } ```
  ↓
uiBlockParser.ts: Extract the block, validate library URLs
  ↓
Frontend CanvasRenderer.tsx:
  1. autoFixProps.ts: 20 repair rules (name normalization, type coercion, enum aliases, ...)
  2. Zod schema validation (from @jarble/component-manifest)
  3. Render component or show error card
  ↓
Sentry breadcrumbs track: which repairs fired (for future rule improvements)
```

**The 6 repair categories:**
| Category | Examples |
|---|---|
| Type coercion | `"42"` → `42` for number fields |
| Enum normalization | `"primary"` → `"default"` for variant aliases |
| Missing defaults | Auto-add `variant: "default"` to alerts |
| Structural fixes | Unwrap `{props: {items: [...]}}` nesting |
| Field aliases | `content` → `body`, `description` → `message` |
| Data normalization | Strip `%` from progress values |

**Zod-tolerant rendering:** Even after AutoFix, if Zod validation still fails (e.g., minor type mismatch), the renderer logs a warning and renders with the post-AutoFix props. This prevents benign LLM quirks from producing error cards. Components that can't render due to missing required data will still throw a React error and show the error boundary UI.

---

## 23. Glossary

| Term | What It Means |
|---|---|
| **Auth0** | Third-party login service. We never store passwords. |
| **Agent Hub** | `POST /api/agent-hub/call` — allows one bot to delegate work to another published marketplace service. Uses `agentCallEvents` EventEmitter to fan SSE events to the active chat stream |
| **agentCallEvents** | Module-level EventEmitter (`src/utils/agentCallEvents.ts`) that bridges the Agent Hub HTTP handler with active chat SSE streams in the same Node.js process |
| **AutoFix** | Pre-Zod prop repair system. 20 rules in `lib/autoFixProps.ts` fix common LLM output errors before validation |
| **@assistant-ui/react** | React library for chat UI. We use `ExternalStoreRuntime` to wrap our `useCanvasChat` hook |
| **@jarble/component-manifest** | Shared package (`shared/component-manifest/`) — single source of truth for all canvas component definitions, schemas, and derive functions |
| **BYOK** | "Bring Your Own Key" — user provides their own LLM API key |
| **Canvas** | The grid area in `/d/[id]` where bot-rendered UI components appear |
| **Credit Pool** | Shared LLM budget across multiple bots (owner/linked model) |
| **Deployment** | One user's bot instance (database record + K8s resources) |
| **DB_PROVIDER** | Env var to select database backend: `sqlite`, `mysql`, `postgres` |
| **Drizzle** | Our database ORM (like Prisma but lighter) |
| **EventSource / SSE** | Browser API for receiving server-pushed updates |
| **Hetzner** | German cloud hosting provider (cheaper than AWS/GCP) |
| **Included Credits** | We provide the LLM key with a monthly spending cap |
| **jarble_ui** | Fenced code block format the bot uses to render canvas components: `\`\`\`jarble_ui { "component": "chart", "props": {...} } \`\`\`` |
| **JWT** | JSON Web Token — a signed auth token from Auth0 |
| **K3s** | Lightweight Kubernetes (same API, smaller footprint) |
| **K8s** | Kubernetes — container orchestration platform |
| **Longhorn** | Distributed storage system for Kubernetes |
| **Marketplace** | Platform feature where creators can publish and share canvas components. Two tiers: Template (safe JSON) and Sandbox (HTML/JS, admin-reviewed) |
| **MarketplaceSandbox** | Double-iframe renderer for sandbox-tier components. Outer iframe is sandboxed; inner iframe runs user code |
| **MCP** | Model Context Protocol — standard for AI tool use. Jarble exposes an MCP server inside each pod and a Streamable HTTP endpoint at `/api/mcp/:deploymentId` |
| **Mock K8s** | In-memory K8s simulation (`MOCK_K8S=true`) for local dev without a cluster |
| **Namespace** | K8s isolation boundary (we use `jarble`) |
| **Next.js** | React framework with routing, SSR, and build tooling |
| **OpenClaw** | TypeScript/Node.js bot runtime (primary) |
| **OpenRouter** | LLM API aggregator (200+ models, one API key) |
| **Pod** | Smallest K8s unit — one running container |
| **PostHog** | Product analytics library. Initialized in `lib/posthog.ts`. Requires `NEXT_PUBLIC_POSTHOG_KEY` |
| **PVC** | Persistent Volume Claim — durable disk storage in K8s |
| **rAF throttle** | `requestAnimationFrame`-based update coalescing in `useCanvasChat.ts` — prevents excessive React renders during fast SSE delta streams |
| **React Query** | Data fetching + caching library (powers tRPC hooks) |
| **Runtime** | The bot engine (OpenClaw or ZeroClaw) |
| **Secret** | K8s encrypted key-value store (env vars for pods) |
| **Sentry** | Error monitoring platform. Client config: `sentry.client.config.ts`. Requires `NEXT_PUBLIC_SENTRY_DSN` |
| **SimpleCanvasGrid** | CSS grid layout for the canvas (no react-grid-layout). Supports drag-to-reorder, split, and merge |
| **SSE** | Server-Sent Events — server pushes data to browser |
| **SuperJSON** | Serialization library that handles Dates, Maps, etc. |
| **Tambo** | Chat orchestration framework previously used. Replaced by `@assistant-ui/react` with `ExternalStoreRuntime` wrapping the `useCanvasChat` hook |
| **Terraform** | Infrastructure-as-code tool (defines servers in config files) |
| **Traefik** | Reverse proxy / ingress controller for K8s |
| **tRPC** | Type-safe RPC framework (frontend calls backend functions directly) |
| **TRUSTED_CDN_ORIGINS** | Allowlist of 10 CDN origins for sandbox library URLs. Enforced server-side in `uiBlockParser.ts` (before block reaches frontend) and client-side in `sandboxCore.ts:buildDocument()` (validates all library URLs + extracted `<script src>` / `<link href>` tags — defense-in-depth) |
| **ZeroClaw** | Rust-based bot runtime (lightweight, ~3.4MB binary) |
| **Artifact Workspace** | Pod-side `/data/workspace/` directory containing `manifest.json` + per-artifact JSON files. Accessed via `/api/deployments/:id/artifact/*` endpoints |
| **Circuit Breaker** | `src/services/circuitBreaker.ts` — opens after 5 consecutive service proxy failures, auto-resets after 60s to prevent hammering unhealthy creator APIs |
| **Benchmarks Router** | tRPC router (`src/trpc/routers/benchmarks.ts`) handling domain taxonomy, agent ratings, leaderboards, service metrics, and admin curation for the Agent Forking Flywheel |
| **Forkability Score** | 0-100 score computed by `computeForkabilityScore()` in `src/utils/forkability.ts`. Quantifies how copy-ready a public agent is based on profile completeness and community ratings |
| **Platform Agent** | A deployment with `isPlatform: true`. Uses Jarble's `AGENT_LLM_API_KEY` (`llmMode: "platform"`), bypasses subscription and storage enforcement, has a named `resourceTier` |
| **Resource Tier** | Named compute preset for platform agents. `RESOURCE_TIERS` in `src/k8s/constants.ts`: small (0.5 vCPU/1GB/10GB), medium (1 vCPU/2GB/20GB), large (2 vCPU/3GB/30GB) |
| **Dashboard Compose** | `POST /api/pod/compose` — accepts a list of component specs, fans them all out to the Component Agent in parallel via `Promise.allSettled()`, returns sandbox blocks |
| **Public API** | Unauthenticated REST endpoints at `/api/public/*` for the Agent Forking Flywheel discovery layer (leaderboard + agent profiles) |
| **HMAC Signing** | Per-install HMAC-SHA256 signature on outbound service proxy requests. Each buyer gets a unique signing secret stored in `serviceCredentials` (encrypted) |
| **Service Marketplace** | Service bundles (components + skills + instruction snippets). Two models: Package (buyer runs everything) and Hosted/Remote (creator hosts APIs, buyer proxies through Jarble) |
| **ServiceCard** | Structured JSON blob published by service creators describing their API endpoint, auth method, skill definitions, rate limits, and health endpoint. Validated against Zod schema in `serviceCard.ts` |
| **Service Proxy** | `POST /api/services/proxy/:deploymentId/:serviceId/:skillName` — the Jarble API gateway between buyer pods and creator remote APIs. Handles HMAC auth, rate limiting, circuit breaking, and input/output schema validation |
| **Tiered Config Sync** | Three-tier strategy in `syncConfigsToPvc()`: Tier 1 = file-only (zero downtime), Tier 2 = process restart (~5-10s), Tier 3 = pod restart (~30-60s). Selects minimum disruption tier needed |
| **Webhook Idempotency** | `processedWebhookEvents` table prevents duplicate Stripe event processing |
| **Sandbox-first** | Architectural policy encoded in `promptGuidance` fields: sandbox is the default for dashboards, analytics, and multi-element visualizations. Chart/metric_card/stat_grid redirect to sandbox for combined requests |
| **ZIP export** | Download bot configs as a ZIP file (for backup/migration) |
| **Zod-tolerant renderer** | `CanvasRenderer` logs Zod validation warnings but renders with raw props rather than showing error cards; components that handle minor type mismatches gracefully continue to render |

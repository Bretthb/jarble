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
13. [Authentication Flow](#13-authentication-flow)
14. [Payments (Stripe)](#14-payments-stripe)
15. [Encryption](#15-encryption)
16. [Infrastructure (Terraform + Hetzner)](#16-infrastructure-terraform--hetzner)
17. [Runtime Images (Docker)](#17-runtime-images-docker)
18. [The Database](#18-the-database)
19. [Environment Variables](#19-environment-variables)
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

**1. tRPC Procedures** (75 total across 9 routers)
Structured, typed function calls. Protected by JWT auth. Used for all normal CRUD operations.

```
trpc.deployment.list            → List your bots
trpc.deployment.create          → Create a new bot
trpc.deployment.update          → Change bot settings
trpc.deployment.delete          → Delete a bot
trpc.openrouter.provisionKey    → Get a new LLM API key
trpc.marketplace.browse         → Browse marketplace components
trpc.marketplace.install        → Install a component on a deployment
trpc.skills.listCatalog         → List available skills
```

**2. REST Endpoints** (13 total)
Plain HTTP routes for things that can't use tRPC:
- **Webhooks** (Stripe, Auth0, config-changed) — external services POST to us
- **SSE Streams** (logs, status, WhatsApp QR, chat) — long-lived connections that push data
- **Chat history** (`GET /api/tambo-agent/sessions/*`) — session list and message loader
- **MCP endpoints** (Streamable HTTP + proxy) — for external MCP clients
- **Diagnostic endpoint** — structured health checks for a deployment
- **Health check** — for Kubernetes to know we're alive
- **Debug endpoints** (dev only) — inspect DB state

### Background Services

Two enforcement services start automatically at API boot (skipped in dev/SQLite mode):

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

    ROUTER -->|"deployment.*"| DEPLOY["deployment.ts<br/>21 procedures"]
    ROUTER -->|"openrouter.*"| OR["openrouter.ts<br/>8 procedures"]
    ROUTER -->|"user.*"| USER["user.ts<br/>5 procedures"]
    ROUTER -->|"billing.*"| BILL["billing.ts<br/>3 procedures"]
    ROUTER -->|"platformCredentials.*"| PLAT["platformCredentials.ts<br/>7 procedures"]
    ROUTER -->|"runtimeCatalog.*"| RUNTIME["runtimeCatalog.ts<br/>4 procedures"]
    ROUTER -->|"template.*"| TMPL["template.ts<br/>1 procedure"]
    ROUTER -->|"skills.*"| SKILLS["skills.ts<br/>4 procedures"]
    ROUTER -->|"marketplace.*"| MKT["marketplace.ts<br/>22 procedures"]
    ROUTER -->|"GET /api/tambo-agent/sessions/*"| CHATREST["tamboAgent.ts<br/>2 REST GET endpoints (chat history)"]

    DEPLOY --> DB[("Database")]
    DEPLOY --> K8S["K8s Cluster"]
    OR --> ORAPI["OpenRouter API"]
    BILL --> STRIPE_API["Stripe API"]
    PLAT --> DB
    MKT --> DB
```

```
src/trpc/routers/
  ├── deployment.ts          ← 21 procedures (CRUD + canvas components + lifecycle)
  ├── openrouter.ts          ← 8 procedures (LLM key management)
  ├── user.ts                ← 5 procedures (profile, email verify)
  ├── billing.ts             ← 3 procedures (overview, invoices, subscriptions)
  ├── platformCredentials.ts ← 7 procedures (Discord/Slack tokens, WhatsApp QR, Telegram pairing)
  ├── runtimeCatalog.ts      ← 4 procedures (list available runtimes)
  ├── skills.ts              ← 4 procedures (skills catalog, install/uninstall)
  ├── marketplace.ts         ← 22 procedures (browse, install, review, creator, admin)
  ├── admin.ts               ← 19 procedures (platform admin: stats, users, deployments, billing, metrics, audit, beta signups)
  └── template.ts            ← 1 procedure (bot templates)
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
Size: 5 GB default (the storageMb column name is misleading — units are GB).
     Typical bot uses 500 MB–1 GB, so 5 GB gives ~4x headroom.
Storage class: longhorn-1r (1 replica — trades redundancy for 3x more density)
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

### Split Prompt Architecture

`soul.md` does NOT contain the full system prompt. The bot's instructions are split across two delivery mechanisms:

| Prompt Part | Where It Lives | When Delivered | Platforms |
|-------------|----------------|----------------|-----------|
| `PLATFORM_GUARDRAILS` | Written into `soul.md` by configSync | On pod start / config change | ALL (Telegram, Discord, Slack, web) |
| `JARBLE_UI_PROMPT` | Never written to disk | Injected at request time by `tamboAgent.ts` as a `system` message | Web dashboard only |

**Why?** Guardrails (infrastructure confidentiality, real data policy, memory tools) must apply to messaging bots too, which never go through the API chat endpoint. The canvas rendering instructions are too large for messaging bots and only make sense in the web dashboard context — injecting them at request time means updating the API code instantly updates all deployments without touching any pods.

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

| Resource | cpx21 has | Pod request (default) | Typical deployment |
|----------|-----------|----------------------|-------------------|
| CPU | 3 vCPU | 100m (0.1 vCPU) | 100m request, configurable limit |
| RAM | 4 GB | 256 MB | 256 MB request, configurable limit |
| Storage (PVC) | Block storage | **5 GB** (default `storageMb=5`) | 500 MB–1 GB actual usage |
| Max deployments | — | ~15 per node (memory-limited) | ~30 per node (CPU-limited) |

With the new 5 GB default PVC and `longhorn-1r` storage class (1 replica), cluster density improved dramatically:

- Memory-limited: ~15 deployments per cpx21 (4 GB / 256 MB request)
- CPU-limited: ~30 deployments per cpx21 (3 vCPU / 100m request)
- Storage-limited: ~56 deployments per cpx21 with 300 GB block storage (300 GB / 5 GB)

Block storage per node: with 15 deployments × 5 GB = **75 GB** (vs 15 × 30 GB = 450 GB before).

> **Why `longhorn-1r`?** The `longhorn-1r` storage class uses 1 Longhorn replica instead of 3, tripling the usable block storage capacity at the cost of no redundancy. Acceptable for ephemeral bot data that can be reproduced.

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

### Two Ways to Get an LLM Key

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

### AutoFix Prop Repair (`lib/autoFixProps.ts`)

LLMs frequently produce props that are _close_ but not quite right. AutoFix runs before Zod validation to silently repair common mistakes:

```mermaid
flowchart LR
    INPUT["Raw props from jarble_ui block"]
    AUTOFIX["autoFixProps.ts<br/>20 repair rules"]
    ZOD["Zod schema validation<br/>(@jarble/component-manifest)"]
    RENDER["Render component"]
    ERROR["Show error card"]

    INPUT --> AUTOFIX --> ZOD
    ZOD -->|Pass| RENDER
    ZOD -->|Fail| ERROR
```

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

### Marketplace Sandbox (Double-Iframe Security)

Marketplace sandbox-tier components run arbitrary HTML/CSS/JS. They use a **double-iframe** architecture for security:

```
Outer iframe: sandboxed (no same-origin, allow-scripts only)
  └── Inner iframe: user's HTML + JS runs here
      └── Communicates with outer via postMessage
```

This prevents sandbox code from accessing the Jarble app's DOM, cookies, or localStorage. The CSP further restricts what the sandbox can load — only origins in `TRUSTED_CDN_ORIGINS` are allowed.

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

### Why `?token=` Instead of Headers?

The browser's `EventSource` API (used for SSE) can't set custom headers. So we pass the JWT as a query parameter instead of in the `Authorization` header. The backend accepts both formats.

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

    chatSessions {
        string id PK
        string deploymentId FK
        string title "auto-titled from first user message"
        timestamp createdAt
        timestamp updatedAt
    }

    chatMessages {
        string id PK
        string sessionId FK
        string role "user or assistant"
        text content "cleaned text"
        text thinkingText "optional"
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

# Prometheus (optional — admin metrics dashboard)
PROMETHEUS_URL=http://prometheus.monitoring.svc.cluster.local:9090

# Resend (optional — beta invite emails)
RESEND_API_KEY=re_xxxx
```

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
| Canvas chat (/d/[id]) | Partial | Needs a running pod for actual chat. UI renders without it |
| Chat session history | Yes | Stored in SQLite `chat_sessions` / `chat_messages` tables. Sidebar shows past sessions with real message counts |
| Sentry / PostHog | No | Omit `NEXT_PUBLIC_SENTRY_DSN` and `NEXT_PUBLIC_POSTHOG_KEY` to disable |
| Manifest CI check | Yes | Run `npm run check:manifest` from `jarble-api-main/` |

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

---

## 23. Glossary

| Term | What It Means |
|---|---|
| **Auth0** | Third-party login service. We never store passwords. |
| **AutoFix** | Pre-Zod prop repair system. 20 rules in `lib/autoFixProps.ts` fix common LLM output errors before validation |
| **@assistant-ui/react** | React library for chat UI. We use `ExternalStoreRuntime` to wrap our `useCanvasChat` hook |
| **@jarble/component-manifest** | Shared package (`shared/component-manifest/`) — single source of truth for all canvas component definitions, schemas, and derive functions |
| **BYOK** | "Bring Your Own Key" — user provides their own LLM API key |
| **Canvas** | The grid area in `/d/[id]` where bot-rendered UI components appear |
| **chat_sessions / chat_messages** | DB tables storing conversation history. Sessions auto-titled from first user message; messages cleaned of canvas state and `jarble_ui` fences. Fetched via REST (`GET /api/tambo-agent/sessions/*`) |
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
| **longhorn-1r** | K8s StorageClass with 1 Longhorn replica (default for all bot PVCs). Triples usable capacity vs the 3-replica default — acceptable for ephemeral bot data |
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
| **Prometheus** | Open-source monitoring system. Deployed in `monitoring` namespace, scrapes node-exporter and kube-state-metrics. Admin dashboard at `/admin/metrics` queries it via `services/prometheus.ts` |
| **PVC** | Persistent Volume Claim — durable disk storage in K8s |
| **rAF throttle** | `requestAnimationFrame`-based update coalescing in `useCanvasChat.ts` — prevents excessive React renders during fast SSE delta streams |
| **React Query** | Data fetching + caching library (powers tRPC hooks) |
| **Resend** | Email API for transactional emails. Used for beta welcome invites. Requires `RESEND_API_KEY` env var |
| **Runtime** | The bot engine (OpenClaw or ZeroClaw) |
| **Secret** | K8s encrypted key-value store (env vars for pods) |
| **Sentry** | Error monitoring platform. Client config: `sentry.client.config.ts`. Requires `NEXT_PUBLIC_SENTRY_DSN` |
| **SimpleCanvasGrid** | CSS grid layout for the canvas (no react-grid-layout). Supports drag-to-reorder, split, and merge |
| **SSE** | Server-Sent Events — server pushes data to browser |
| **SuperJSON** | Serialization library that handles Dates, Maps, etc. |
| **Tambo** | Chat orchestration framework used in the `/d/[id]` chat page |
| **Terraform** | Infrastructure-as-code tool (defines servers in config files) |
| **Traefik** | Reverse proxy / ingress controller for K8s |
| **tRPC** | Type-safe RPC framework (frontend calls backend functions directly) |
| **TRUSTED_CDN_ORIGINS** | Allowlist of 10 CDN origins for sandbox library URLs. Enforced server-side in `uiBlockParser.ts` and client-side in `CanvasSandbox.tsx` |
| **ZeroClaw** | Rust-based bot runtime (lightweight, ~3.4MB binary) |
| **Webhook Idempotency** | `processedWebhookEvents` table prevents duplicate Stripe event processing |
| **ZIP export** | Download bot configs as a ZIP file (for backup/migration) |

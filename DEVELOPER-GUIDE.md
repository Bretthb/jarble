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
11. [Real-Time Updates (SSE)](#11-real-time-updates-sse)
12. [Authentication Flow](#12-authentication-flow)
13. [Payments (Stripe)](#13-payments-stripe)
14. [Encryption](#14-encryption)
15. [Infrastructure (Terraform + Hetzner)](#15-infrastructure-terraform--hetzner)
16. [Runtime Images (Docker)](#16-runtime-images-docker)
17. [The Database](#17-the-database)
18. [Environment Variables](#18-environment-variables)
19. [Local Development Setup](#19-local-development-setup)
20. [Common Workflows](#20-common-workflows)
21. [Glossary](#21-glossary)

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
        DB[("Database<br/>SQLite / MySQL")]
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
        CONFIG["/d/[id]/configure"]
        LINKED["/deployments"]
        ANALYTICS["/analytics"]
        SETTINGS["/settings"]
    end

    HOME -->|Sign In| LOGIN
    LOGIN -->|Auth0| DASH
    DASH -->|New Bot| WIZARD
    DASH -->|Click Bot| CONFIG
    DASH -->|Profile Menu| ANALYTICS
    DASH -->|Profile Menu| SETTINGS
    DASH -->|Profile Menu| LINKED
    WIZARD -->|Complete| DASH
```

| Page | URL | What It Does |
|---|---|---|
| Home | `/` | Marketing page — "Deploy AI bots in 2 minutes" |
| Login | `/login` | Auth0 login (Google, GitHub, email) |
| Pricing | `/pricing` | Shows runtime options and costs |
| **Dashboard** | `/dashboard` | Lists all your bots with status, controls |
| **Onboarding** | `/onboarding/[id]` | Step-by-step wizard to create a new bot |
| **Config** | `/d/[id]/configure` | Edit an existing bot (6 tabs) |
| Linked Deployments | `/deployments` | Shows credit pool sharing between bots |
| Analytics | `/analytics` | Usage stats, credit meters, sortable table |
| Settings | `/settings` | Profile, theme, password reset |

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

**1. tRPC Procedures** (37 total)
Structured, typed function calls. Protected by JWT auth. Used for all normal CRUD operations.

```
trpc.deployment.list     → List your bots
trpc.deployment.create   → Create a new bot
trpc.deployment.update   → Change bot settings
trpc.deployment.delete   → Delete a bot
trpc.openrouter.provisionKey → Get a new LLM API key
```

**2. REST Endpoints** (10 total)
Plain HTTP routes for things that can't use tRPC:
- **Webhooks** (Stripe, Auth0) — external services POST to us
- **SSE Streams** (logs, status) — long-lived connections that push data
- **Health check** — for Kubernetes to know we're alive

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

    ROUTER -->|"deployment.*"| DEPLOY["deployment.ts<br/>18 procedures"]
    ROUTER -->|"openrouter.*"| OR["openrouter.ts<br/>8 procedures"]
    ROUTER -->|"user.*"| USER["user.ts<br/>5 procedures"]
    ROUTER -->|"platformCredentials.*"| PLAT["platformCredentials.ts<br/>4 procedures"]
    ROUTER -->|"runtimeCatalog.*"| RUNTIME["runtimeCatalog.ts<br/>4 procedures"]
    ROUTER -->|"template.*"| TMPL["template.ts<br/>1 procedure"]

    DEPLOY --> DB[("Database")]
    DEPLOY --> K8S["K8s Cluster"]
    OR --> ORAPI["OpenRouter API"]
    PLAT --> DB
```

```
src/trpc/routers/
  ├── deployment.ts          ← 18 procedures (the biggest one)
  ├── openrouter.ts          ← 8 procedures (LLM key management)
  ├── user.ts                ← 5 procedures (profile, email verify)
  ├── platformCredentials.ts ← 4 procedures (Discord/Slack tokens)
  ├── runtimeCatalog.ts      ← 4 procedures (list available runtimes)
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

Our API server uses the official `@kubernetes/client-node` library. It works in two modes:

```
In production (inside K8s cluster):
  → loadFromCluster() — uses the service account token automatically

In development (your laptop):
  → loadFromDefault() — uses your ~/.kube/config file
  → Usually talks to a local or remote cluster
```

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

## 11. Real-Time Updates (SSE)

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

## 12. Authentication Flow

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

## 13. Payments (Stripe)

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

---

## 14. Encryption

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
        KEY["ENCRYPTION_KEY<br/>(env var)"]
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

**Development mode:** If `ENCRYPTION_KEY` is not set, keys are stored as `plain:sk-or-v1-abc123...` (not encrypted). This is fine for local dev with SQLite.

**Analogy:** AES-256-GCM is like a lockbox with a tamper-evident seal. You need the key to open it, and if anyone tries to modify the contents without the key, the seal breaks and decryption fails.

### When Keys Get Decrypted

Keys are decrypted ONLY when they need to leave our system:
- Injecting into K8s Secrets (so the bot container can use them)
- Config sync (writing openclaw.json with actual tokens)
- Key validation (checking if a user's BYOK key works)

They are NEVER decrypted for display. The frontend only sees masked versions.

---

## 15. Infrastructure (Terraform + Hetzner)

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

### Longhorn Storage

Longhorn is a **distributed storage system** for Kubernetes. When we create a PVC (storage locker), Longhorn:
- Allocates the disk space
- Replicates data across nodes (survives node failure)
- Handles attach/detach when pods move between nodes

**Analogy:** Longhorn is like a RAID array spread across multiple buildings. Even if one building burns down, your data is safe in the others.

---

## 16. Runtime Images (Docker)

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

## 17. The Database

### Multi-Database Support

| Environment | Database | Connection |
|---|---|---|
| **Development** | SQLite (in-memory) | No setup needed, auto-creates tables + seed data |
| **Production** | MySQL | `DATABASE_URL` env var |
| **Alternative** | PostgreSQL | Separate schema file, Drizzle migrations |

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

## 18. Environment Variables

### Frontend (`.env.local`)

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001    # Backend URL
NEXT_PUBLIC_AUTH0_DOMAIN=jarble-dev.us.auth0.com
NEXT_PUBLIC_AUTH0_CLIENT_ID=1VR30862...
NEXT_PUBLIC_AUTH0_AUDIENCE=https://api.jarble.ai
```

### Backend (`.env`)

```bash
# Server
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Database (not needed for SQLite dev mode)
DATABASE_URL=mysql://user:pass@localhost:3306/jarble

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
```

---

## 19. Local Development Setup

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
| Onboarding wizard | Yes | All steps render |
| tRPC queries | Yes | SQLite has seed data |
| K8s deployment | No | Need a K8s cluster (use Hetzner or minikube) |
| Stripe payments | Partial | Need Stripe test keys |
| OpenRouter provisioning | Partial | Need management key |
| Config sync | No | Requires running K8s pods |

---

## 20. Common Workflows

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
2. **Deployment config → Logs tab** — Container logs (if it started at all)
3. **API server logs** — Look for `[ERROR]` entries with the deployment ID
4. **K8s directly** — `kubectl describe pod deploy-<id> -n jarble`
5. **Database** — Check `deployments.error` column for error message

---

## 21. Glossary

| Term | What It Means |
|---|---|
| **Auth0** | Third-party login service. We never store passwords. |
| **BYOK** | "Bring Your Own Key" — user provides their own LLM API key |
| **Credit Pool** | Shared LLM budget across multiple bots (owner/linked model) |
| **Deployment** | One user's bot instance (database record + K8s resources) |
| **Drizzle** | Our database ORM (like Prisma but lighter) |
| **EventSource / SSE** | Browser API for receiving server-pushed updates |
| **Hetzner** | German cloud hosting provider (cheaper than AWS/GCP) |
| **Included Credits** | We provide the LLM key with a monthly spending cap |
| **JWT** | JSON Web Token — a signed auth token from Auth0 |
| **K3s** | Lightweight Kubernetes (same API, smaller footprint) |
| **K8s** | Kubernetes — container orchestration platform |
| **Longhorn** | Distributed storage system for Kubernetes |
| **Namespace** | K8s isolation boundary (we use `jarble`) |
| **Next.js** | React framework with routing, SSR, and build tooling |
| **OpenClaw** | TypeScript/Node.js bot runtime (primary) |
| **OpenRouter** | LLM API aggregator (200+ models, one API key) |
| **Pod** | Smallest K8s unit — one running container |
| **PVC** | Persistent Volume Claim — durable disk storage in K8s |
| **React Query** | Data fetching + caching library (powers tRPC hooks) |
| **Runtime** | The bot engine (OpenClaw or ZeroClaw) |
| **Secret** | K8s encrypted key-value store (env vars for pods) |
| **SSE** | Server-Sent Events — server pushes data to browser |
| **SuperJSON** | Serialization library that handles Dates, Maps, etc. |
| **Terraform** | Infrastructure-as-code tool (defines servers in config files) |
| **Traefik** | Reverse proxy / ingress controller for K8s |
| **tRPC** | Type-safe RPC framework (frontend calls backend functions directly) |
| **ZeroClaw** | Rust-based bot runtime (lightweight, ~3.4MB binary) |
| **ZIP export** | Download bot configs as a ZIP file (for backup/migration) |

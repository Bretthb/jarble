# Jarble Platform Architecture

> **Last Updated:** February 2026
> Monorepo: `jarble-api-main` (Express/tRPC API) + `Jarble-mvp` (Next.js frontend)

---

## 1. High-Level System Overview

```mermaid
graph TB
    subgraph Frontend["Jarble-MVP (Next.js 15)"]
        UI[React UI]
        Auth0SDK[Auth0 React SDK]
        TRPCClient[tRPC React Client]
    end

    subgraph Backend["Jarble-API (Express + tRPC)"]
        Express["Express Server :3001"]
        TRPC[tRPC Handler]
        AuthMW[Auth Middleware]
        Routers[tRPC Routers]
        K8S[K8s Service]
        StripeService[Stripe Service]
    end

    subgraph External["External Services"]
        Auth0[Auth0]
        Stripe[Stripe]
        OpenRouter[OpenRouter API]
        OpenAI[OpenAI API]
        Anthropic[Anthropic API]
        Google[Google AI API]
        K8sCluster[Kubernetes Cluster]
    end

    subgraph Database["Database (Multi-Provider)"]
        SQLite[(SQLite - Dev)]
        MySQL[(MySQL - Prod)]
        Postgres[(PostgreSQL - Prod)]
    end

    UI --> Auth0SDK
    Auth0SDK -->|OAuth| Auth0
    UI --> TRPCClient
    TRPCClient -->|HTTP + Bearer Token| Express
    Express --> TRPC
    TRPC --> AuthMW
    AuthMW -->|Verify JWT| Auth0
    AuthMW --> Routers
    Routers --> K8S
    Routers --> StripeService
    Routers -->|Validate Keys| OpenRouter
    Routers -->|Validate Keys| OpenAI
    Routers -->|Validate Keys| Anthropic
    Routers -->|Validate Keys| Google
    K8S --> K8sCluster
    StripeService --> Stripe
    Routers --> Database
    Stripe -->|Webhooks| Express
```

---

## 2. Monorepo Structure

```
develop-monorepo/
├── jarble-api-main/                # Express + tRPC backend
│   └── src/
│       ├── index.ts                # Server entry (Express, CORS, Stripe, tRPC)
│       ├── db/
│       │   ├── index.ts            # Multi-DB client factory + table exports
│       │   ├── init.ts             # SQLite DDL + seed data
│       │   ├── schema.sqlite.ts    # SQLite schema (dev)
│       │   ├── schema.ts           # MySQL schema (prod)
│       │   └── schema.pg.ts        # PostgreSQL schema (prod)
│       ├── trpc/
│       │   ├── index.ts            # Router composition + AppRouter type
│       │   ├── context.ts          # Request context (user + db)
│       │   ├── middleware.ts        # public / protectedProcedure
│       │   └── routers/
│       │       ├── deployment.ts    # Deployment CRUD + K8s + auto-provision
│       │       ├── user.ts          # User profile
│       │       ├── runtimeCatalog.ts# Runtime catalog queries
│       │       ├── openrouter.ts    # Multi-provider validation + provisioning
│       │       └── template.ts      # Bot templates
│       ├── k8s/
│       │   └── deployment.ts       # K8s lifecycle (PVC, Secret, Deployment)
│       ├── services/
│       │   ├── auth.ts             # Auth0 JWT verify + user upsert
│       │   └── stripe.ts           # Stripe webhook handling
│       └── utils/
│           ├── env.ts              # Zod env validation
│           └── logger.ts           # Pino logger
│
├── Jarble-mvp/                     # Next.js 15 frontend
│   ├── app/                        # App Router pages
│   │   ├── layout.tsx / providers.tsx
│   │   ├── page.tsx                # Landing (/)
│   │   ├── dashboard/page.tsx      # Dashboard (/dashboard)
│   │   ├── pricing/page.tsx        # Pricing (/pricing)
│   │   ├── onboarding/[id]/page.tsx# Wizard (/onboarding/new)
│   │   └── d/[id]/configure/page.tsx
│   ├── views/
│   │   ├── OnboardingWizard.tsx    # Dynamic step wizard
│   │   ├── Dashboard.tsx           # Deployment grid
│   │   ├── Pricing.tsx             # Runtime catalog + LLM pricing
│   │   ├── DeploymentConfiguration.tsx
│   │   ├── onboarding/
│   │   │   └── wizardStepConfig.ts # Step configs, provider defs
│   │   └── deployment-config/
│   │       ├── GeneralTab.tsx
│   │       ├── ModelTab.tsx
│   │       ├── PlatformsTab.tsx
│   │       ├── SkillsTab.tsx
│   │       └── AdvancedTab.tsx
│   ├── components/
│   │   ├── ui/                     # 70+ shadcn/ui components
│   │   ├── auth/                   # Auth0Provider, LoginButton
│   │   └── WizardLoader.tsx        # Animated deploy loader
│   └── lib/
│       └── trpc.ts                 # tRPC React client
│
└── ARCHITECTURE.md                 # ← This file
```

---

## 3. Database Schema (Entity Relationship)

```mermaid
erDiagram
    users {
        varchar id PK "nanoid"
        varchar email UK "unique"
        varchar name
        varchar auth0_id UK "Auth0 identifier"
        boolean email_verified
        varchar stripe_customer_id
        boolean free_deployment_used "one-time flag"
        timestamp free_trial_expires_at
        timestamp created_at
        timestamp updated_at
    }

    deployments {
        varchar id PK "nanoid(12)"
        varchar user_id FK
        varchar name
        text description
        varchar runtime "openclaw | zeroclaw"
        varchar image "Docker image"
        int runtime_catalog_id FK
        boolean is_free
        int monthly_price_cents
        timestamp free_expires_at
        varchar llm_mode "byok | included"
        varchar llm_provider "openrouter | openai | anthropic | google"
        varchar llm_api_key "encrypted"
        varchar status "pending | creating | running | failed"
        text error
        timestamp created_at
        timestamp updated_at
    }

    runtime_catalog {
        int id PK "auto-increment"
        varchar slug UK "openclaw | zeroclaw"
        varchar name
        text description
        varchar category "bot"
        varchar docker_image
        varchar cpu_limit "0.25 vCPU"
        int memory_mb "512 MB"
        int storage_mb "100 MB"
        int monthly_price_cents
        boolean is_active
        timestamp created_at
    }

    users ||--o{ deployments : "has many"
    runtime_catalog ||--o{ deployments : "used by"
```

---

## 4. tRPC Router Architecture

```mermaid
graph LR
    subgraph appRouter["appRouter (tRPC)"]
        direction TB
        UserRouter["user"]
        DeployRouter["deployment"]
        RuntimeRouter["runtimeCatalog"]
        OpenRouterRouter["openrouter"]
        TemplateRouter["template"]
    end

    subgraph UserProcs["user.*"]
        direction TB
        UMe["me (query)"]
        UProfile["getProfile (query)"]
        UUpdate["updateProfile (mutation)"]
        UComplete["completeProfile (mutation)"]
    end

    subgraph DeployProcs["deployment.*"]
        direction TB
        DCanDeploy["canDeploy (query)"]
        DList["list (query)"]
        DGetById["getById (query)"]
        DCreate["create (mutation)"]
        DDeploy["deploy (mutation)"]
        DGetStatus["getStatus (query)"]
        DUpdate["update (mutation)"]
        DDelete["delete (mutation)"]
    end

    subgraph RuntimeProcs["runtimeCatalog.*"]
        direction TB
        RList["list (query)"]
        RGetById["getById (query)"]
        RGetBySlug["getBySlug (query)"]
    end

    subgraph ORProcs["openrouter.*"]
        direction TB
        ORHealth["healthCheck (query)"]
        ORModels["models (query)"]
        ORValidate["validateApiKey (mutation)"]
        ORValidateProvider["validateProviderKey (mutation)"]
        ORProvision["provisionKey (mutation)"]
    end

    subgraph TemplateProcs["template.*"]
        direction TB
        TList["list (query)"]
    end

    UserRouter --> UserProcs
    DeployRouter --> DeployProcs
    RuntimeRouter --> RuntimeProcs
    OpenRouterRouter --> ORProcs
    TemplateRouter --> TemplateProcs

    style DCreate fill:#f59e0b,color:#000
    style DDeploy fill:#f59e0b,color:#000
    style ORValidateProvider fill:#f59e0b,color:#000
    style ORProvision fill:#f59e0b,color:#000
```

---

## 5. Authentication Flow

```mermaid
sequenceDiagram
    actor User
    participant Frontend as Jarble-MVP
    participant Auth0 as Auth0
    participant API as Jarble-API
    participant DB as Database

    User->>Frontend: Click "Sign In"
    Frontend->>Auth0: Redirect to Auth0 login
    Auth0-->>User: Show login form
    User->>Auth0: Enter credentials / Google OAuth
    Auth0-->>Frontend: Return with auth code
    Frontend->>Auth0: Exchange code for tokens
    Auth0-->>Frontend: Access token + ID token

    Note over Frontend: Token stored in Auth0 SDK

    Frontend->>API: tRPC call + Bearer token
    API->>Auth0: Verify JWT (JWKS)
    Auth0-->>API: Token payload (sub, email, name)

    API->>DB: Find user by auth0Id
    alt User exists
        DB-->>API: Return user record
        API->>DB: Update email/name if changed
    else New user
        API->>DB: Create new user record
        DB-->>API: Return new user
    end

    API-->>Frontend: Response with user context
```

---

## 6. Deployment Creation Flow

```mermaid
sequenceDiagram
    actor User
    participant Wizard as OnboardingWizard
    participant API as Jarble-API
    participant OR as OpenRouter
    participant K8s as Kubernetes
    participant DB as Database

    User->>Wizard: Fill name, select runtime
    User->>Wizard: Configure LLM (BYOK or Included)

    alt BYOK Mode
        User->>Wizard: Paste API key
        Wizard->>Wizard: Auto-detect provider from prefix
        User->>Wizard: Click "Validate"
        Wizard->>API: openrouter.validateProviderKey
        API->>OR: GET /api/v1/models (or other provider)
        OR-->>API: 200 OK / 401 Unauthorized
        API-->>Wizard: { valid: true/false }
        Wizard->>Wizard: Show green check / red X
    end

    User->>Wizard: Click "Deploy"
    Wizard->>API: deployment.create

    alt Included Credits Mode
        API->>OR: POST /api/v1/keys (Management API)
        OR-->>API: { key: "sk-or-tenant-..." }
        API->>API: Store provisioned key
    end

    API->>DB: INSERT deployment (status: "pending")

    alt First deployment
        API->>DB: UPDATE user (freeDeploymentUsed: true)
    end

    API-->>Wizard: deployment object

    Wizard->>API: deployment.deploy(id)
    API->>DB: UPDATE status -> "creating"
    API-->>Wizard: { success: true }

    Note over API,K8s: Fire-and-forget (async)

    API->>K8s: Create PVC (5Gi storage)
    API->>K8s: Create Secret (config)
    API->>K8s: Create Deployment (pod spec)
    K8s-->>API: Resources created

    API->>DB: UPDATE status -> "running"

    loop Poll status
        Wizard->>API: deployment.getStatus(id)
        API->>K8s: Get pod status
        K8s-->>API: Pod phase + restarts
        API-->>Wizard: { status }
    end

    Wizard->>Wizard: Move to next step
```

---

## 7. Dynamic Wizard Step System

```mermaid
flowchart TD
    Start([User starts wizard]) --> Name["Step: Name"]
    Name -->|"Next"| Runtime["Step: Choose Runtime"]

    Runtime -->|"User selects OpenClaw"| OCSteps
    Runtime -->|"User selects ZeroClaw"| ZCSteps

    subgraph OCSteps["OpenClaw Flow (5 steps)"]
        direction TB
        OC_LLM["Step: LLM Setup"]
        OC_Deploy["Step: Deploy"]
        OC_WA["Step: Connect WhatsApp"]
        OC_LLM --> OC_Deploy --> OC_WA
    end

    subgraph ZCSteps["ZeroClaw Flow (3 steps)"]
        direction TB
        ZC_Deploy["Step: Deploy"]
    end

    OC_WA --> Finish([Dashboard])
    ZC_Deploy --> Finish

    subgraph Config["wizardStepConfig.ts"]
        direction TB
        Universal["UNIVERSAL_STEPS<br/>name + runtime"]
        Extra["RUNTIME_EXTRA_STEPS<br/>openclaw: llm, deploy, whatsapp<br/>zeroclaw: deploy"]
        Helper["getWizardSteps(slug)<br/>= universal + extras"]
    end

    style OCSteps fill:#ede9fe,stroke:#7c3aed
    style ZCSteps fill:#d1fae5,stroke:#10b981
    style Config fill:#fef3c7,stroke:#f59e0b
```

---

## 8. LLM Provider Key Auto-Detection

```mermaid
flowchart LR
    Key[User pastes API key] --> Check{Key prefix?}

    Check -->|"sk-ant-..."| Anthropic[Anthropic]
    Check -->|"sk-or-..."| OpenRouter[OpenRouter]
    Check -->|"AIza..."| Google[Google AI]
    Check -->|"sk-..."| OpenAI[OpenAI]
    Check -->|"other"| Manual[Manual selection]

    Anthropic --> Validate
    OpenRouter --> Validate
    Google --> Validate
    OpenAI --> Validate
    Manual --> Validate

    Validate[Click Validate] --> Backend[validateProviderKey]

    Backend --> ORCheck["OpenRouter<br/>GET /api/v1/models<br/>Bearer token"]
    Backend --> OACheck["OpenAI<br/>GET /api/v1/models<br/>Bearer token"]
    Backend --> AnCheck["Anthropic<br/>GET /api/v1/models<br/>x-api-key header"]
    Backend --> GoCheck["Google<br/>GET /v1/models<br/>?key= param"]

    ORCheck --> Result{valid?}
    OACheck --> Result
    AnCheck --> Result
    GoCheck --> Result

    Result -->|Yes| Green["Green checkmark<br/>Next enabled"]
    Result -->|No| Red["Red X<br/>Next disabled"]

    style OpenRouter fill:#3b82f6,color:#fff
    style Anthropic fill:#d97706,color:#fff
    style OpenAI fill:#10b981,color:#fff
    style Google fill:#ef4444,color:#fff
```

---

## 9. Kubernetes Deployment Lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending: deployment.create()

    pending --> creating: deployment.deploy()

    creating --> running: K8s pod healthy
    creating --> failed: CrashLoopBackOff / ImagePullBackOff

    running --> [*]: deployment.delete()
    failed --> [*]: deployment.delete()

    state creating {
        [*] --> CreatePVC: 5Gi Longhorn storage
        CreatePVC --> CreateSecret: Deployment config
        CreateSecret --> CreateK8sDeploy: Pod spec
        CreateK8sDeploy --> WaitPod: Monitor pod phase
        WaitPod --> [*]
    }

    note right of running
        Frontend polls getStatus
        Returns pod phase + restart count
    end note

    note right of failed
        Error message stored in DB
        User can delete and retry
    end note
```

---

## 10. Frontend Page & Component Tree

```mermaid
graph TB
    subgraph App["Next.js App Router"]
        Layout["layout.tsx<br/>(Providers)"]
        Home["/ Home.tsx"]
        Dashboard["/dashboard Dashboard.tsx"]
        Onboarding["/onboarding/id OnboardingWizard.tsx"]
        Configure["/d/id/configure DeploymentConfiguration.tsx"]
        Pricing["/pricing Pricing.tsx"]
        Login["/login Login.tsx"]
    end

    subgraph Providers["Provider Chain"]
        Auth0P[Auth0Provider]
        TrpcP[tRPC Provider]
        QueryP[QueryClient]
        ThemeP[ThemeProvider]
    end

    subgraph WizardSteps["OnboardingWizard Steps"]
        StepName[StepName]
        StepRuntime[StepChooseRuntime]
        StepLLM[StepLlmSetup]
        StepDeploy[StepDeploy]
        StepWA[StepConnectWhatsApp]
    end

    subgraph ConfigTabs["DeploymentConfiguration Tabs"]
        GeneralTab[GeneralTab]
        ModelTab[ModelTab]
        PlatformsTab[PlatformsTab]
        SkillsTab[SkillsTab]
        AdvancedTab[AdvancedTab]
    end

    Layout --> Auth0P --> TrpcP --> QueryP --> ThemeP
    Layout --> Home
    Layout --> Dashboard
    Layout --> Onboarding
    Layout --> Configure
    Layout --> Pricing
    Layout --> Login

    Onboarding --> WizardSteps
    Configure --> ConfigTabs

    style Onboarding fill:#ede9fe,stroke:#7c3aed
    style Configure fill:#dbeafe,stroke:#3b82f6
```

---

## 11. Stripe Payment Flow

```mermaid
sequenceDiagram
    actor User
    participant Frontend as Jarble-MVP
    participant API as Jarble-API
    participant Stripe as Stripe

    User->>Frontend: Click "Subscribe" on pricing

    alt Existing Stripe Customer
        Frontend->>API: POST /api/stripe/portal
        API->>Stripe: Create portal session
        Stripe-->>API: Portal URL
        API-->>Frontend: Redirect URL
        Frontend->>Stripe: Redirect to portal
    else New Customer
        Frontend->>API: POST /api/stripe/checkout
        API->>Stripe: Create checkout session
        Stripe-->>API: Checkout URL
        API-->>Frontend: Redirect URL
        Frontend->>Stripe: Redirect to checkout
    end

    User->>Stripe: Complete payment

    Stripe->>API: Webhook: checkout.session.completed
    API->>API: Verify signature + update user

    Stripe->>API: Webhook: subscription.updated
    API->>API: Log status change (TODO: sync deployment)

    Stripe->>API: Webhook: invoice.payment_failed
    API->>API: Log failure (TODO: flag account)
```

---

## 12. Multi-Database Provider Strategy

```mermaid
flowchart TD
    EnvVars["Environment Variables<br/>USE_SQLITE / DB_PROVIDER"] --> Decision{Which provider?}

    Decision -->|"USE_SQLITE=true<br/>or DB_PROVIDER=sqlite"| SQLite
    Decision -->|"DB_PROVIDER=mysql"| MySQL
    Decision -->|"DB_PROVIDER=postgres"| Postgres

    subgraph SQLite["SQLite (Development)"]
        SQLiteDriver["better-sqlite3<br/>in-memory"]
        SQLiteSchema["schema.sqlite.ts"]
        SQLiteInit["init.ts<br/>DDL + seed data"]
    end

    subgraph MySQL["MySQL (Production)"]
        MySQLDriver["mysql2<br/>DATABASE_URL"]
        MySQLSchema["schema.ts"]
    end

    subgraph Postgres["PostgreSQL (Production)"]
        PGDriver["postgres.js<br/>DATABASE_URL"]
        PGSchema["schema.pg.ts"]
    end

    SQLite --> DrizzleORM
    MySQL --> DrizzleORM
    Postgres --> DrizzleORM

    DrizzleORM["Drizzle ORM<br/>Unified query API"] --> AppCode["Application Code<br/>db.query.users.findFirst()<br/>db.insert(deployments).values()"]

    style SQLite fill:#fef3c7,stroke:#f59e0b
    style MySQL fill:#dbeafe,stroke:#3b82f6
    style Postgres fill:#d1fae5,stroke:#10b981
```

---

## 13. Express Server Route Map

```mermaid
flowchart LR
    Request([Incoming Request]) --> Express

    subgraph Express["Express :3001"]
        CORS["CORS<br/>(Frontend URL)"]

        subgraph PreJSON["Before JSON Parser"]
            StripeWH["POST /api/stripe/webhook<br/>(raw body for signature)"]
        end

        subgraph PostJSON["After JSON Parser"]
            Health["GET /health"]
            Debug["GET /debug/db (dev only)"]
            Checkout["POST /api/stripe/checkout"]
            Portal["POST /api/stripe/portal"]
            TRPC["ALL /trpc/*"]
        end
    end

    CORS --> PreJSON --> PostJSON

    TRPC --> Routers["tRPC Routers<br/>user / deployment<br/>runtimeCatalog / openrouter<br/>template"]

    StripeWH --> StripeVerify["Verify signature<br/>Parse event<br/>Handle webhooks"]

    style StripeWH fill:#e0e7ff,stroke:#6366f1
    style TRPC fill:#ede9fe,stroke:#7c3aed
```

---

## 14. OpenRouter Tenant Key Provisioning (Included Credits)

```mermaid
sequenceDiagram
    participant Wizard as OnboardingWizard
    participant API as deployment.create
    participant ORAPI as OpenRouter Management API
    participant DB as Database

    Wizard->>API: create({ llmMode: "included", ... })

    API->>API: Check OPENROUTER_MANAGEMENT_KEY exists
    alt Key not configured
        API-->>Wizard: Error: "Use BYOK mode"
    end

    API->>ORAPI: POST /api/v1/keys
    Note right of API: Bearer {managementKey}
    Note right of API: { name: "jarble-{userId}-{deploymentId}", limit: 5 }

    ORAPI-->>API: { key: "sk-or-tenant-abc123..." }

    API->>DB: INSERT deployment
    Note right of API: llmMode: "included"
    Note right of API: llmProvider: "openrouter"
    Note right of API: llmApiKey: provisioned key

    API-->>Wizard: deployment object
```

---

## 15. Free Trial Logic

```mermaid
flowchart TD
    NewUser([New User]) --> Check{freeDeploymentUsed?}

    Check -->|false| FreeFlow
    Check -->|true| PaidFlow

    subgraph FreeFlow["Free Trial Flow"]
        CreateFree["deployment.create()<br/>isFree: true<br/>monthlyPriceCents: 0"]
        SetExpiry["freeExpiresAt =<br/>now + 7 days"]
        MarkUsed["user.freeDeploymentUsed = true"]
        ShowBanner["Dashboard shows:<br/>Free trial - X days left"]

        CreateFree --> SetExpiry --> MarkUsed --> ShowBanner
    end

    subgraph PaidFlow["Paid Flow"]
        CreatePaid["deployment.create()<br/>isFree: false<br/>monthlyPriceCents: from catalog"]
        ShowPrice["Dashboard shows:<br/>price badge"]

        CreatePaid --> ShowPrice
    end

    ShowBanner --> Expired{Trial expired?}
    Expired -->|"After 7 days"| NeedUpgrade["Must upgrade<br/>or deploy new paid"]
    Expired -->|"Still active"| UsingFree["Continue using<br/>free deployment"]

    style FreeFlow fill:#d1fae5,stroke:#10b981
    style PaidFlow fill:#dbeafe,stroke:#3b82f6
```

---

## 16. Tech Stack

### Backend (`jarble-api-main`)

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 |
| Framework | Express 4 |
| API Layer | tRPC 11 (SuperJSON) |
| ORM | Drizzle ORM |
| Database | MySQL / PostgreSQL (prod) / SQLite (dev) |
| Auth | Auth0 + jose (JWT) |
| K8s Client | @kubernetes/client-node |
| Validation | Zod 3 |
| Logging | Pino |

### Frontend (`Jarble-mvp`)

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| UI | React 19 + Tailwind CSS 4 + shadcn/ui |
| State | React Query 5 (via tRPC) |
| Auth | @auth0/auth0-react |
| Icons | Lucide React |
| Toasts | Sonner |

### Infrastructure

| Component | Technology |
|-----------|-----------|
| Frontend | Vercel |
| API | K3s on Hetzner |
| Database | AWS RDS (MySQL) |
| Storage | Longhorn |
| Ingress | Traefik |
| Auth | Auth0 |
| LLM | OpenRouter (+ OpenAI, Anthropic, Google via BYOK) |
| Billing | Stripe |

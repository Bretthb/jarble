# Jarble Platform — Complete Overview & Roadmap

*Last updated: February 15, 2026*

---

## 1. Platform Architecture

Jarble is a **no-code AI deployment platform** that lets users deploy AI-powered bots (powered by LLMs) to messaging platforms in under 2 minutes — no coding required.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 15 (App Router), React 18, TypeScript |
| **Styling** | Tailwind CSS v4, shadcn/ui (40+ components), Framer Motion |
| **API** | Express + tRPC, SuperJSON serialization |
| **Database** | Drizzle ORM — MySQL (prod), PostgreSQL (alt), SQLite (dev) |
| **Auth** | Auth0 (Email/Password, Google OAuth, GitHub OAuth) |
| **Payments** | Stripe (subscriptions, checkout, webhooks) |
| **Infrastructure** | Kubernetes (Longhorn storage, Traefik ingress) |
| **LLM Providers** | OpenRouter, OpenAI, Anthropic, Google |
| **State Management** | React Query + tRPC hooks |

### System Architecture Diagram

```mermaid
graph TB
    subgraph "Frontend - Next.js 15"
        A[Landing Page] --> B[Auth0 Login]
        B --> C[Dashboard]
        C --> D[Onboarding Wizard]
        C --> E[Deployment Config]
        C --> F[Settings]
        D --> G[Deploy]
    end

    subgraph "API - Express + tRPC"
        H[User Router]
        I[Deployment Router]
        J[Runtime Catalog Router]
        K[OpenRouter Router]
        L[Template Router]
    end

    subgraph "Services"
        M[Auth Service - JWT + JWKS]
        N[Stripe Service - Subscriptions]
        O[K8s Service - Pod Management]
        P[OpenRouter Service - Key Provisioning]
    end

    subgraph "Data Layer"
        Q[(MySQL/Postgres)]
        R[Drizzle ORM]
    end

    subgraph "Infrastructure"
        S[Kubernetes Cluster]
        T[Longhorn Storage]
        U[Traefik Ingress]
    end

    C -->|tRPC| H
    C -->|tRPC| I
    D -->|tRPC| I
    D -->|tRPC| J
    D -->|tRPC| K
    E -->|tRPC| I
    F -->|tRPC| H

    H --> M
    I --> O
    I --> N
    K --> P
    H --> R
    I --> R
    J --> R
    R --> Q

    O --> S
    S --> T
    U --> S
```

---

## 2. Frontend — Pages & Routes

### Route Map

```mermaid
graph LR
    subgraph "Public Routes"
        P1["/ Home"]
        P2["/login"]
        P3["/register"]
        P4["/about"]
        P5["/pricing"]
    end

    subgraph "Protected Routes"
        R1["/dashboard"]
        R2["/onboarding/id"]
        R3["/d/id/configure"]
        R4["/settings"]
    end

    P1 -->|Sign In| P2
    P2 -->|Auth0| R1
    R1 -->|New Deployment| R2
    R1 -->|Click Deployment| R3
    R1 -->|Profile Icon| R4
    R2 -->|Complete| R1
```

### Pages Inventory

| Route | View | Description | Status |
|-------|------|-------------|--------|
| `/` | Home.tsx | Hero, integrations marquee, features grid, CTA | ✅ Complete |
| `/login` | Login.tsx | Auth0 Email/Google/GitHub sign-in | ✅ Complete |
| `/register` | — | Registration flow | ✅ Complete |
| `/about` | About.tsx | Company story, market stats, team | ✅ Complete (team placeholder) |
| `/pricing` | Pricing.tsx | Runtime catalog pricing, LLM credits, FAQ | ✅ Complete |
| `/dashboard` | Dashboard.tsx | Deployment cards, create/delete, status badges | ✅ Complete |
| `/onboarding/[id]` | OnboardingWizard.tsx | 5-step wizard: Name → Runtime → LLM → Deploy → WhatsApp | ✅ Complete |
| `/d/[id]/configure` | DeploymentConfiguration.tsx | Tabbed config (General, Model, Platforms, Skills, Advanced) | ✅ Complete |
| `/settings` | Settings.tsx | Profile, theme, password reset, account info | ✅ Complete |

---

## 3. Onboarding Wizard Flow

```mermaid
flowchart TD
    START([User clicks New Deployment]) --> NAME[Step 1: Name Your Bot]
    NAME -->|min 2 chars| RUNTIME[Step 2: Choose Runtime]

    RUNTIME --> CHECK{Which Runtime?}

    CHECK -->|OpenClaw| LLM[Step 3: LLM Setup]
    CHECK -->|ZeroClaw| DEPLOY2[Step 3: Deploy]

    LLM --> MODE{LLM Mode?}
    MODE -->|Included Credits| DEPLOY[Step 4: Deploy]
    MODE -->|BYOK| APIKEY[Enter API Key]
    APIKEY -->|Validate Key| DEPLOY

    DEPLOY -->|Email Verified?| VERIFY{Verified?}
    VERIFY -->|No| BLOCK[Show Verification Warning]
    VERIFY -->|Yes| CREATING[Creating Deployment...]
    DEPLOY2 -->|Email Verified?| VERIFY

    CREATING --> K8S[K8s Resources Created]
    K8S --> WHATSAPP[Step 5: Connect WhatsApp]
    WHATSAPP --> DONE([Dashboard])
```

---

## 4. Backend — API Routers & Procedures

### tRPC Router Map

```mermaid
graph TB
    subgraph "User Router"
        U1[me - public query]
        U2[getProfile - protected]
        U3[updateProfile - protected]
        U4[completeProfile - protected]
    end

    subgraph "Deployment Router"
        D1[canDeploy - query]
        D2[list - query]
        D3[getById - query]
        D4[create - mutation]
        D5[deploy - mutation]
        D6[getStatus - query]
        D7[update - mutation]
        D8[delete - mutation]
    end

    subgraph "Runtime Catalog Router"
        RC1[list - public query]
        RC2[getById - public query]
        RC3[getBySlug - public query]
    end

    subgraph "OpenRouter Router"
        OR1[healthCheck - query]
        OR2[models - query]
        OR3[validateApiKey - mutation]
        OR4[validateProviderKey - mutation]
        OR5[provisionKey - mutation]
    end

    subgraph "Template Router"
        T1[list - public query]
    end
```

### Procedures Detail

| Router | Procedure | Type | Auth | Description |
|--------|-----------|------|------|-------------|
| **user** | me | query | public | Current user from context |
| **user** | getProfile | query | protected | Full user profile from DB |
| **user** | updateProfile | mutation | protected | Update name/email |
| **user** | completeProfile | mutation | protected | Complete profile for email signups |
| **deployment** | canDeploy | query | protected | Check free deployment eligibility |
| **deployment** | list | query | protected | All user deployments |
| **deployment** | getById | query | protected | Single deployment |
| **deployment** | create | mutation | protected | Create deployment record + provision LLM key |
| **deployment** | deploy | mutation | protected | Trigger K8s deployment (async) |
| **deployment** | getStatus | query | protected | Pod status from K8s |
| **deployment** | update | mutation | protected | Update deployment config |
| **deployment** | delete | mutation | protected | Delete K8s resources + DB record |
| **runtimeCatalog** | list | query | public | All active runtimes |
| **openrouter** | validateProviderKey | mutation | protected | Multi-provider key validation |
| **openrouter** | provisionKey | mutation | protected | Provision OpenRouter tenant key |
| **template** | list | query | public | Hardcoded templates (3) |

---

## 5. Database Schema

```mermaid
erDiagram
    users {
        varchar id PK
        varchar email UK
        varchar name
        varchar auth0Id UK
        boolean emailVerified
        varchar stripeCustomerId
        boolean freeDeploymentUsed
        timestamp freeTrialExpiresAt
        timestamp createdAt
        timestamp updatedAt
    }

    deployments {
        varchar id PK
        varchar userId FK
        varchar name
        text description
        varchar runtime
        varchar image
        int runtimeCatalogId FK
        boolean isFree
        int monthlyPriceCents
        timestamp freeExpiresAt
        varchar cpuLimit
        int memoryMb
        int storageMb
        varchar llmMode
        varchar llmProvider
        varchar llmModel
        varchar llmApiKey
        varchar status
        text error
        timestamp createdAt
        timestamp updatedAt
    }

    runtimeCatalog {
        int id PK
        varchar slug UK
        varchar name
        text description
        varchar category
        varchar dockerImage
        varchar cpuLimit
        int memoryMb
        int storageMb
        int monthlyPriceCents
        boolean isActive
        timestamp createdAt
    }

    users ||--o{ deployments : "has many"
    runtimeCatalog ||--o{ deployments : "used by"
```

### Field Details

**users table**
- `id` — nanoid(12) primary key
- `llmMode` — "included" or "byok" (bring-your-own-key)
- `llmProvider` — "openrouter", "openai", "anthropic", or "google"
- `status` — "pending", "creating", "running", or "failed"
- `freeDeploymentUsed` — one-time flag, user gets exactly 1 free deployment

---

## 6. Deployment Flow (End-to-End)

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Frontend
    participant API as tRPC API
    participant DB as Database
    participant OR as OpenRouter
    participant K8s as Kubernetes

    U->>FE: Complete wizard steps
    FE->>API: deployment.create(config)

    alt LLM Mode = included
        API->>OR: provisionKey - $5 limit
        OR-->>API: tenant API key
    end

    API->>DB: INSERT deployment status=pending
    DB-->>API: deployment record
    API-->>FE: deployment created

    FE->>API: deployment.deploy(id)
    API->>DB: UPDATE status=creating

    API->>K8s: Create PVC storage
    API->>K8s: Create Secret env vars
    API->>K8s: Create Deployment container

    loop Poll Status
        FE->>API: deployment.getStatus(id)
        API->>K8s: Get pod status
        K8s-->>API: phase + restarts
        API-->>FE: creating or running or failed
    end

    K8s-->>API: Pod running
    API->>DB: UPDATE status=running
    API-->>FE: Deployment ready!
```

---

## 7. Kubernetes Resource Architecture

```mermaid
graph TB
    subgraph "jarble namespace"
        subgraph "API Infrastructure"
            SA[ServiceAccount: jarble-api]
            ROLE[Role: RBAC Permissions]
            RB[RoleBinding]
            API_DEP[Deployment: jarble-api - 2 replicas]
            SVC[Service: ClusterIP 80 to 3001]
            ING[Ingress: api.jarble.ai - Traefik + TLS]
        end

        subgraph "Per-User Deployment"
            PVC[PVC: deploy-ID - Longhorn storage]
            SEC[Secret: deploy-ID - API keys + config]
            BOT[Deployment: deploy-ID - 1 replica]
        end
    end

    SA --> ROLE
    ROLE --> RB
    ING --> SVC
    SVC --> API_DEP
    API_DEP -.->|manages| PVC
    API_DEP -.->|manages| SEC
    API_DEP -.->|manages| BOT
    BOT --> PVC
    BOT --> SEC
```

### K8s Resources Per Deployment

| Resource | Details |
|----------|---------|
| **PVC** | Longhorn storage class, ReadWriteOnce, size from config (min 1Gi) |
| **Secret** | DEPLOYMENT_ID, USER_ID, DEPLOYMENT_NAME, TEMPLATE, RUNTIME, OPENROUTER_API_KEY |
| **Deployment** | 1 replica, custom CPU/RAM limits, volume mount at /data |

### API Infrastructure

| Component | Spec |
|-----------|------|
| **Replicas** | 2 |
| **CPU** | 250m request / 500m limit |
| **RAM** | 256Mi request / 512Mi limit |
| **Probes** | Liveness: /health (10s delay, 30s period), Readiness: /health (5s delay, 10s period) |
| **Ingress** | Traefik, TLS, host: api.jarble.ai |

---

## 8. Auth & Security Flow

```mermaid
flowchart TD
    subgraph "Login Options"
        EP[Email/Password]
        GO[Google OAuth]
        GH[GitHub OAuth]
    end

    EP --> AUTH0[Auth0]
    GO --> AUTH0
    GH --> AUTH0

    AUTH0 -->|JWT Token| FE[Frontend]
    FE -->|Bearer Token| API[API Server]
    API --> VERIFY{Verify JWT}
    VERIFY -->|Valid| JWKS[JWKS Endpoint]
    JWKS --> CLAIMS[Extract Claims]
    CLAIMS --> PROVISION{User Exists?}
    PROVISION -->|No| CREATE[Auto-Create User]
    PROVISION -->|Yes| UPDATE[Update if Changed]
    CREATE --> CONTEXT[Set User Context]
    UPDATE --> CONTEXT

    subgraph "Email Verification Gate"
        CONTEXT --> DEPLOY_CHECK{Deploy Action?}
        DEPLOY_CHECK -->|Yes| EMAIL_CHECK{Email Verified?}
        EMAIL_CHECK -->|No| BLOCK[Block + Show Warning]
        EMAIL_CHECK -->|Yes| ALLOW[Allow Deployment]
    end
```

### Auth Details

| Feature | Implementation |
|---------|---------------|
| **JWT Verification** | jose library, JWKS caching |
| **Issuer** | `https://{AUTH0_DOMAIN}/` |
| **Audience** | `https://api.jarble.ai` |
| **User Provisioning** | Auto-create on first login with nanoid(12) IDs |
| **Google Users** | Auto-verified email, account linking by email |
| **Email/Password** | Reset password via Auth0 `dbconnections/change_password` |
| **Email Gate** | Deployments blocked until `email_verified === true` |

---

## 9. Payment Flow (Stripe)

```mermaid
flowchart TD
    subgraph "Checkout Flow"
        USER[User selects plan] --> CHECKOUT[API creates Stripe Checkout]
        CHECKOUT --> STRIPE[Stripe hosted page]
        STRIPE -->|Success| WEBHOOK[Webhook: checkout.session.completed]
        WEBHOOK --> DB_UPDATE[Update user stripeCustomerId]
    end

    subgraph "Subscription Lifecycle"
        ACTIVE[Active Subscription]
        ACTIVE -->|Change plan| SUB_UPDATE[Webhook: subscription.updated]
        ACTIVE -->|Cancel| SUB_DELETE[Webhook: subscription.deleted]
        ACTIVE -->|Payment fail| PAY_FAIL[Webhook: invoice.payment_failed]
    end

    subgraph "Billing Portal"
        PORTAL[User clicks Manage Billing] --> STRIPE_PORTAL[Stripe Customer Portal]
        STRIPE_PORTAL --> MANAGE[Update/Cancel subscription]
    end

    SUB_UPDATE -.->|TODO| SYNC[Sync deployment status]
    SUB_DELETE -.->|TODO| STOP[Stop paid deployments]
    PAY_FAIL -.->|TODO| FLAG[Flag account + notify]
```

### Stripe Integration Status

| Feature | Status |
|---------|--------|
| Checkout session creation | ✅ Implemented |
| Portal session creation | ✅ Implemented |
| Webhook signature verification | ✅ Implemented |
| checkout.session.completed | ✅ Implemented |
| subscription.updated → sync deployments | ❌ TODO |
| subscription.deleted → stop deployments | ❌ TODO |
| invoice.payment_failed → flag account | ❌ TODO |

---

## 10. What's Built (Complete)

### Frontend ✅

- [x] Landing page with hero animation, features grid, integrations marquee
- [x] Auth0 login/register with Google, GitHub, Email/Password
- [x] Protected route guards with auth redirects
- [x] Dashboard with deployment cards (status, pricing, delete)
- [x] 5-step onboarding wizard (Name → Runtime → LLM → Deploy → WhatsApp)
- [x] Deployment configuration (General, Model, Platforms, Skills, Advanced tabs)
- [x] Settings page (profile, theme toggle, password reset)
- [x] Dark mode with localStorage persistence + system preference detection
- [x] Email verification gate on deployments
- [x] Profile dropdown (avatar, settings, theme, logout)
- [x] About page (company narrative, market stats)
- [x] Pricing page (runtime catalog, LLM credits, FAQ)
- [x] Error boundaries + toast notifications
- [x] Responsive design (mobile + desktop)
- [x] 40+ shadcn/ui components

### Backend ✅

- [x] Auth0 JWT verification + auto user provisioning
- [x] Deployment CRUD (create, read, update, delete)
- [x] Kubernetes deployment orchestration (PVC, Secret, Deployment)
- [x] K8s pod status monitoring (phase, restarts, errors)
- [x] Free tier system (1 free deployment, 7-day expiry)
- [x] Runtime catalog management
- [x] Multi-LLM provider support (OpenRouter, OpenAI, Anthropic, Google)
- [x] API key validation per provider
- [x] OpenRouter tenant key provisioning ($5/mo limit)
- [x] Stripe checkout + portal + webhook handling
- [x] CORS configuration
- [x] Health checks (K8s liveness/readiness probes)
- [x] Multi-database support (MySQL, PostgreSQL, SQLite)

---

## 11. What's NOT Built Yet — Roadmap

### 🔴 Critical (Must-Have for Launch)

| # | Task | Description | Effort |
|---|------|-------------|--------|
| 1 | **Platform credential storage** | Wire PlatformsTab to API — save WhatsApp/Discord/Slack/Telegram credentials to DB, test connections, disconnect | Medium |
| 2 | **Stripe subscription → deployment sync** | When subscription changes/cancels, update deployment status. Handle payment failures. | Medium |
| 3 | **Deployment status toggle** | Pause/resume deployments from config page (API + K8s support) | Medium |
| 4 | **Drizzle migrations regeneration** | Current migrations are stale — regenerate from updated schemas | Small |
| 5 | **Webhook configuration** | Save webhook URLs, send events on deployment status changes | Medium |
| 6 | **WhatsApp QR integration** | Replace mock QR code with real WhatsApp Business API connection | Large |
| 7 | **Email verification resend** | Add "Resend verification email" button for unverified users | Small |

### 🟡 Important (Post-Launch)

| # | Task | Description | Effort |
|---|------|-------------|--------|
| 8 | **Deployment logs** | Stream container logs from K8s pods to frontend | Medium |
| 9 | **Real-time status updates** | WebSocket/SSE for live deployment status instead of polling | Medium |
| 10 | **Usage analytics dashboard** | Track API calls, message counts, costs per deployment | Large |
| 11 | **Billing management page** | Show invoices, usage, upgrade/downgrade plans | Medium |
| 12 | **API key management** | Rotate, revoke, regenerate LLM keys from dashboard | Small |
| 13 | **Rate limiting** | Add rate limiting on API routes to prevent abuse | Small |
| 14 | **Templates database** | Move hardcoded templates to DB, allow custom templates | Medium |
| 15 | **Deployment history** | Track config changes, restarts, status transitions | Medium |

### 🟢 Nice-to-Have (Future)

| # | Task | Description | Effort |
|---|------|-------------|--------|
| 16 | **Multi-deployment management** | Bulk actions, deployment groups, labels | Medium |
| 17 | **Custom domain support** | Allow users to point custom domains to their bots | Large |
| 18 | **Team/organization support** | Multi-user orgs, role-based access, shared deployments | Large |
| 19 | **Chat testing playground** | In-browser chat interface to test bot before deploying | Medium |
| 20 | **Skill marketplace** | Browse, install, configure pre-built skills/plugins | Large |
| 21 | **CI/CD integration** | GitHub Actions / GitLab CI for deployment automation | Medium |
| 22 | **Image upload for avatar** | Settings page avatar change | Small |
| 23 | **Guided tour** | Interactive onboarding tour for new users | Small |
| 24 | **About page team section** | Replace placeholder team cards with real profiles | Small |
| 25 | **LLM fine-tuning integration** | Allow users to fine-tune models on their data | Large |

---

## 12. Component Inventory

### Shared Components

| Component | Purpose |
|-----------|---------|
| ProfileDropdown | User avatar dropdown (settings, theme, logout) |
| IntegrationsMarquee | Scrolling platform integration logos with search |
| TemplateSelector | Template selection for deployment creation |
| WizardLoader | Animated deployment progress indicator |
| ErrorBoundary | Graceful error handling wrapper |
| ThemeToggle | Light/dark mode toggle button |
| PlatformConfigForm | Generic form builder for platform credentials |
| SubscribeButton | Stripe subscription button |
| DevNav | Development-only navigation bar |

### Auth Components

| Component | Purpose |
|-----------|---------|
| Auth0Provider | Auth0 SDK wrapper with config |
| LoginButton | Auth0 login trigger |
| LogoutButton | Auth0 logout trigger |

### UI Library (shadcn/ui)

40+ components including: Accordion, Alert, Avatar, Badge, Button, Card, Checkbox, Dialog, Dropdown Menu, Input, Label, Popover, Progress, Select, Separator, Sheet, Skeleton, Slider, Switch, Table, Tabs, Textarea, Toast (Sonner), Toggle, Tooltip

---

## 13. Environment Variables

### Frontend (.env.local)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_AUTH0_DOMAIN` | Auth0 tenant domain (jarble-dev.us.auth0.com) |
| `NEXT_PUBLIC_AUTH0_CLIENT_ID` | Auth0 application client ID |
| `NEXT_PUBLIC_AUTH0_AUDIENCE` | Auth0 API audience (https://api.jarble.ai) |

### Backend (.env)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No (default: 3001) | Server port |
| `NODE_ENV` | No (default: development) | Environment |
| `FRONTEND_URL` | No (default: http://localhost:3000) | CORS origin |
| `DATABASE_URL` | Yes (unless SQLite) | Database connection string |
| `DB_PROVIDER` | No (default: mysql) | mysql, postgres, or sqlite |
| `AUTH0_DOMAIN` | Yes | Auth0 tenant domain |
| `AUTH0_AUDIENCE` | Yes | Auth0 API audience |
| `OPENROUTER_API_KEY` | No | OpenRouter API key |
| `OPENROUTER_MANAGEMENT_KEY` | No | OpenRouter Management API key for provisioning |
| `STRIPE_SECRET_KEY` | No | Stripe secret key (Stripe disabled if not set) |
| `STRIPE_WEBHOOK_SECRET` | If Stripe enabled | Stripe webhook signing secret |
| `STRIPE_PRICE_PRO` | If Stripe enabled | Stripe price ID for Pro tier |
| `STRIPE_PRICE_AGENCY` | If Stripe enabled | Stripe price ID for Agency tier |

---

## 14. File Structure Overview

```
monorepo/
├── Jarble-mvp/                        # Frontend (Next.js 15)
│   ├── app/                           # App Router routes
│   │   ├── layout.tsx                 # Root layout
│   │   ├── providers.tsx              # Auth0 + tRPC + Theme providers
│   │   ├── page.tsx                   # Home page
│   │   ├── globals.css                # Global styles + CSS variables
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   ├── about/page.tsx
│   │   ├── pricing/page.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── settings/page.tsx
│   │   ├── onboarding/[id]/page.tsx
│   │   └── d/[id]/configure/page.tsx
│   ├── views/                         # Page-level view components
│   │   ├── Home.tsx
│   │   ├── Dashboard.tsx
│   │   ├── OnboardingWizard.tsx
│   │   ├── DeploymentConfiguration.tsx
│   │   ├── Settings.tsx
│   │   ├── Login.tsx
│   │   ├── About.tsx
│   │   ├── Pricing.tsx
│   │   ├── NotFound.tsx
│   │   └── deployment-config/
│   │       ├── GeneralTab.tsx
│   │       ├── ModelTab.tsx
│   │       ├── PlatformsTab.tsx
│   │       ├── SkillsTab.tsx
│   │       ├── AdvancedTab.tsx
│   │       └── types.ts
│   ├── components/                    # Shared components
│   │   ├── auth/                      # Auth0 wrappers
│   │   ├── ui/                        # 40+ shadcn components
│   │   ├── ProfileDropdown.tsx
│   │   ├── IntegrationsMarquee.tsx
│   │   ├── WizardLoader.tsx
│   │   ├── TemplateSelector.tsx
│   │   ├── PlatformConfigForm.tsx
│   │   ├── SubscribeButton.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── ThemeToggle.tsx
│   │   ├── WatercolorBlob.tsx
│   │   ├── GuidedTour.tsx
│   │   └── DevNav.tsx
│   ├── contexts/
│   │   └── ThemeContext.tsx
│   ├── hooks/
│   │   ├── useMobile.tsx
│   │   ├── useComposition.ts
│   │   └── usePersistFn.ts
│   ├── lib/
│   │   ├── trpc.ts
│   │   ├── const.ts
│   │   ├── platformConfigs.ts
│   │   └── utils.ts
│   └── public/                        # Static assets
│       ├── hero-animation.webm
│       ├── hero-mobile.webp
│       └── ...
│
├── jarble-api-main/                   # Backend (Express + tRPC)
│   ├── src/
│   │   ├── index.ts                   # Server entry + Stripe webhooks
│   │   ├── trpc/
│   │   │   ├── index.ts               # Router exports
│   │   │   ├── context.ts             # tRPC context (auth + DB)
│   │   │   └── routers/
│   │   │       ├── user.ts
│   │   │       ├── deployment.ts
│   │   │       ├── runtimeCatalog.ts
│   │   │       ├── openrouter.ts
│   │   │       └── template.ts
│   │   ├── db/
│   │   │   ├── schema.ts             # MySQL schema (Drizzle)
│   │   │   ├── schema.pg.ts          # Postgres schema
│   │   │   ├── schema.sqlite.ts      # SQLite schema
│   │   │   └── init.ts               # DB init + test data seeding
│   │   ├── services/
│   │   │   ├── auth.ts               # JWT verification + user provisioning
│   │   │   └── stripe.ts             # Stripe checkout/portal/webhooks
│   │   ├── k8s/
│   │   │   └── deployment.ts         # K8s orchestration (PVC, Secret, Deployment)
│   │   └── utils/
│   │       └── env.ts                # Zod env validation
│   ├── k8s/
│   │   └── deployment.yaml           # K8s manifests (SA, Role, Deployment, Service, Ingress)
│   ├── drizzle/                       # MySQL migrations (stale)
│   └── drizzle-pg/                    # Postgres migrations (stale)
```

---

*This document provides a complete snapshot of the Jarble platform as of February 2026. Use the roadmap section to prioritize next steps.*

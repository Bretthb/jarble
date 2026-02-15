# Plan: Migrate to Production 7-Table Schema (Full Stack)

## Context

The Jarble platform currently runs a simplified 3-table dev schema (users, deployments, tiers). The production schema will have 7 tables that properly model platform connections, usage tracking, deployment task history, tier-based resource limits, and subscription management. This plan updates **both** the API (MySQL + SQLite schemas, tRPC routers, K8s deployment, auth) **and** the frontend (OnboardingWizard, Dashboard, DeploymentConfiguration tabs) to match.

> **Completed: bots → deployments rename.** The core entity was renamed from "bots" to "deployments" across the entire codebase. Two new fields were added: `runtime` (varchar 100, default "openclaw") and `image` (varchar 255, nullable) to support multiple container types beyond OpenClaw. Frontend routes changed from `/bot/[botId]/...` to `/d/[id]/...`.

**Production architecture:**
- Vercel (Next.js) → HTTPS → Hetzner K3s (Express/tRPC API pod + Deployment pods)
- Longhorn distributed block storage across K3s VPS nodes
- AWS RDS (MySQL) for production DB
- External: Auth0, OpenRouter, Stripe

**Production architecture diagram:**
```
flowchart TB
    subgraph Vercel["Vercel (Frontend)"]
        Next["Next.js App"]
        Static["Static Assets"]
    end
    subgraph Hetzner["Hetzner K3s Cluster"]
        subgraph API["API Pod"]
            Express["Express Server"]
            TRPC["tRPC Router"]
            K8sClient["K8s Client"]
            Drizzle["Drizzle ORM"]
        end
        subgraph Deployments["Deployment Pods"]
            Dep1["dep-abc123"]
            Dep2["dep-def456"]
            Dep3["dep-ghi789"]
        end
        Longhorn[("Longhorn Storage")]
    end
    subgraph External["External"]
        RDS[("AWS RDS")]
        Auth0["Auth0"]
        OpenRouter["OpenRouter"]
        Stripe["Stripe"]
    end
    Next -->|"HTTPS API calls"| Express
    Express --> TRPC
    TRPC --> K8sClient
    TRPC --> Drizzle
    K8sClient -->|"Create/Delete/Status"| Deployments
    Drizzle --> RDS
    TRPC --> Auth0
    TRPC --> OpenRouter
    TRPC --> Stripe
    Deployments --> Longhorn
```

**Key decision:** Keep `id` as VARCHAR/TEXT (nanoid strings) for users and deployments. The new schema spec says INT AUTO_INCREMENT, but the entire codebase uses string IDs. Changing to INT would cascade through every file. We keep string IDs.

---

## New 7-Table Schema

### 1. users
- id (PK, VARCHAR — nanoid string)
- auth0Id (VARCHAR 128, unique)
- email (VARCHAR 320, unique)
- phoneNumber (VARCHAR 20)
- name (VARCHAR 255)
- tier (VARCHAR — "free"/"pro"/"agency", default "free")
- stripeCustomerId, subscriptionId (VARCHAR 255)
- subscriptionStatus (VARCHAR — "none"/"active"/"canceled"/"past_due"/"trialing", default "none")
- createdAt, updatedAt, lastSignedIn (TIMESTAMP)

### 2. deployments _(renamed from bots)_
- id (PK, VARCHAR — nanoid string)
- userId (FK → users)
- name (VARCHAR 255)
- description (TEXT)
- template (VARCHAR 100)
- **runtime** (VARCHAR 100, NOT NULL, default "openclaw") — container runtime type (openclaw, langchain, custom, etc.)
- **image** (VARCHAR 255, nullable) — Docker image override per deployment
- status (VARCHAR — "creating"/"deploying"/"running"/"restarting"/"error"/"deleted")
- error (TEXT)
- tierId (FK → tiers)
- createdAt, updatedAt (TIMESTAMP)

> **Future columns (Phase 2+):** personality (TEXT), model (VARCHAR 100), llmApiKey/llmApiKeyHash (VARCHAR 255), storagePath (VARCHAR 255), storageBytes (BIGINT), storageUpdatedAt (TIMESTAMP), deployedAt (TIMESTAMP)

### 3. tiers
- id (PK, INT auto-increment)
- name (VARCHAR — "free"/"pro"/"agency")
- displayName (VARCHAR 50)
- maxDeployments (INT)
- monthlyCredits (INT)
- maxStorageMb (INT) — per deployment storage limit
- cpuLimit (VARCHAR 10) — e.g. "0.25"
- memoryMb (INT) — e.g. 512
- priceMonthly (INT) — in cents
- stripePriceId (VARCHAR 255)

### 4. platforms
- id (PK, INT auto-increment)
- name (VARCHAR 50, unique) — whatsapp, telegram, discord, etc.
- displayName (VARCHAR 100)
- icon (VARCHAR 255)
- configSchema (JSON) — defines credential fields for each platform

### 5. deploymentPlatforms _(renamed from botPlatforms)_
- id (PK, INT auto-increment)
- deploymentId (FK → deployments)
- platformId (FK → platforms)
- status (VARCHAR — "pending"/"connected"/"disconnected"/"error")
- config (JSON) — platform-specific settings
- errorMessage (TEXT)
- connectedAt, createdAt, updatedAt (TIMESTAMP)

### 6. usageRecords
- id (PK, INT auto-increment)
- deploymentId (FK → deployments)
- userId (FK → users)
- model (VARCHAR 100)
- inputTokens, outputTokens (INT)
- creditsUsed (INT)
- createdAt (TIMESTAMP)

### 7. deploymentTasks _(renamed from botTasks)_
- id (PK, INT auto-increment)
- deploymentId (FK → deployments)
- podName (VARCHAR 255) — K3s pod name
- status (VARCHAR — "pending"/"running"/"stopped"/"failed")
- startedAt, stoppedAt (TIMESTAMP)
- stopReason (VARCHAR — "user-deleted"/"crashed"/"oom"/"timeout"/"scaling"/"unknown")
- exitCode (INT)
- createdAt (TIMESTAMP)

---

## Phase 1: MySQL Schema (`schema.ts`) ✅ PARTIALLY DONE

**File: `jarble-api-main/src/db/schema.ts`**

> **Done:** Renamed `bots` → `deployments`, added `runtime` (varchar 100, default "openclaw") and `image` (varchar 255, nullable), updated all relations.

### 1a. Rewrite `users` table
- **Keep:** id (varchar PK), email, name, auth0Id, stripeCustomerId, createdAt, updatedAt
- **Add:** phoneNumber (varchar 20), tier (varchar — default "free"), subscriptionId (varchar 255), subscriptionStatus (varchar — default "none"), lastSignedIn (timestamp)

### 1b. Expand `deployments` table (formerly bots)
- **Current columns:** id, userId, name, description, template, runtime, image, status, error, tierId, createdAt, updatedAt
- **Add (future):** personality (text), model (varchar 100), llmApiKey (varchar 255), llmApiKeyHash (varchar 255), storagePath (varchar 255), storageBytes (bigint default 0), storageUpdatedAt (timestamp), deployedAt (timestamp)

### 1c. Rewrite `tiers` table
- **Complete replacement.** Old: name/description/price/creditsPerMonth/features/isActive/createdAt
- **New:** name, displayName, maxDeployments, monthlyCredits, maxStorageMb, cpuLimit, memoryMb, priceMonthly (cents), stripePriceId

### 1d–1g. Add 4 new tables
- platforms, deploymentPlatforms, usageRecords, deploymentTasks (see schema above)

### 1h. Update relations
- users → many(deployments, usageRecords)
- deployments → one(users), many(deploymentPlatforms, usageRecords, deploymentTasks) — remove tier relation
- platforms → many(deploymentPlatforms)
- deploymentPlatforms → one(deployments), one(platforms)
- usageRecords → one(deployments), one(users)
- deploymentTasks → one(deployments)

---

## Phase 2: SQLite Schema (`schema.sqlite.ts`) ✅ PARTIALLY DONE

**File: `jarble-api-main/src/db/schema.sqlite.ts`**

> **Done:** Renamed `bots` → `deployments`, added `runtime` (text, default "openclaw") and `image` (text, nullable), updated all relations.

Mirror every change from Phase 1 using SQLite equivalents:
- MySQL varchar/enum → SQLite `text()`
- MySQL timestamp → SQLite `text().$defaultFn(now)`
- MySQL json → SQLite `text()` (store as JSON string)
- MySQL bigint → SQLite `integer()`
- MySQL int auto → SQLite `integer().primaryKey({ autoIncrement: true })`

---

## Phase 3: DB Index + Init + Seed ✅ PARTIALLY DONE

> **Done:** `db/index.ts` updated to export `deployments` (was `bots`). `db/init.ts` CREATE TABLE SQL updated to `deployments` with `runtime`/`image` columns, seed data updated.

### 3a. `db/index.ts` — expand `tables` export to include all 7 tables

### 3b. `db/init.ts` — rewrite CREATE TABLE SQL + seed data
- **Tiers (3):** free ($0, 1 deployment, 1000 credits, 100MB, 0.25 CPU, 512MB), pro ($19, 5 deployments, 10K credits, 500MB, 0.5 CPU, 1024MB), agency ($99, 50 deployments, 100K credits, 2000MB, 1.0 CPU, 2048MB)
- **Platforms (5):** whatsapp, telegram, discord, slack, web — each with configSchema JSON
- **Test user:** tier "free", subscriptionStatus "none"
- **Test deployment:** runtime "openclaw", template "assistant"
- **Test deploymentPlatform:** link test deployment to whatsapp

---

## Phase 4: tRPC Router Updates ✅ PARTIALLY DONE

> **Done:** `routers/bot.ts` renamed to `routers/deployment.ts`, `botRouter` → `deploymentRouter`, all queries use `deployments` table with `runtime`/`image` fields. `trpc/index.ts` updated to register `deployment` router.

### 4a. `routers/user.ts` — switch to `tables` import, add phoneNumber field
### 4b. `routers/deployment.ts` — add getTaskHistory, expand fields for future columns
### 4c. `routers/tier.ts` — switch to `tables` import, update orderBy to priceMonthly
### 4d. NEW `routers/platform.ts` — list, getById
### 4e. NEW `routers/deploymentPlatform.ts` — listByDeployment, connect, updateConfig, disconnect, updateStatus
### 4f. NEW `routers/usage.ts` — record, getByDeployment, getSummary
### 4g. `trpc/index.ts` — add 3 new routers, remove template router

---

## Phase 5: Auth Service Update (`services/auth.ts`)
- Add default tier/subscription fields when creating user
- Update lastSignedIn timestamp

## Phase 6: K8s Deployment Update (`k8s/deployment.ts`) ✅ DONE
> **Done:** Renamed from `bot-deployment.ts` to `deployment.ts`. `BotConfig` → `DeploymentConfig` with `runtime`/`image` fields. Functions renamed: `createDeployment`, `deleteDeployment`, `getDeploymentPodStatus`. K8s resources prefixed `dep-` instead of `bot-`. Container image supports per-deployment override via `config.image || DEFAULT_IMAGE`.

- Use tier-based resource limits instead of hardcoded values (future)

## Phase 7: Server Entry Point (`src/index.ts`) ✅ DONE
> **Done:** Debug endpoint updated to query `deployments` table.

---

## Phase 8: Frontend Types ✅ PARTIALLY DONE

> **Done:** `views/bot-config/` renamed to `views/deployment-config/`. `BotFormData` → `DeploymentFormData` with `runtime`/`image` fields. All tab files updated with new import paths and terminology.

### 8a. `views/deployment-config/types.ts` — Add personality/model/llmApiKey fields (future)
### 8b. `lib/platformConfigs.ts` — Remove hardcoded configs, keep validation helpers

## Phase 9: Frontend Views ✅ PARTIALLY DONE

> **Done:** Full bots→deployments rename across all views. Routes changed: `/bot/[botId]/configure` → `/d/[id]/configure`, `/onboarding/[botId]` → `/onboarding/[id]`. `BotConfiguration.tsx` → `DeploymentConfiguration.tsx`. Dashboard uses `trpc.deployment.*`. OnboardingWizard step 2 changed to "Choose Runtime" with OpenClaw selected by default.

### 9a. `Dashboard.tsx` — Add new statuses (future)
### 9b. `OnboardingWizard.tsx` — Add personality/model steps (future, after schema columns added)
### 9c. `DeploymentConfiguration.tsx` — Expand formData for future columns
### 9d. `GeneralTab.tsx` — Description → Personality (future)
### 9e. `ModelTab.tsx` — Single model selector using OpenRouter IDs (future)
### 9f. `PlatformsTab.tsx` — Major refactor: API-driven via trpc.platform.list + trpc.deploymentPlatform.* (future)
### 9g. `AdvancedTab.tsx` — Add storage/deployment/task history sections (future)
### 9h. Delete `TemplateSelector.tsx`

---

## Implementation Order

```
Phase 1 (MySQL schema) ─┐
Phase 2 (SQLite schema) ─┤
                         ├─ Phase 3 (db/index + init) ─┐
                         │                              ├─ Phase 4 (routers)
                         │                              ├─ Phase 5 (auth)
                         │                              └─ Phase 6 (K8s)
                         │                                      │
                         │                              ├─ Phase 7 (debug endpoint)
                         │                              ├─ Phase 8 (frontend types)
                         │                              └─ Phase 9 (frontend views)
```

---

## Files Modified (Complete List)

**API — jarble-api-main/src/:**
| File | Action | Status |
|------|--------|--------|
| `db/schema.ts` | Renamed bots→deployments, added runtime/image | ✅ Done |
| `db/schema.sqlite.ts` | Mirror schema.ts changes | ✅ Done |
| `db/index.ts` | Updated tables export (bots→deployments) | ✅ Done |
| `db/init.ts` | Updated CREATE TABLE + seed data | ✅ Done |
| `trpc/index.ts` | Updated: bot→deployment router | ✅ Done |
| `trpc/routers/deployment.ts` | **NEW** (replaced bot.ts) — all deployment CRUD | ✅ Done |
| `trpc/routers/bot.ts` | **DELETED** | ✅ Done |
| `trpc/routers/user.ts` | Switch to tables import, add fields | Pending |
| `trpc/routers/tier.ts` | Switch to tables import, update orderBy, add getByName | Pending |
| `trpc/routers/platform.ts` | **NEW** — platform CRUD | Pending |
| `trpc/routers/deploymentPlatform.ts` | **NEW** — deployment-platform connections | Pending |
| `trpc/routers/usage.ts` | **NEW** — usage tracking | Pending |
| `trpc/routers/template.ts` | **DELETE** | Pending |
| `services/auth.ts` | Add default tier/subscription fields, update lastSignedIn | Pending |
| `k8s/deployment.ts` | **NEW** (replaced bot-deployment.ts) — DeploymentConfig with runtime/image | ✅ Done |
| `k8s/bot-deployment.ts` | **DELETED** | ✅ Done |
| `index.ts` | Updated debug endpoint (bots→deployments) | ✅ Done |

**Frontend — Jarble-mvp/:**
| File | Action | Status |
|------|--------|--------|
| `app/d/[id]/configure/page.tsx` | **NEW** (replaced app/bot/[botId]/configure/) | ✅ Done |
| `app/onboarding/[id]/page.tsx` | **NEW** (replaced app/onboarding/[botId]/) | ✅ Done |
| `app/bot/` | **DELETED** (old route directory) | ✅ Done |
| `views/DeploymentConfiguration.tsx` | **NEW** (replaced BotConfiguration.tsx) | ✅ Done |
| `views/BotConfiguration.tsx` | **DELETED** | ✅ Done |
| `views/Dashboard.tsx` | Updated: trpc.deployment.*, DeploymentCard, /d/ routes | ✅ Done |
| `views/OnboardingWizard.tsx` | Updated: trpc.deployment.*, runtime selector | ✅ Done |
| `views/deployment-config/types.ts` | **NEW** (replaced bot-config/types.ts) — DeploymentFormData | ✅ Done |
| `views/deployment-config/GeneralTab.tsx` | **NEW** (replaced bot-config/) — deployment terminology | ✅ Done |
| `views/deployment-config/ModelTab.tsx` | **NEW** (replaced bot-config/) | ✅ Done |
| `views/deployment-config/PlatformsTab.tsx` | **NEW** (replaced bot-config/) | ✅ Done |
| `views/deployment-config/SkillsTab.tsx` | **NEW** (replaced bot-config/) | ✅ Done |
| `views/deployment-config/AdvancedTab.tsx` | **NEW** (replaced bot-config/) | ✅ Done |
| `views/bot-config/` | **DELETED** (old directory, 6 files) | ✅ Done |
| `lib/platformConfigs.ts` | Remove hardcoded configs, keep validation helpers | Pending |
| `components/TemplateSelector.tsx` | **DELETE** | Pending |

---

## Verification

1. **API starts cleanly:** `cd jarble-api-main && npm run dev` — no crashes, SQLite `deployments` table created with `runtime`/`image` columns, seed data inserted
2. **Debug endpoint:** `curl http://localhost:3001/debug/db` — returns `deployments` key with `runtime` field
3. **TypeScript compiles:** `npx tsc --noEmit` (API) and `pnpm run check` (MVP)
4. **Frontend loads:** Dashboard at `/dashboard`, new deployment at `/onboarding/new`, configure at `/d/{id}/configure`
5. **tRPC calls work:** `trpc.deployment.list`, `trpc.deployment.create`, etc. all resolve
6. **End-to-end:** Create deployment → appears on dashboard → configure → delete

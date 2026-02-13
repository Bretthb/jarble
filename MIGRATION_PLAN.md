# Plan: Migrate to Production 7-Table Schema (Full Stack)

## Context

The Jarble platform currently runs a simplified 3-table dev schema (users, bots, tiers). The user has defined the real production schema with 7 tables that properly models platform connections, usage tracking, bot task history, tier-based resource limits, and subscription management. This plan updates **both** the API (MySQL + SQLite schemas, tRPC routers, K8s deployment, auth) **and** the frontend (OnboardingWizard, Dashboard, BotConfiguration tabs) to match.

**Production architecture:**
- Vercel (Next.js) → HTTPS → Hetzner K3s (Express/tRPC API pod + Bot pods)
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
        subgraph Bots["Bot Pods"]
            Bot1["bot-001"]
            Bot2["bot-002"]
            Bot3["bot-003"]
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
    K8sClient -->|"Create/Delete/Status"| Bots
    Drizzle --> RDS
    TRPC --> Auth0
    TRPC --> OpenRouter
    TRPC --> Stripe
    Bots --> Longhorn
```

**Key decision:** Keep `id` as VARCHAR/TEXT (nanoid strings) for users and bots. The new schema spec says INT AUTO_INCREMENT, but the entire codebase uses string IDs. Changing to INT would cascade through every file. We keep string IDs.

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

### 2. bots
- id (PK, VARCHAR — nanoid string)
- userId (FK → users)
- name (VARCHAR 255)
- status (VARCHAR — "creating"/"deploying"/"running"/"restarting"/"error"/"deleted")
- errorMessage (TEXT)
- personality (TEXT) — generates SOUL.md
- model (VARCHAR 100) — OpenRouter model ID
- llmApiKey, llmApiKeyHash (VARCHAR 255) — per-bot OpenRouter key
- storagePath (VARCHAR 255) — Longhorn mount path /bots/{id}
- storageBytes (BIGINT) — current storage used
- storageUpdatedAt (TIMESTAMP)
- createdAt, updatedAt, deployedAt (TIMESTAMP)

### 3. tiers
- id (PK, INT auto-increment)
- name (VARCHAR — "free"/"pro"/"agency")
- displayName (VARCHAR 50)
- maxBots (INT)
- monthlyCredits (INT)
- maxStorageMb (INT) — per bot storage limit
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

### 5. botPlatforms
- id (PK, INT auto-increment)
- botId (FK → bots)
- platformId (FK → platforms)
- status (VARCHAR — "pending"/"connected"/"disconnected"/"error")
- config (JSON) — platform-specific settings
- errorMessage (TEXT)
- connectedAt, createdAt, updatedAt (TIMESTAMP)

### 6. usageRecords
- id (PK, INT auto-increment)
- botId (FK → bots)
- userId (FK → users)
- model (VARCHAR 100)
- inputTokens, outputTokens (INT)
- creditsUsed (INT)
- createdAt (TIMESTAMP)

### 7. botTasks
- id (PK, INT auto-increment)
- botId (FK → bots)
- podName (VARCHAR 255) — K3s pod name
- status (VARCHAR — "pending"/"running"/"stopped"/"failed")
- startedAt, stoppedAt (TIMESTAMP)
- stopReason (VARCHAR — "user-deleted"/"crashed"/"oom"/"timeout"/"scaling"/"unknown")
- exitCode (INT)
- createdAt (TIMESTAMP)

---

## Phase 1: MySQL Schema (`schema.ts`)

**File: `jarble-api-main/src/db/schema.ts`**

### 1a. Rewrite `users` table
- **Keep:** id (varchar PK), email, name, auth0Id, stripeCustomerId, createdAt, updatedAt
- **Add:** phoneNumber (varchar 20), tier (varchar — default "free"), subscriptionId (varchar 255), subscriptionStatus (varchar — default "none"), lastSignedIn (timestamp)

### 1b. Rewrite `bots` table
- **Keep:** id (varchar PK), userId (FK), name, status, createdAt, updatedAt
- **Remove:** description, template, tierId, error
- **Add:** errorMessage (text), personality (text), model (varchar 100), llmApiKey (varchar 255), llmApiKeyHash (varchar 255), storagePath (varchar 255), storageBytes (bigint default 0), storageUpdatedAt (timestamp), deployedAt (timestamp)

### 1c. Rewrite `tiers` table
- **Complete replacement.** Old: name/description/price/creditsPerMonth/features/isActive/createdAt
- **New:** name, displayName, maxBots, monthlyCredits, maxStorageMb, cpuLimit, memoryMb, priceMonthly (cents), stripePriceId

### 1d–1g. Add 4 new tables
- platforms, botPlatforms, usageRecords, botTasks (see schema above)

### 1h. Update relations
- users → many(bots, usageRecords)
- bots → one(users), many(botPlatforms, usageRecords, botTasks) — remove tier relation
- platforms → many(botPlatforms)
- botPlatforms → one(bots), one(platforms)
- usageRecords → one(bots), one(users)
- botTasks → one(bots)

---

## Phase 2: SQLite Schema (`schema.sqlite.ts`)

**File: `jarble-api-main/src/db/schema.sqlite.ts`**

Mirror every change from Phase 1 using SQLite equivalents:
- MySQL varchar/enum → SQLite `text()`
- MySQL timestamp → SQLite `text().$defaultFn(now)`
- MySQL json → SQLite `text()` (store as JSON string)
- MySQL bigint → SQLite `integer()`
- MySQL int auto → SQLite `integer().primaryKey({ autoIncrement: true })`

---

## Phase 3: DB Index + Init + Seed

### 3a. `db/index.ts` — expand `tables` export to include all 7 tables

### 3b. `db/init.ts` — rewrite CREATE TABLE SQL + seed data
- **Tiers (3):** free ($0, 1 bot, 1000 credits, 100MB, 0.25 CPU, 512MB), pro ($19, 5 bots, 10K credits, 500MB, 0.5 CPU, 1024MB), agency ($99, 50 bots, 100K credits, 2000MB, 1.0 CPU, 2048MB)
- **Platforms (5):** whatsapp, telegram, discord, slack, web — each with configSchema JSON
- **Test user:** tier "free", subscriptionStatus "none"
- **Test bot:** personality "A helpful assistant", model "anthropic/claude-sonnet-4"
- **Test botPlatform:** link test bot to whatsapp

---

## Phase 4: tRPC Router Updates

### 4a. `routers/user.ts` — switch to `tables` import, add phoneNumber field
### 4b. `routers/bot.ts` — update create/deploy/update/delete for new fields, add getTaskHistory
### 4c. `routers/tier.ts` — switch to `tables` import, update orderBy to priceMonthly
### 4d. NEW `routers/platform.ts` — list, getById
### 4e. NEW `routers/botPlatform.ts` — listByBot, connect, updateConfig, disconnect, updateStatus
### 4f. NEW `routers/usage.ts` — record, getByBot, getSummary
### 4g. `trpc/index.ts` — add 3 new routers, remove template router

---

## Phase 5: Auth Service Update (`services/auth.ts`)
- Add default tier/subscription fields when creating user
- Update lastSignedIn timestamp

## Phase 6: K8s Deployment Update (`k8s/bot-deployment.ts`)
- Update BotConfig interface (personality/model/llmApiKey instead of template)
- Use tier-based resource limits instead of hardcoded values
- Update Secret env vars

## Phase 7: Server Entry Point (`src/index.ts`)
- Update /debug/db to show all 7 tables

---

## Phase 8: Frontend Types
### 8a. `views/bot-config/types.ts` — Update BotFormData (personality/model/llmApiKey replace description/modelProvider/modelName/apiKey), remove PLATFORM_CONFIGS
### 8b. `lib/platformConfigs.ts` — Remove hardcoded configs, keep validation helpers

## Phase 9: Frontend Views
### 9a. `Dashboard.tsx` — Add new statuses, update BotCard (personality/model instead of template/description)
### 9b. `OnboardingWizard.tsx` — Major rewrite: Name+Personality → Model → Deploy → Connect Platform
### 9c. `BotConfiguration.tsx` — Update formData and handleSave for new fields
### 9d. `GeneralTab.tsx` — Description → Personality
### 9e. `ModelTab.tsx` — Single model selector using OpenRouter IDs
### 9f. `PlatformsTab.tsx` — Major refactor: API-driven via trpc.platform.list + trpc.botPlatform.*
### 9g. `AdvancedTab.tsx` — Add storage/deployment/task history sections
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
| File | Action |
|------|--------|
| `db/schema.ts` | Rewrite (3 tables → 7, column changes) |
| `db/schema.sqlite.ts` | Rewrite (mirror schema.ts) |
| `db/index.ts` | Update tables export (3 → 7 tables) |
| `db/init.ts` | Rewrite CREATE TABLE SQL + seed data |
| `trpc/index.ts` | Add 3 new routers, remove template |
| `trpc/routers/bot.ts` | Update create/deploy/update/delete, add getTaskHistory |
| `trpc/routers/user.ts` | Switch to tables import, add fields |
| `trpc/routers/tier.ts` | Switch to tables import, update orderBy, add getByName |
| `trpc/routers/platform.ts` | **NEW** — platform CRUD |
| `trpc/routers/botPlatform.ts` | **NEW** — bot-platform connections |
| `trpc/routers/usage.ts` | **NEW** — usage tracking |
| `trpc/routers/template.ts` | **DELETE** |
| `services/auth.ts` | Add default tier/subscription fields, update lastSignedIn |
| `k8s/bot-deployment.ts` | Update BotConfig interface, env vars, resource limits |
| `index.ts` | Update debug endpoint for 7 tables |

**Frontend — Jarble-mvp/:**
| File | Action |
|------|--------|
| `views/bot-config/types.ts` | Update BotFormData, remove PLATFORM_CONFIGS |
| `views/Dashboard.tsx` | Update BotCard props, add statuses |
| `views/OnboardingWizard.tsx` | Major rewrite — new 4-step flow |
| `views/BotConfiguration.tsx` | Update formData, handleSave |
| `views/bot-config/GeneralTab.tsx` | Description → Personality |
| `views/bot-config/ModelTab.tsx` | Simplify to single model selector |
| `views/bot-config/PlatformsTab.tsx` | Major refactor — API-driven |
| `views/bot-config/AdvancedTab.tsx` | Add storage/deployment/task sections |
| `lib/platformConfigs.ts` | Remove hardcoded configs, keep validation helpers |
| `components/TemplateSelector.tsx` | **DELETE** |

---

## Verification

1. **API starts cleanly:** `cd jarble-api-main && npm run dev` — no crashes, 7 SQLite tables created, seed data inserted
2. **Debug endpoint:** `curl http://localhost:3001/debug/db` — returns all 7 tables
3. **TypeScript compiles:** `npx tsc --noEmit` (API) and `pnpm run check` (MVP)
4. **Frontend loads:** Dashboard shows personality/model, OnboardingWizard has new flow, BotConfig tabs work
5. **End-to-end:** Create bot → appears on dashboard → configure → connect platform → delete (cascades)

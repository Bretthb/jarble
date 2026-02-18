# Jarble Platform — Critical TODOs

## Completed

### Bidirectional Config Sync ✅
- [x] DB → Container (syncConfigsToPvc): Renders runtime-specific config files and writes to PVC
- [x] Container → DB (syncConfigsFromPvc): Webhook endpoint `/api/config-changed` for reverse sync
- [x] Platform credentials sync: platformCredentials table with AES-256-GCM encryption
- [x] OpenClaw: soul.md + openclaw.json rendering
- [x] ZeroClaw: config.toml rendering
- [x] K8s Secret injection for LLM keys and platform tokens

### Runtime-Aware Architecture ✅
- [x] RuntimeHandler interface with strategy pattern (`src/runtimes/types.ts`)
- [x] Runtime registry with automatic handler discovery (`src/runtimes/index.ts`)
- [x] OpenClaw handler: soul.md, openclaw.json, platform credentials mapping
- [x] ZeroClaw handler: config.toml with env var injection
- [x] Frontend wizard steps per runtime (`wizardStepConfig.ts`)
- [x] Frontend config tabs per runtime (`getConfigTabs()`)

### Stripe Subscription → Deployment Sync ✅
- [x] Webhook handlers: checkout.session.completed, subscription.updated/deleted, invoice.payment_failed
- [x] subscriptionEnforcement.ts: Periodic subscription validation (every 5 min)
- [x] Free trial expiration enforcement (freeExpiresAt)
- [x] Cancel-at-period-end enforcement
- [x] Orphaned deployment cleanup (every 30 min)
- [x] Webhook idempotency via processedWebhookEvents table

### Stop/Start Bot Functionality ✅
- [x] Scale K8s deployment replicas to 0 (stop) or 1 (start)
- [x] DB status sync on stop/start/restart
- [x] Frontend Pause/Activate buttons wired

### WhatsApp QR Integration ✅
- [x] SSE endpoint `/api/deployments/:id/whatsapp/qr`
- [x] QR code streaming via K8s exec
- [x] Session state stored on PVC (Baileys handles this)
- [x] Connection status surfaced to frontend

### Platform Credentials Storage ✅
- [x] platformCredentials table with encrypted JSON blob
- [x] 7 platforms supported: Discord, Telegram, Slack, WhatsApp, Web, Teams, Messenger
- [x] CRUD operations with auto-sync to PVC
- [x] Masked credentials for safe frontend display

### Mock K8s Mode ✅
- [x] MOCK_K8S=true environment variable
- [x] In-memory PVC file storage simulation
- [x] Debug endpoints: /debug/mock-pvc, /debug/db
- [x] Full config sync testing without real cluster

### Storage Enforcement ✅
- [x] storageEnforcement.ts: Periodic storage limit checks (every 5 min)
- [x] Stop deployments exceeding storage quota
- [x] Clear errors when usage drops below limit

---

## Remaining Work

### 1. Reverse Sync Enhancement (Nice to Have)
- [ ] parseConfigs() for openclaw.json channels → Extract platform credentials back to DB
- [ ] Currently only soul.md is reverse-synced; openclaw.json channels are write-only

### 2. Skills Marketplace (Future Feature)
- [ ] DB table for skills definitions
- [ ] skills/* file sync in OpenClaw handler (currently commented out)
- [ ] Skills tab UI in frontend
- [ ] Skills marketplace / import from community

### 3. Platform Connection Testing (Enhancement)
- [ ] testConnection() actually validates with platform APIs
- [ ] Discord: GET /users/@me with bot token
- [ ] Slack: auth.test with bot token
- [ ] Telegram: getMe with bot token

### 4. Drizzle Migrations
- [ ] Regenerate migrations after all schema changes
- [ ] Test against MySQL and PostgreSQL in staging
- [ ] Add processedWebhookEvents table migration

### 5. Production Deployment
- [ ] Merge feature branch to main
- [ ] Deploy to Hetzner K3s cluster
- [ ] Verify Stripe webhooks in production
- [ ] Monitor subscription enforcement logs

---

## Architecture Decisions (Locked In)

- One base Docker image per runtime on **public GHCR** (`ghcr.io/jarble-ai/openclaw:latest`)
- Hardware specs (CPU, memory, storage) enforced at **K8s level**, not Docker image level
- All behavioral config via **PVC-mounted files** (soul.md, openclaw.json for OpenClaw)
- **DB is source of truth**, PVC files are rendered outputs
- OpenRouter handles token limits via **credit system** (no maxTokens needed)
- `storageMb` column is actually **GB** (historical naming — documented throughout)
- Frontend config tabs are **dynamic per runtime** via `getConfigTabs(runtimeSlug)`
- **Strategy pattern** for runtime handlers — add new runtimes in 2-3 files only

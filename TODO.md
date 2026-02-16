# Jarble Platform — Critical TODOs

## 1. Bidirectional Config Sync (CRITICAL)

### DB → Container (on frontend save)
- When user saves config on frontend, render runtime-specific config files and write to PVC
- For OpenClaw: **multiple config files** on PVC (not just soul.md):
  - `soul.md` — system prompt / personality
  - Skills config (TBD)
  - Platform configs (TBD)
  - Possibly more — full file structure TBD once OpenClaw internals are mapped
- Restart pod to pick up new config
- Inject LLM API key + provider into K8s Secret on update

### Container → DB (reverse sync / drift detection)
- Detect changes made inside the container (manual edits to soul.md, runtime self-modification)
- Compare container config files with DB version, update DB if changed
- Frontend reflects changes on next query
- Must watch **all** config files, not just soul.md (skills, platforms, etc.)
- **Option A (interim):** Polling via K8s exec — API periodically reads config files from pod, compares hash with DB
- **Option B (long-term):** File watcher webhook in base image — container watches `/data/` config files, POSTs to Jarble API on change

### Platform credentials sync
- WhatsApp/Discord/Slack/Telegram connections configured inside the container need to surface back to frontend
- DB columns needed for platform tokens
- Bidirectional: frontend can set tokens, container can report connected platforms

## 2. Runtime-Aware Architecture

All config sync logic MUST be gated by runtime slug. Use a strategy/registry pattern:

```
runtimeConfigs = {
  openclaw: { configFiles: ["soul.md", "skills/*", "platforms/*", ...TBD], renderer: openclawRenderer, tabs: ["general","model","platforms","skills","advanced"] },
  zeroclaw: { configFile: "config.yaml", renderer: zeroclawRenderer, tabs: ["general","advanced"] },
  // future non-bot runtimes define their own or skip config sync
}
```

### Runtime-Agnostic (works for ALL deployments)
- Storage monitoring (df /data) — DONE
- Hardware specs (CPU, memory, storage) — DONE
- Deployment CRUD (create, delete, status) — DONE
- PVC + Secret + K8s Deployment creation — DONE
- Stop/Start/Restart functionality
- Deployment logs viewer
- General settings (name, description)
- Billing/pricing tier

### OpenClaw-Specific (gated by runtime slug)
- soul.md config sync (system prompt → file on PVC)
- LLM provider/model/API key injection
- System prompt
- Platform credentials (WhatsApp, Discord, Slack, Telegram)
- Skills marketplace
- Model tab, Platforms tab, Skills tab in frontend config

## 3. Stripe Subscription → Deployment Sync
- Link Stripe subscription status to deployment lifecycle
- Handle payment failures, upgrades, downgrades
- Enforce free trial expiration

## 4. Stop/Start Bot Functionality
- Scale K8s deployment replicas to 0 (stop) or 1 (start)
- Update DB status accordingly
- Wire to frontend Pause/Activate buttons (already in sidebar)

## 5. WhatsApp QR Integration
- QR code flow for WhatsApp connection
- Store session state on PVC
- Surface connection status to frontend

## 6. Platform Credentials Storage
- Add DB columns for Discord token, Slack token, Telegram token, WhatsApp session
- Wire to Platforms tab in frontend config
- Encrypt at rest

## 7. Drizzle Migrations Regeneration
- Regenerate migrations after all schema changes (systemPrompt, future platform columns)
- Test against MySQL and PostgreSQL

---

## Architecture Decisions (Locked In)
- One base Docker image per runtime on **public GHCR** (`ghcr.io/jarble-ai/openclaw:latest`)
- Hardware specs (CPU, memory, storage) enforced at **K8s level**, not Docker image level
- All behavioral config via **PVC-mounted files** (multiple config files for OpenClaw: soul.md, skills, platforms, + others TBD)
- **DB is source of truth**, PVC files are rendered outputs
- OpenRouter handles token limits via **credit system** (no maxTokens needed)
- `storageMb` column is actually **GB** (historical naming — documented throughout)
- Frontend config tabs are **dynamic per runtime** via `getConfigTabs(runtimeSlug)`

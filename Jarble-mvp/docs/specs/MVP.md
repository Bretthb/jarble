# MVP - Phase 1

> **Goal:** Ship a working MVP that lets users create and deploy a bot.
> **Focus:** Fix frontend first, then connect backend, then deploy infrastructure.

---

## MVP Scope

### ✅ What's IN the MVP
- Auth0 login (Google/GitHub/Email)
- 4-step onboarding (Name → Template → Deploy → Connect WhatsApp)
- Dashboard with bot list
- Bot configuration (basic settings)
- **WhatsApp** platform support (QR code scan - simplest)
- **OpenRouter per-bot API keys** (Jarble-managed, usage tracking)
- Jarble Default template
- Free tier only (no payments yet)
- Single AWS region (us-east-1)
- **RDS MySQL** database (already running)
- **Basic memory** (context window only)

### ❌ What's OUT of MVP (Phase 2+)
- Stripe billing/payments
- Multiple tiers
- BYOK (Bring Your Own Keys) - paid users only
- Discord/Slack/Telegram platforms
- Supermemory (enhanced memory) - V2
- LiteLLM (direct to providers) - V3
- Context Store (knowledge packs) - V3
- Personality sync
- Advanced settings
- Usage metering dashboard
- Multi-region
- Team management

---

## Phase 1A: Fix Frontend (Week 1)

Clean up the existing frontend, simplify onboarding, remove unused code.

### ⚠️ CRITICAL: Keep Existing Theme

**DO NOT change the visual design.** The theme from `development` branch stays exactly as-is:
- Same colors, fonts, spacing
- Same Tailwind config
- Same globals.css
- Same UI components (shadcn/ui)

Only change **logic and structure**, not **appearance**.

### 🗑️ Delete (cleanup)
- [ ] `ForgotPassword.tsx` — Auth0 handles this
- [ ] `ComponentShowcase.tsx` — Dev tool only
- [ ] `GuidedTour.tsx` — Over-engineered (1348 lines)
- [ ] `Map.tsx` — Unused
- [ ] `AIChatBox.tsx` — Not MVP scope

### ✏️ Simplify Onboarding (8 → 4 steps)
- [x] Rewrite `OnboardingWizard.tsx` with 4 steps
- [x] Step 1: Name your bot (just input field)
- [x] Step 2: Choose template (Jarble Default only for MVP)
- [x] Step 3: Deploy (progress bar)
- [x] Step 4: Connect WhatsApp (QR code scan)

### 🎨 Dashboard Polish
- [ ] Clean up `Dashboard.tsx` — remove mock data logic
- [ ] Add empty state for new users
- [ ] Simplify bot cards (status, platform, name only)

### 🔐 Auth0 Integration
- [ ] Install `@auth0/auth0-react`
- [ ] Create `Auth0Provider` component
- [ ] Update `Login.tsx` to use Auth0
- [ ] Delete `Register.tsx` (Auth0 handles)
- [ ] Remove all `DEV_MODE` checks

---

## Phase 1B: Connect Backend (Week 2)

Wire up Auth0 JWT validation and basic bot CRUD.

### 🔐 Auth0 Backend
- [ ] Install `jose` package for JWT validation
- [ ] Create `server/_core/auth0.ts` with `verifyAuth0Token()`
- [ ] Update tRPC context to validate JWT
- [ ] Add `getOrCreateUser()` — sync Auth0 user to DB

### 🤖 Bot CRUD
- [ ] Verify `bot.create` works with real data
- [ ] Verify `bot.list` returns user's bots
- [ ] Verify `bot.update` saves changes
- [ ] Add `bot.delete` endpoint

### 💾 Database
- [x] Set up RDS MySQL database (jarble-db.c29u0wqwgy3p.us-east-1.rds.amazonaws.com)
- [x] Run `drizzle-kit push` (schema synced)
- [x] Seed `tiers` table (Free tier)
- [x] Seed `platforms` table (WhatsApp)
- [x] Seed `modelProviders` table (OpenRouter, OpenAI, Anthropic)

---

## Phase 1C: Deploy Infrastructure (Week 3)

Set up AWS and deploy first bot.

### ☁️ AWS Setup (EC2 + Docker)
- [ ] Launch t3.medium EC2 instance
- [ ] Install Docker + docker-compose
- [ ] Configure security group (outbound 443 for WhatsApp/OpenRouter)
- [ ] Create `/data/bots/` persistent storage directory
- [ ] Create S3 bucket for templates (`jarble-skill-templates`)
- [ ] Upload Jarble Default template to S3
- [ ] Store OpenRouter key in Secrets Manager

### 🐳 Bot Deployment Scripts
- [ ] Create `deploy-bot.sh` script (adds bot to docker-compose)
- [ ] Create `remove-bot.sh` script (stops + removes container)
- [ ] Create base `docker-compose.yml` with resource limits
- [ ] Test end-to-end: onboarding → bot deployed → responds in Telegram

---

## ✅ MVP Success Criteria

MVP is complete when a user can:

1. Sign up with Auth0 (Google/GitHub/Email)
2. Create a bot with 4-step wizard
3. Deploy bot to AWS
4. Connect WhatsApp via QR code scan
5. Bot responds in WhatsApp
6. See bot in dashboard

---

## 🗺️ Path to Full Platform Spec

After MVP, build out remaining features in phases:

### Phase 2: Payments
- Stripe integration
- Tier selection (Starter/Pro/Business)
- Usage metering

### Phase 3: More Platforms
- Discord support
- Slack support
- WhatsApp support

### Phase 4: Advanced Features
- Personality sync
- Advanced settings
- Custom templates

### Phase 5: Scale
- AWS Organizations (isolated accounts)
- Multi-region
- Team management

---

*Each phase builds on the previous. MVP is the foundation — get it working first, then expand.*

---

## 🤖 Agent Build Plan

### Workflow

```
Human updates jarble/development
        │
        ▼
Technical Architect receives task
        │
        ▼
Spawns Agent (Frontend/Backend/Infra)
        │
        ▼
Agent reads specs (MVP.md + AGENT.md)
        │
        ▼
Agent creates feature branch
        │
        ▼
Agent implements changes
        │
        ▼
Agent creates PR + handoff
        │
        ▼
Human reviews & merges
        │
        ▼
Next agent continues
```

### Agent Assignments

#### 🎨 Frontend Agent — Phase 1A
- Delete unused files (ForgotPassword, ComponentShowcase, GuidedTour, Map, AIChatBox)
- Rewrite OnboardingWizard.tsx → 4 steps
- Create Auth0Provider component
- Update Login.tsx for Auth0
- Remove DEV_MODE checks
- Polish Dashboard.tsx

#### ⚙️ Backend Agent — Phase 1B
- Install jose, @auth0/auth0-react
- Create server/_core/auth0.ts
- Update tRPC context for JWT validation
- Add getOrCreateUser() function
- Verify/fix bot CRUD endpoints
- Seed database (tiers, platforms)
- **Set up OpenRouter integration (Jarble-managed key)**
- Store OpenRouter API key in environment/secrets
- Configure bot provisioning to use shared OpenRouter key

#### 🏗️ Infra Agent — Phase 1C
- Create S3 bucket + upload Jarble Default template
- Create ECR repo + push bot image
- Create SQS queue
- Write minimal Terraform (ECS + EBS)
- Deploy first bot

### Spawning an Agent

**Important:** Agents read MVP.md for SCOPE and their agent spec for HOW.

```markdown
You are the [Agent Name] for Jarble MVP.

Read these files IN ORDER:
1. /jarble-specs/MVP.md — Your SCOPE (only do what's listed here)
2. /jarble-specs/agents/[AGENT]_AGENT.md — Your HOW (methods & patterns)

CRITICAL: Only implement tasks listed in MVP.md Phase 1A/1B/1C.
Ignore anything marked "Phase 2+" in the agent spec.

Your task: [Specific Phase 1 task]
Branch: mvp/[feature-name]
Work in: /home/ubuntu/jarble (development branch)
```

**Example - Frontend Agent:**
```markdown
You are the Frontend Agent for Jarble MVP.

Read these files:
1. /jarble-specs/MVP.md — SCOPE
2. /jarble-specs/agents/FRONTEND_AGENT.md — HOW
3. /jarble-specs/FRONTEND_ARCHITECTURE.md — File decisions

Task: Phase 1A cleanup
- Delete: ForgotPassword, ComponentShowcase, GuidedTour, Map, AIChatBox
- Simplify OnboardingWizard to 4 steps
Branch: mvp/frontend-cleanup
```

**Example - Infra Agent:**
```markdown
You are the Infra Agent for Jarble MVP.

Read these files:
1. /jarble-specs/MVP.md — SCOPE (see "☁️ MVP AWS Structure" section)
2. /jarble-specs/agents/INFRA_AGENT.md — HOW

Task: Phase 1C - AWS setup (EC2 + Docker)
- Launch EC2 instance with Docker installed
- Create S3 bucket, Secrets Manager secret
- Write deploy-bot.sh and docker-compose.yml with resource limits
- Test bot deployment end-to-end
Branch: mvp/infra-setup
```

---

## ⚠️ Platform: WhatsApp (QR Code)

MVP uses **WhatsApp** — simplest onboarding:
- Just scan a QR code with your phone
- No tokens, no bot registration
- OpenClaw supports WhatsApp natively via Baileys

Step 4 of onboarding: "Scan QR code with WhatsApp"

---

## ☁️ MVP AWS Structure (Simplified - EC2 + Docker)

> **Architecture Pivot:** Per AWS advisor, we're using shared EC2 + Docker instead of Fargate/Organizations. Much cheaper for startup stage (~$30-50/mo vs ~$500/mo).

```
SINGLE AWS ACCOUNT (jarble-prod)
├── EC2 Instance (t3.medium, ~$30/mo)
│   ├── Docker Engine
│   ├── docker-compose.yml (all bots)
│   └── /data/bots/{bot_id}/ (persistent volumes)
│
├── RDS MySQL (Aurora, existing)
│   └── jarble database
│
├── S3: jarble-skill-templates
└── Secrets Manager: OpenRouter key
```

### Container Resource Management

**Fair compute allocation across bots on shared EC2:**

```yaml
# docker-compose.yml - per bot service
services:
  bot-{uuid}:
    image: jarble-bot:latest
    deploy:
      resources:
        limits:
          cpus: '0.5'        # Hard ceiling: 50% of one core
          memory: 512M       # Hard ceiling: 512MB RAM
        reservations:
          cpus: '0.25'       # Guaranteed minimum
          memory: 256M       # Guaranteed minimum
    environment:
      - BOT_ID=${BOT_ID}
      - OPENROUTER_API_KEY=${BOT_LLM_API_KEY}
    volumes:
      - /data/bots/${BOT_ID}:/app/data
    restart: unless-stopped
```

**Resource defaults by tier (future):**

| Tier | CPU Limit | Memory | CPU Reserved |
|------|-----------|--------|--------------|
| Free | 0.25 | 256MB | 0.1 |
| Starter | 0.5 | 512MB | 0.25 |
| Pro | 1.0 | 1GB | 0.5 |

**Monitoring & scaling signals:**
- `docker stats` for real-time usage
- Alert when avg CPU > 70% sustained
- Scale trigger: spin up 2nd EC2 when hitting 15-20 bots

### Conversation Persistence (File-Based)

Bot memory uses OpenClaw's native file-based storage. Each bot gets a workspace directory:

```
/data/bots/
├── abc-123/
│   ├── MEMORY.md           # Long-term memory
│   ├── SOUL.md             # Personality (copied from template)
│   ├── memory/
│   │   └── 2026-02-11.md   # Daily conversation logs
│   └── .openclaw/
│       └── sessions.db     # Session state
├── def-456/
│   └── ...
```

**What lives where:**

| Data | Location | Why |
|------|----------|-----|
| Bot config (name, tier, platforms) | RDS `bots` table | Shared across dashboard + bot |
| Credentials (Telegram token) | RDS `botPlatformConnections` | Encrypted, managed via UI |
| Conversation memory | `/data/bots/{id}/` volume | OpenClaw native, no schema changes |
| Usage/billing | RDS `usageRecords` | Analytics, billing |

**Backup strategy:**
- Daily: `aws s3 sync /data/bots/ s3://jarble-bot-data/`
- Before EC2 maintenance: snapshot EBS volume

**V2 upgrade path:** Add `conversations` table for search/export features without touching file storage.

### Scaling Path

```
MVP (now)           → Scale (50+ bots)      → Enterprise (V2)
─────────────────────────────────────────────────────────────
Single EC2          → Multiple EC2s         → ECS Fargate
Docker Compose      → Docker Swarm          → Per-tenant accounts
~$30/mo fixed       → ~$30/mo per node      → AWS Organizations
```

### Setup Steps

**Step 1: Launch EC2**
```bash
# t3.medium in us-east-1 (~$30/mo)
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \  # Amazon Linux 2
  --instance-type t3.medium \
  --key-name jarble-key \
  --security-group-ids sg-xxxx \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=jarble-bots}]'
```

**Step 2: Install Docker on EC2**
```bash
sudo yum update -y
sudo yum install docker -y
sudo systemctl start docker
sudo usermod -aG docker ec2-user
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

**Step 3: Create Shared Resources**
```bash
# S3 for templates
aws s3 mb s3://jarble-skill-templates --region us-east-1

# Store OpenRouter key
aws secretsmanager create-secret \
  --name jarble/openrouter-api-key \
  --secret-string "sk-or-your-key-here" \
  --region us-east-1
```

**Step 4: Deploy a Bot**
```bash
# On EC2 instance
mkdir -p /data/bots/{bot-uuid}

# Add to docker-compose.yml
docker-compose up -d bot-{uuid}
```

### MVP vs Full (How It Scales)

| MVP | Scale | Enterprise (V2) |
|-----|-------|-----------------|
| Single EC2 | Multiple EC2s + load balancer | ECS Fargate |
| docker-compose | Docker Swarm or manual | Per-tenant AWS accounts |
| SSH deploy | CI/CD pipeline | AWS Organizations |
| ~10-20 bots | ~50-100 bots | Unlimited |

### Test Checklist

- [ ] EC2 instance running with Docker
- [ ] Security group allows 443 outbound (WhatsApp/OpenRouter APIs)
- [ ] `/data/bots/` directory created
- [ ] docker-compose.yml with resource limits
- [ ] Test bot container starts
- [ ] WhatsApp QR code displays
- [ ] Bot responds in WhatsApp
- [ ] `docker stats` shows resource usage

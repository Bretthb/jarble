# ⚙️ Backend Agent

> **Mission:** Build the API, database, and business logic for Jarble
> **Workspace:** `/jarble/` (monorepo - backend in `server/`)
> **Platform Spec:** See `JARBLE_PLATFORM_SPEC.md` for full context

---

## Identity

| Field | Value |
|-------|-------|
| **Name** | Backend Agent |
| **Role** | Backend Engineer |
| **Emoji** | ⚙️ |
| **Primary Language** | TypeScript (Node.js) |

---

## Context Summary

You're building the backend for **Jarble** — a managed AI bot hosting platform. Key integrations:

- **Auth0** — User authentication (JWT validation, webhooks)
- **Stripe** — Subscriptions + usage metering (30% LLM markup)
- **OpenRouter** — LLM key provisioning + usage tracking
- **MySQL** — Users, bots, billing data (RDS Aurora)

> **MVP Architecture Note:** We use EC2 + Docker for bot hosting (not Fargate/Organizations).
> Bot deployment is via SSH/SSM to EC2, not SQS + Lambda.
> See `MVP.md` for current architecture details.

---

## ⚠️ CRITICAL: Existing Codebase

**The backend already exists. You MUST work WITH it, not replace it.**

### Current Architecture (Already Built)

```
/jarble/
├── server/
│   ├── routers.ts         # tRPC router definitions
│   ├── db.ts              # Drizzle queries
│   ├── _core/
│   │   ├── trpc.ts        # tRPC setup
│   │   ├── context.ts     # Request context
│   │   └── sdk.ts         # Auth utilities
│   └── storage.ts         # File storage
├── drizzle/
│   ├── schema.ts          # Database schema
│   └── relations.ts       # Table relations
├── lib/
│   └── trpc.ts            # Client-side tRPC
└── app/api/trpc/[trpc]/route.ts  # tRPC HTTP handler
```

### First Steps (Before Writing ANY Code)

```bash
# 1. Understand existing structure
cat /jarble/server/routers.ts
cat /jarble/drizzle/schema.ts
cat /jarble/server/db.ts

# 2. Check existing endpoints
grep -r "procedure" server/routers.ts

# 3. Review database functions
grep -r "export.*function\|export.*async" server/db.ts
```

---

## Tech Stack (ACTUAL)

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20+ (TypeScript) |
| Framework | **Next.js API Routes + tRPC** |
| Database | **MySQL** (PlanetScale/RDS) |
| ORM | **Drizzle ORM** |
| API Layer | **tRPC v10** |
| Auth | Auth0 JWT (to be integrated) |
| Payments | Stripe SDK |
| LLM | OpenRouter API |
| Queue | AWS SQS |
| Validation | Zod (built into tRPC) |
| Testing | Vitest |

---

## Required Skills

```yaml
Core:
  - github: Commit code, create PRs
  - exec: Run pnpm, drizzle-kit, tests
  - read/write/edit: Code files
  - web_fetch: Test endpoints, external docs

Knowledge:
  - tRPC: Routers, procedures, middleware, context
  - Drizzle ORM: Schema, queries, migrations
  - MySQL: Types, indexes, JSON columns
  - Next.js: API routes, middleware
  - Auth0: JWT validation, JWKS
  - Stripe: Customers, subscriptions, webhooks, metering
  - OpenRouter: API keys, usage tracking
  - AWS SDK: SQS, Secrets Manager
  - Zod: Schema validation (tRPC uses this)
```

---

## Existing Schema (drizzle/schema.ts) — development branch

```typescript
// Tables in development branch
users                   // id, openId, name, email, phone, firstName, lastName, role
tiers                   // id, name (bronze/silver/gold/platinum), displayName, price, limits
bots                    // id, userId, name, tierId, status, modelProvider, platforms (JSON), skills (JSON)
modelProviders          // id, name, displayName, description, requiresApiKey
platforms               // id, name, displayName, description, requiresConfig
botPlatformConnections  // id, botId, platformId, status, config (JSON)
botSkills               // id, botId, skillId, skillName, enabled
onboardingProgress      // id, userId, botId, currentStep, completedSteps (JSON), stepData (JSON)
```

**NOT in development yet (need to add):**
- Stripe fields on users (stripeCustomerId, subscriptionId, tier)
- AWS provisioning fields on bots (awsAccountId, awsStatus)
- usageRecords table
- provisioningJobs table

See `drizzle/schema.ts` for full definitions.

---

## Existing tRPC Routers (server/routers.ts)

```typescript
// Already implemented
auth.me              // Get current user
auth.logout          // Clear session
user.getProfile      // User profile
user.updateProfile   // Update profile
tier.list            // List tiers
tier.getById         // Get tier
modelProvider.list   // List providers
modelProvider.validateApiKey  // Validate BYOK key
platform.list        // List platforms
bot.create           // Create bot
bot.list             // List user's bots
bot.getById          // Get bot details
bot.update           // Update bot config
bot.deploy           // Deploy bot
onboarding.*         // Progress tracking
skills.search        // Search ClawdHub (placeholder)
```

---

## Deliverables (What's Missing)

### Phase 1: Auth0 Integration

#### 1.1 JWT Validation Middleware

```typescript
// server/_core/auth0.ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL(`https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`)
);

export async function verifyAuth0Token(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://${process.env.AUTH0_DOMAIN}/`,
    audience: process.env.AUTH0_AUDIENCE,
  });
  return payload;
}
```

#### 1.2 Update tRPC Context

```typescript
// server/_core/context.ts - update to use Auth0
export async function createContext({ req }: { req: Request }) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { user: null };
  }
  
  const token = authHeader.slice(7);
  const payload = await verifyAuth0Token(token);
  
  // Get or create user in DB
  const user = await getOrCreateUser(payload.sub, payload.email);
  return { user };
}
```

### Phase 2: Stripe Integration

#### 2.1 Add to Routers

```typescript
// server/routers.ts - add billing router
billing: router({
  // Create checkout session
  createCheckout: protectedProcedure
    .input(z.object({ tierId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const tier = await getTierById(input.tierId);
      const session = await stripe.checkout.sessions.create({
        customer: ctx.user.stripeCustomerId || undefined,
        customer_email: !ctx.user.stripeCustomerId ? ctx.user.email : undefined,
        line_items: [{ price: tier.stripePriceId, quantity: 1 }],
        mode: 'subscription',
        success_url: `${process.env.APP_URL}/dashboard?checkout=success`,
        cancel_url: `${process.env.APP_URL}/pricing?checkout=cancelled`,
        metadata: { userId: ctx.user.id.toString(), tierId: input.tierId.toString() }
      });
      return { url: session.url };
    }),
    
  // Get billing portal URL
  getPortalUrl: protectedProcedure.mutation(async ({ ctx }) => {
    const session = await stripe.billingPortal.sessions.create({
      customer: ctx.user.stripeCustomerId!,
      return_url: `${process.env.APP_URL}/dashboard`,
    });
    return { url: session.url };
  }),
  
  // Get usage summary
  getUsage: protectedProcedure.query(async ({ ctx }) => {
    return getUsageSummary(ctx.user.id);
  }),
})
```

#### 2.2 Stripe Webhook Handler

```typescript
// app/api/webhooks/stripe/route.ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature')!;
  
  const event = stripe.webhooks.constructEvent(
    body, sig, process.env.STRIPE_WEBHOOK_SECRET!
  );
  
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutComplete(event.data.object);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdate(event.data.object);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionCancelled(event.data.object);
      break;
    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object);
      break;
  }
  
  return new Response('ok');
}
```

### Phase 3: Bot Provisioning (MVP)

> **MVP:** Direct SSH/SSM deployment to EC2 (no SQS/Lambda)
> **V2:** SQS + Lambda for async provisioning at scale

#### 3.1 Direct Deployment (MVP)

```typescript
// server/provisioning/deploy.ts
import { NodeSSH } from 'node-ssh';

const ssh = new NodeSSH();

export async function deployBot(botId: number, tier: string) {
  // Update status
  await updateBot(botId, { status: 'provisioning' });
  
  try {
    // SSH to EC2
    await ssh.connect({
      host: process.env.EC2_HOST,
      username: 'ec2-user',
      privateKey: process.env.EC2_SSH_KEY,
    });

    // Run deploy script (WhatsApp session established via QR during onboarding)
    const result = await ssh.execCommand(
      `./scripts/deploy-bot.sh ${botId} ${tier}`
    );
    
    if (result.code !== 0) {
      throw new Error(result.stderr);
    }
    
    // Update status
    await updateBot(botId, { 
      status: 'active',
      deployedAt: new Date(),
      hostInstance: process.env.EC2_HOST,
    });
    
    return { success: true };
  } catch (error) {
    await updateBot(botId, { status: 'error' });
    throw error;
  } finally {
    ssh.dispose();
  }
}
```

**Alternative: AWS SSM (no SSH keys needed)**
```typescript
import { SSMClient, SendCommandCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({ region: 'us-east-1' });

export async function deployBotSSM(botId: number, tier: string) {
  await ssm.send(new SendCommandCommand({
    InstanceIds: [process.env.EC2_INSTANCE_ID],
    DocumentName: 'AWS-RunShellScript',
    Parameters: {
      commands: [`./scripts/deploy-bot.sh ${botId} ${tier}`]
    }
  }));
}
```

#### 3.2 Status Polling Endpoint

```typescript
// Add to bot router
getProvisioningStatus: protectedProcedure
  .input(z.number())
  .query(async ({ ctx, input }) => {
    const job = await getLatestProvisioningJob(input);
    return {
      status: job?.status || 'unknown',
      progress: job?.progress || 0,
      currentStep: job?.currentStep,
      error: job?.errorMessage,
    };
  }),
```

### Phase 4: LLM Billing

#### 4.1 Usage Tracking

```typescript
// server/billing/llm-billing.ts
const MARKUP = 0.30; // 30%

export async function recordLLMUsage(botId: number, usage: {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number; // from OpenRouter
}) {
  const billedCost = usage.cost * (1 + MARKUP);
  
  await db.insert(usageRecords).values({
    botId,
    userId: (await getBotById(botId))!.userId,
    provider: usage.provider,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cost: Math.round(billedCost * 100), // Store as cents
  });
}
```

---

## Database Operations (server/db.ts)

### Functions to Add

```typescript
// Stripe-related
export async function updateUserStripe(userId: number, data: {
  stripeCustomerId?: string;
  subscriptionId?: string;
  subscriptionStatus?: string;
  tier?: string;
}) { ... }

// Usage tracking
export async function getUsageSummary(userId: number) { ... }
export async function recordUsage(data: InsertUsageRecord) { ... }

// Provisioning
export async function createProvisioningJob(botId: number, config: any) { ... }
export async function updateProvisioningJob(jobId: number, data: any) { ... }
export async function getLatestProvisioningJob(botId: number) { ... }
```

---

## Phase 5: Dynamic Personality Sync

Bots learn and mirror user communication style. See `/jarble-specs/features/PERSONALITY_SYNC.md` for full spec.

### 5.1 Schema Additions

```typescript
// drizzle/schema.ts - add to bots table
personalitySyncEnabled: boolean('personality_sync_enabled').default(true),
personalitySyncThreshold: int('personality_sync_threshold').default(50), // messages between updates
```

### 5.2 SOUL.md Template Enforcement

```typescript
// server/personality/enforcement.ts
const LOCKED_HASH = "sha256:...";  // Known good hash of locked section

export async function enforceSoulIntegrity(botId: string) {
  const soulContent = await getBotFile(botId, 'SOUL.md');
  const lockedSection = extractLockedSection(soulContent);
  const currentHash = sha256(lockedSection);
  
  if (currentHash !== LOCKED_HASH) {
    // Restore from S3 template
    const template = await s3.getObject('jarble-skill-templates', 'core/SOUL_LOCKED.md');
    const restored = replaceLockedSection(soulContent, template);
    await updateBotFile(botId, 'SOUL.md', restored);
    await logIntegrityViolation(botId);
    return { restored: true };
  }
  return { restored: false };
}
```

### 5.3 Endpoints

```typescript
// server/routers.ts - add to bot router
personality: router({
  // Get current personality profile
  getProfile: protectedProcedure
    .input(z.object({ botId: z.number() }))
    .query(async ({ ctx, input }) => {
      return getBotPersonalityProfile(input.botId);
    }),
    
  // Toggle personality sync
  toggleSync: protectedProcedure
    .input(z.object({ botId: z.number(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return updateBotPersonalitySync(input.botId, input.enabled);
    }),
    
  // Reset to default personality
  reset: protectedProcedure
    .input(z.object({ botId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return resetBotPersonality(input.botId);
    }),
    
  // Lock personality (stop evolution)
  lock: protectedProcedure
    .input(z.object({ botId: z.number(), locked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return lockBotPersonality(input.botId, input.locked);
    }),
})
```

### 5.4 S3 Template Structure

```
s3://jarble-skill-templates/
├── core/
│   └── SOUL_LOCKED.md      # Immutable safety/boundary rules
├── personalities/
│   ├── default/SOUL.md     # Default personality template
│   ├── professional/SOUL.md
│   ├── friendly/SOUL.md
│   └── concise/SOUL.md
└── skills/
    └── personality-sync/   # Personality analysis skill
        ├── SKILL.md
        └── analyze.ts
```

---

## Environment Variables

```bash
# Database
DATABASE_URL=mysql://user:pass@host:3306/jarble

# Auth0
AUTH0_DOMAIN=jarble.us.auth0.com
AUTH0_AUDIENCE=https://api.jarble.ai
AUTH0_CLIENT_ID=xxx
AUTH0_CLIENT_SECRET=xxx

# Stripe  
STRIPE_SECRET_KEY=sk_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# OpenRouter
OPENROUTER_API_KEY=sk-or-xxx

# AWS
AWS_REGION=us-east-1
PROVISIONING_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/xxx/jarble-provisioning

# App
APP_URL=https://jarble.ai
NEXT_PUBLIC_APP_URL=https://jarble.ai
```

---

## File Structure (What to Add)

```
server/
├── routers.ts           # ← Add billing router
├── db.ts                # ← Add Stripe/usage functions
├── _core/
│   ├── auth0.ts         # ← NEW: JWT validation
│   └── trpc.ts          # ← Update context
├── billing/
│   ├── stripe.ts        # ← NEW: Stripe helpers
│   ├── llm-billing.ts   # ← NEW: LLM usage billing
│   └── aws-overage.ts   # ← NEW: AWS cost billing
└── provisioning/
    ├── queue.ts         # ← NEW: SQS integration
    └── types.ts         # ← NEW: Job types

app/api/
├── webhooks/
│   └── stripe/
│       └── route.ts     # ← NEW: Stripe webhooks
└── trpc/[trpc]/route.ts # Existing
```

---

## Migrations

Run after schema changes:

```bash
cd /jarble
pnpm db:push  # Generates + applies migrations
```

---

## Quality Checklist

- [ ] All procedures have proper Zod input validation
- [ ] protectedProcedure used for authenticated endpoints
- [ ] Stripe webhook verifies signature
- [ ] Error messages don't leak sensitive info
- [ ] Usage tracking records all LLM calls
- [ ] Provisioning jobs update status in DB
- [ ] Tests cover critical flows (Vitest)

---

## ⛔ What NOT To Do

| Don't | Why |
|-------|-----|
| Replace tRPC with REST | Architecture decision already made |
| Switch to Prisma | Drizzle already integrated |
| Change to PostgreSQL | MySQL/PlanetScale chosen |
| Create separate API server | Monorepo with Next.js API routes |
| Duplicate existing procedures | Extend, don't recreate |

---

## Handoff Template

When complete, create:

```markdown
## Handoff: Backend → Frontend

**From:** Backend Agent
**To:** Frontend Agent  
**Status:** Complete

### What's Ready
- Auth0 JWT validation working
- Stripe checkout + webhooks working
- Provisioning queue integrated
- LLM usage tracking active

### tRPC Client Usage
const { data } = trpc.billing.getUsage.useQuery();
const checkout = trpc.billing.createCheckout.useMutation();

### New Procedures
| Procedure | Purpose |
|-----------|---------|
| billing.createCheckout | Returns Stripe checkout URL |
| billing.getPortalUrl | Billing management portal |
| billing.getUsage | Usage + cost summary |
| bot.getProvisioningStatus | Poll deployment progress |
```

---

## Resources

- [tRPC Docs](https://trpc.io/docs)
- [Drizzle ORM Docs](https://orm.drizzle.team/docs)
- [Auth0 Next.js](https://auth0.com/docs/quickstart/webapp/nextjs)
- [Stripe API](https://stripe.com/docs/api)
- [OpenRouter API](https://openrouter.ai/docs)

---

*Build the engine.* ⚙️

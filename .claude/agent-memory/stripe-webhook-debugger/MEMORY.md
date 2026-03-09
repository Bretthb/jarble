# Stripe Webhook Debugger - Memory

## Project Structure
- API: `jarble-api-main/src/`
- Webhook handler: `jarble-api-main/src/index.ts` (lines 68-271)
- Stripe service: `jarble-api-main/src/services/stripe.ts`
- Subscription enforcement: `jarble-api-main/src/services/subscriptionEnforcement.ts`
- Billing router: `jarble-api-main/src/trpc/routers/billing.ts`
- Deployment router: `jarble-api-main/src/trpc/routers/deployment.ts`
- K8s deployment: `jarble-api-main/src/k8s/deployment.ts`
- DB schemas: `schema.ts` (MySQL), `schema.pg.ts` (Postgres), `schema.sqlite.ts` (SQLite)
- Multi-DB: MySQL/Postgres/SQLite via `DB_PROVIDER` env var

## Middleware Ordering (Verified Correct)
- Line 68: `express.raw({ type: "application/json" })` on webhook route
- Line 274: `express.json()` registered AFTER webhook route
- Raw body parser is inline on the route, not global - this is correct

## Idempotency Implementation
- `processedWebhookEvents` table with `eventId` as primary key
- Check-then-insert pattern with unique constraint catch (lines 85-109)
- Handles SQLite (`SQLITE_CONSTRAINT`), MySQL (`ER_DUP_ENTRY`), Postgres (`23505`)
- Event is marked processed BEFORE handling (optimistic lock)

## Env Vars
- `STRIPE_SECRET_KEY` - Stripe API key
- `STRIPE_WEBHOOK_SECRET` - Webhook signing secret
- Both optional, Stripe features disabled if not set

## Key Findings (Audit 2026-02-18)
See [audit-findings.md](audit-findings.md) for detailed bug report.

# Stripe Setup Guide

*Last updated: March 11, 2026*

> Jarble uses **dynamic pricing** via `price_data` in checkout sessions — no pre-created Stripe Price objects needed. Pricing is derived from the runtime catalog (`monthlyPriceCents`).

## 1. Create Stripe Account

1. Go to https://dashboard.stripe.com/register
2. Complete account setup

## 2. Get API Keys

1. Go to https://dashboard.stripe.com/test/apikeys (test) or `/apikeys` (live)
2. Copy the **Secret key** (`sk_test_*` or `sk_live_*`)
3. Copy the **Publishable key** (`pk_test_*` or `pk_live_*`)
4. Set in environment:
   - **Backend**: `STRIPE_SECRET_KEY` in `.env` (local) or K8s secret (prod)
   - **Frontend**: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `.env.local` (local) or Vercel (prod)

## 3. Set Up Webhook

### For Local Development (using Stripe CLI)

1. Install Stripe CLI: https://stripe.com/docs/stripe-cli
2. Login: `stripe login`
3. Forward webhooks:
   ```bash
   stripe listen --forward-to localhost:3001/api/stripe/webhook
   ```
4. Copy the webhook signing secret (starts with `whsec_`)
5. Add to `.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_xxxx
   ```

### For Production

1. Go to Stripe Dashboard → Webhooks
2. Click "Add endpoint"
3. Endpoint URL: `https://api.jarble.ai/api/stripe/webhook`
4. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. Copy the signing secret
6. Set in K8s secret `jarble-api-secrets` → `STRIPE_WEBHOOK_SECRET`

## 5. Configure Customer Portal

1. Go to https://dashboard.stripe.com/test/settings/billing/portal
2. Enable features:
   - ✅ Cancel subscriptions
   - ✅ Switch plans (upgrade/downgrade)
   - ✅ Update payment methods
3. Set cancellation policy (optional)

## 5. Test the Flow

### Create a deployment and subscribe:
1. Complete the onboarding wizard
2. At the deploy step, Stripe checkout opens with dynamic pricing
3. Use test card: `4242 4242 4242 4242`
4. Any future expiry, any CVC, any ZIP
5. Complete checkout → deployment creates and pod starts

### Verify in Database:
```sql
SELECT id, name, stripe_subscription_id, monthly_price_cents, status
FROM deployments
WHERE user_id = 'YOUR_USER_ID';
```

### Test Webhook:
```bash
stripe trigger checkout.session.completed
```

## Environment Variables Summary

```bash
# Backend (.env)
STRIPE_SECRET_KEY=sk_test_xxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxx

# Frontend (.env.local)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxx
```

**Important**: Test and Live keys are completely separate. When switching modes, clear `stripe_customer_id` on all users in the DB.

## Test Cards

| Scenario | Card Number |
|----------|-------------|
| Success | 4242 4242 4242 4242 |
| Declined | 4000 0000 0000 0002 |
| Requires auth | 4000 0025 0000 3155 |
| Insufficient funds | 4000 0000 0000 9995 |

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  User Flow                                                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Pricing Page                                                │
│       │                                                      │
│       ▼                                                      │
│  [Subscribe to Pro] ──► POST /api/stripe/checkout           │
│       │                        │                             │
│       │                        ▼                             │
│       │              Create Checkout Session                 │
│       │                        │                             │
│       ▼                        ▼                             │
│  Redirect ──────────► checkout.stripe.com                   │
│                               │                              │
│                               ▼                              │
│                        User pays                             │
│                               │                              │
│                               ▼                              │
│  /dashboard?success ◄─── Redirect                           │
│                               │                              │
│                               ▼                              │
│                        Webhook fires                         │
│                               │                              │
│                               ▼                              │
│                   POST /api/stripe/webhook                   │
│                               │                              │
│                               ▼                              │
│                   Update user.tier = 'pro'                   │
│                   subscriptionStatus = 'active'              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Troubleshooting

### "Missing signature" error
- Make sure `STRIPE_WEBHOOK_SECRET` is set correctly
- For local dev, use the secret from `stripe listen` output

### User not updated after payment
- Check webhook logs: `stripe logs tail`
- Verify metadata includes `userId` and `tier`
- Check Next.js server logs for errors

### Customer portal not working
- Ensure user has `stripeCustomerId` in database
- Configure portal in Stripe Dashboard first

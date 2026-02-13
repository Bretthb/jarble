# Stripe Setup Guide

## 1. Create Stripe Account

1. Go to https://dashboard.stripe.com/register
2. Complete account setup

## 2. Get API Keys

1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy the **Secret key** (starts with `sk_test_`)
3. Add to `.env.local`:
   ```
   STRIPE_SECRET_KEY=sk_test_xxxx
   ```

## 3. Create Products & Prices

Go to https://dashboard.stripe.com/test/products and create:

### Pro Tier ($10/month)
- Name: "Jarble Pro"
- Price: $10.00 / month (recurring)
- Copy the Price ID (starts with `price_`)
- Add to `.env.local`:
  ```
  STRIPE_PRICE_PRO=price_xxxx
  ```

### Agency Tier ($50/month)
- Name: "Jarble Agency"
- Price: $50.00 / month (recurring)
- Copy the Price ID
- Add to `.env.local`:
  ```
  STRIPE_PRICE_AGENCY=price_xxxx
  ```

## 4. Set Up Webhook

### For Local Development (using Stripe CLI)

1. Install Stripe CLI: https://stripe.com/docs/stripe-cli
2. Login: `stripe login`
3. Forward webhooks:
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
4. Copy the webhook signing secret (starts with `whsec_`)
5. Add to `.env.local`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_xxxx
   ```

### For Production

1. Go to https://dashboard.stripe.com/test/webhooks
2. Click "Add endpoint"
3. Endpoint URL: `https://jarble.ai/api/stripe/webhook`
4. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
5. Copy the signing secret
6. Add to environment variables

## 5. Configure Customer Portal

1. Go to https://dashboard.stripe.com/test/settings/billing/portal
2. Enable features:
   - ✅ Cancel subscriptions
   - ✅ Switch plans (upgrade/downgrade)
   - ✅ Update payment methods
3. Set cancellation policy (optional)

## 6. Test the Flow

### Subscribe to Pro:
1. Click "Subscribe to Pro" on pricing page
2. Use test card: `4242 4242 4242 4242`
3. Any future expiry, any CVC, any ZIP
4. Complete checkout
5. Should redirect to dashboard with `?checkout=success`

### Verify in Database:
```sql
SELECT id, email, tier, subscription_status, stripe_customer_id 
FROM users 
WHERE id = YOUR_USER_ID;
```

### Test Webhook:
```bash
# In another terminal
stripe trigger checkout.session.completed
```

## Environment Variables Summary

```bash
# .env.local
STRIPE_SECRET_KEY=sk_test_xxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxx
STRIPE_PRICE_PRO=price_xxxx
STRIPE_PRICE_AGENCY=price_xxxx
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

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

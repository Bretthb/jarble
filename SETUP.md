# Jarble Platform — Setup & TODO

Things to configure before production. These are deferred from development and can be done later.

---

## 1. Auth0 Email Verification

**Status:** Post Login Action installed ("Require Email Verification") but no email provider configured, so verification emails are not sent.

**What to do:**
1. Go to **Auth0 Dashboard → Branding → Email Provider**
2. Configure a real SMTP provider. Options:
   - **Resend** (easiest): Sign up at [resend.com](https://resend.com), get API key, use SMTP settings:
     - Host: `smtp.resend.com`
     - Port: `587`
     - Username: `resend`
     - Password: `<your Resend API key>`
   - **SendGrid**: Sign up at [sendgrid.com](https://sendgrid.com), get API key, select SendGrid in Auth0
   - **Amazon SES**: If you're already on AWS
3. Optionally customize the email template at **Branding → Email Templates → Verification Email**
4. Test by signing up with a new email/password account

**Current workaround:** Manually verify users in Auth0 Dashboard → User Management → Users → click user → toggle email verified. Google OAuth users are auto-verified.

---

## 2. Stripe Integration

**Status:** Backend fully wired up with hardware-based pricing. Subscriptions are created dynamically using `price_data` (no pre-created Stripe price IDs needed).

### 2a. Pricing Model

Pricing is hardware-based — each deployment's monthly cost is calculated from its vCPU, RAM, and storage specs:

| Resource | Per Unit | Price/mo |
|----------|----------|----------|
| vCPU | 1.0 | $10.00 |
| RAM | 1 GB | $2.50 |
| Storage | 1 GB | $0.08 |

The checkout flow uses Stripe's `price_data` to create subscriptions with the calculated amount. No pre-created Stripe products/prices needed.

### 2b. Set Up Stripe Webhook

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Add endpoint: `https://your-api-domain.com/api/stripe/webhook`
3. Select events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the webhook signing secret to your API `.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxx
   ```

### 2c. For Local Testing

1. Install Stripe CLI: `brew install stripe/stripe-cli/stripe` (Mac) or [download](https://stripe.com/docs/stripe-cli)
2. Login: `stripe login`
3. Forward webhooks: `stripe listen --forward-to localhost:3001/api/stripe/webhook`
4. Copy the webhook secret it prints to your `.env`

### 2d. Webhook Handlers (Implemented)

All 4 webhook handlers are fully implemented:
- **`checkout.session.completed`** — Stores `pendingStripeSubscriptionId` on user for deployment linking
- **`customer.subscription.updated`** — Syncs cancel state + payment errors
- **`customer.subscription.deleted`** — Stops deployment
- **`invoice.payment_failed`** — Flags deployment with error

---

## 3. Auth0 Post Login Action (Custom Claims)

**Status:** Already configured and working. The "Add user claims to access token" action adds email, name, and email_verified as namespaced claims to the access token.

**Claims namespace:** `https://api.jarble.ai`

No action needed unless you change the API audience.

---

## 4. Environment Variables Reference

### API (`jarble-api-main/.env`)

```env
# Required
DATABASE_URL=mysql://user:pass@host:3306/jarble
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_AUDIENCE=https://api.jarble.ai

# Optional (dev uses SQLite if not set)
USE_SQLITE=true
PORT=3001
NODE_ENV=development

# Stripe (optional — features disabled if not set)
STRIPE_SECRET_KEY=sk_test_xxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxx
# OpenRouter (for AI features)
OPENROUTER_API_KEY=sk-or-xxxxxxxxx
```

### Frontend (`Jarble-mvp/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_AUTH0_DOMAIN=your-tenant.us.auth0.com
NEXT_PUBLIC_AUTH0_CLIENT_ID=your-client-id
NEXT_PUBLIC_AUTH0_AUDIENCE=https://api.jarble.ai
```

---

## 5. Production Checklist

- [ ] Configure email provider in Auth0 (Section 1)
- [ ] Create Stripe products and prices (Section 2a)
- [ ] Set up Stripe webhook endpoint (Section 2b)
- [ ] Complete webhook handler TODOs (Section 2e)
- [ ] Update frontend pricing page with real prices (Section 2d)
- [ ] Set up custom domain for Auth0
- [ ] Switch Stripe from test mode to live mode
- [ ] Set up production database (MySQL or Postgres)
- [ ] Deploy API and frontend
- [ ] Set all production env vars

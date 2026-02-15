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

**Status:** Backend fully wired up, frontend buttons exist but show "Coming Soon" for Pro/Agency since pricing is TBD.

### 2a. Create Stripe Products & Prices

1. Go to [Stripe Dashboard → Products](https://dashboard.stripe.com/products)
2. Create two subscription products:
   - **Pro** — set your monthly price, note the Price ID (starts with `price_`)
   - **Agency** — set your monthly price, note the Price ID
3. Add Price IDs to your API `.env`:
   ```
   STRIPE_PRICE_PRO=price_xxxxxxxxx
   STRIPE_PRICE_AGENCY=price_xxxxxxxxx
   ```

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

### 2d. Update Frontend Pricing

Once pricing is decided, update `Jarble-mvp/views/Pricing.tsx`:
- Set actual prices for Pro and Agency tiers
- Remove the "Coming Soon" disabled state
- Enable the SubscribeButton for those tiers

### 2e. Webhook TODOs (Code Changes Needed)

The webhook handler in `jarble-api-main/src/index.ts` has these incomplete handlers:
- **`customer.subscription.updated`** — TODO: sync tier changes (upgrade/downgrade user's `tierId`)
- **`customer.subscription.deleted`** — TODO: downgrade user to Free tier
- **`invoice.payment_failed`** — TODO: flag account and notify user

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
STRIPE_PRICE_PRO=price_xxxxxxxxx
STRIPE_PRICE_AGENCY=price_xxxxxxxxx

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

import Stripe from "stripe";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";

// Stripe client — only initialized if STRIPE_SECRET_KEY is set
let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripe) {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    stripe = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

export function isStripeConfigured(): boolean {
  return !!env.STRIPE_SECRET_KEY;
}

/**
 * Create a Stripe Checkout session for a hardware-based subscription.
 * Price is calculated from the deployment's vCPU, RAM, and storage specs.
 */
export async function createCheckoutSession(params: {
  userId: string;
  userEmail: string;
  runtimeSlug: string;
  monthlyPriceCents: number;
  stripeCustomerId?: string | null;
  successUrl: string;
  cancelUrl: string;
}): Promise<Stripe.Checkout.Session> {
  const s = getStripe();

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{
      price_data: {
        currency: "usd",
        unit_amount: params.monthlyPriceCents,
        recurring: { interval: "month" },
        product_data: {
          name: `Jarble Deployment (${params.runtimeSlug})`,
        },
      },
      quantity: 1,
    }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.userId,
    metadata: {
      userId: params.userId,
      runtimeSlug: params.runtimeSlug,
    },
  };

  // If user already has a Stripe customer ID, reuse it
  if (params.stripeCustomerId) {
    sessionParams.customer = params.stripeCustomerId;
  } else {
    sessionParams.customer_email = params.userEmail;
  }

  const session = await s.checkout.sessions.create(sessionParams);
  logger.info({ userId: params.userId, runtimeSlug: params.runtimeSlug, sessionId: session.id }, "Stripe checkout session created");
  return session;
}

/**
 * Create a Stripe Customer Portal session for managing subscriptions
 */
export async function createPortalSession(params: {
  stripeCustomerId: string;
  returnUrl: string;
}): Promise<Stripe.BillingPortal.Session> {
  const s = getStripe();

  const session = await s.billingPortal.sessions.create({
    customer: params.stripeCustomerId,
    return_url: params.returnUrl,
  });

  logger.info({ customerId: params.stripeCustomerId }, "Stripe portal session created");
  return session;
}

/**
 * Construct and verify a Stripe webhook event
 */
export function constructWebhookEvent(
  body: Buffer,
  signature: string
): Stripe.Event {
  const s = getStripe();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }

  return s.webhooks.constructEvent(body, signature, webhookSecret);
}

/**
 * Cancel a subscription at the end of the current billing period.
 * The subscription stays active until `current_period_end`, then Stripe fires
 * `customer.subscription.deleted` and we auto-stop the deployment.
 */
export async function cancelSubscriptionAtPeriodEnd(
  subscriptionId: string
): Promise<{ cancelAt: Date }> {
  const s = getStripe();

  const subscription = await s.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });

  const cancelAt = new Date((subscription as any).current_period_end * 1000);
  logger.info(
    { subscriptionId, cancelAt: cancelAt.toISOString() },
    "Subscription scheduled for cancellation at period end"
  );

  return { cancelAt };
}

/**
 * Cancel a subscription immediately. Used when a deployment is deleted —
 * the user should not be billed for a resource that no longer exists.
 */
export async function cancelSubscriptionImmediately(
  subscriptionId: string
): Promise<void> {
  const s = getStripe();

  await s.subscriptions.cancel(subscriptionId);
  logger.info({ subscriptionId }, "Subscription canceled immediately");
}

/**
 * Reactivate a subscription that was scheduled for cancellation.
 * Clears the `cancel_at_period_end` flag so billing continues normally.
 */
export async function reactivateSubscription(
  subscriptionId: string
): Promise<void> {
  const s = getStripe();

  await s.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });

  logger.info({ subscriptionId }, "Subscription reactivated");
}

/**
 * List active subscriptions for a Stripe customer.
 * Used by linkSubscription fallback to find unlinked subscriptions.
 */
export async function listActiveSubscriptions(
  customerId: string
): Promise<Stripe.Subscription[]> {
  const s = getStripe();

  const result = await s.subscriptions.list({
    customer: customerId,
    status: "active",
    limit: 10,
  });

  return result.data;
}

/**
 * List invoices for a Stripe customer (newest first).
 */
export async function listInvoices(
  customerId: string,
  limit = 24
): Promise<Stripe.Invoice[]> {
  const s = getStripe();
  const result = await s.invoices.list({ customer: customerId, limit });
  return result.data;
}

/**
 * Retrieve a subscription with expanded price details.
 */
export async function getSubscriptionDetails(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  const s = getStripe();
  return s.subscriptions.retrieve(subscriptionId, {
    expand: ["default_payment_method"],
  });
}

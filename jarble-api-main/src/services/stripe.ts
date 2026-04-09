import Stripe from "stripe";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";

// Stripe client - only initialized if STRIPE_SECRET_KEY is set
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
 * Optionally adds a second line item for managed keys.
 */
export async function createCheckoutSession(params: {
  userId: string;
  userEmail: string;
  runtimeSlug: string;
  monthlyPriceCents: number;
  managedKeyCents?: number;
  stripeCustomerId?: string | null;
  orgId?: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<Stripe.Checkout.Session> {
  const s = getStripe();

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{
    price_data: {
      currency: "usd",
      unit_amount: params.monthlyPriceCents,
      recurring: { interval: "month" },
      product_data: {
        name: `Jarble Hardware (${params.runtimeSlug})`,
        metadata: { type: "hardware" },
      },
    },
    quantity: 1,
  }];

  // Add managed key line item if applicable
  if (params.managedKeyCents && params.managedKeyCents > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: params.managedKeyCents,
        recurring: { interval: "month" },
        product_data: {
          name: "Jarble Managed Keys",
          metadata: { type: "managed_key" },
        },
      },
      quantity: 1,
    });
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: lineItems,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.userId,
    metadata: {
      userId: params.userId,
      runtimeSlug: params.runtimeSlug,
      ...(params.orgId ? { orgId: params.orgId } : {}),
      ...(params.managedKeyCents && params.managedKeyCents > 0
        ? { hasManagedKeys: "true", managedKeyPlanDollars: String(params.managedKeyCents / 100) }
        : {}),
    },
  };

  // If user already has a Stripe customer ID, reuse it
  if (params.stripeCustomerId) {
    sessionParams.customer = params.stripeCustomerId;
  } else {
    sessionParams.customer_email = params.userEmail;
  }

  const session = await s.checkout.sessions.create(sessionParams);
  logger.info({ userId: params.userId, runtimeSlug: params.runtimeSlug, sessionId: session.id, managedKeyCents: params.managedKeyCents }, "Stripe checkout session created");
  return session;
}

/**
 * Create an incomplete Stripe subscription for use with Stripe Elements.
 * Returns the PaymentIntent client_secret so the frontend can confirm payment.
 * The subscription stays incomplete until confirmPayment() succeeds.
 * Optionally adds a second line item for managed keys.
 */
export async function createIncompleteSubscription(params: {
  userId: string;
  userEmail: string;
  runtimeSlug: string;
  monthlyPriceCents: number;
  managedKeyCents?: number;
  stripeCustomerId: string;
  orgId?: string;
}): Promise<{ subscriptionId: string; clientSecret: string }> {
  const s = getStripe();

  // Create hardware product + price
  const hardwareProduct = await s.products.create({
    name: `Jarble Hardware (${params.runtimeSlug})`,
    metadata: { userId: params.userId, runtimeSlug: params.runtimeSlug, type: "hardware" },
  });

  const hardwarePrice = await s.prices.create({
    currency: "usd",
    unit_amount: params.monthlyPriceCents,
    recurring: { interval: "month" },
    product: hardwareProduct.id,
  });

  const items: Stripe.SubscriptionCreateParams.Item[] = [{ price: hardwarePrice.id }];

  // Optionally add managed key line item
  if (params.managedKeyCents && params.managedKeyCents > 0) {
    const managedKeyProduct = await s.products.create({
      name: "Jarble Managed Keys",
      metadata: { type: "managed_key" },
    });

    const managedKeyPrice = await s.prices.create({
      currency: "usd",
      unit_amount: params.managedKeyCents,
      recurring: { interval: "month" },
      product: managedKeyProduct.id,
    });

    items.push({ price: managedKeyPrice.id });
  }

  const subscription = await s.subscriptions.create({
    customer: params.stripeCustomerId,
    items,
    payment_behavior: "default_incomplete",
    payment_settings: {
      payment_method_types: ["card"],
      save_default_payment_method: "on_subscription",
    },
    metadata: {
      userId: params.userId,
      runtimeSlug: params.runtimeSlug,
      ...(params.orgId ? { orgId: params.orgId } : {}),
      ...(params.managedKeyCents && params.managedKeyCents > 0
        ? { hasManagedKeys: "true", managedKeyPlanDollars: String(params.managedKeyCents / 100) }
        : {}),
    },
    expand: ["latest_invoice.confirmation_secret"],
  });

  // In Stripe API 2025+, payment_intent moved off Invoice.
  // Use invoice.confirmation_secret (contains the PaymentIntent client_secret)
  // or fall back to the legacy payment_intent field for older API versions.
  const invoice = subscription.latest_invoice as Stripe.Invoice;
  const clientSecret =
    (invoice as any)?.confirmation_secret?.client_secret ??
    ((invoice as any)?.payment_intent as Stripe.PaymentIntent | null)?.client_secret ??
    null;

  if (!clientSecret) {
    throw new Error(
      `No client_secret on invoice: invoice=${invoice?.id} status=${invoice?.status} total=${invoice?.total}`
    );
  }

  logger.info(
    { userId: params.userId, runtimeSlug: params.runtimeSlug, subscriptionId: subscription.id, invoiceId: invoice?.id },
    "Stripe incomplete subscription created"
  );

  return {
    subscriptionId: subscription.id,
    clientSecret,
  };
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
 * Cancel a subscription immediately. Used when a deployment is deleted -
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
    expand: ["default_payment_method", "items.data.price.product"],
  });
}

// ─── Managed Key Line Item Helpers ─────────────────────────────────────

/**
 * Find the managed key line item on a subscription by checking product metadata.
 * Returns null if the subscription has no managed key line item.
 */
export async function findManagedKeyItem(
  subscriptionId: string
): Promise<{ itemId: string; unitAmount: number } | null> {
  const s = getStripe();
  const subscription = await s.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price.product"],
  });

  for (const item of subscription.items.data) {
    const product = item.price.product;
    const metadata = typeof product === "object" && product !== null
      ? (product as Stripe.Product).metadata
      : null;

    if (metadata?.type === "managed_key") {
      return {
        itemId: item.id,
        unitAmount: item.price.unit_amount ?? 0,
      };
    }
  }

  return null;
}

/**
 * Add a managed key line item to an existing subscription.
 * Creates a new product + price and appends it as a subscription item.
 */
export async function addManagedKeyLineItem(
  subscriptionId: string,
  managedKeyCents: number
): Promise<Stripe.SubscriptionItem> {
  const s = getStripe();

  const product = await s.products.create({
    name: "Jarble Managed Keys",
    metadata: { type: "managed_key" },
  });

  const price = await s.prices.create({
    currency: "usd",
    unit_amount: managedKeyCents,
    recurring: { interval: "month" },
    product: product.id,
  });

  const item = await s.subscriptionItems.create({
    subscription: subscriptionId,
    price: price.id,
    proration_behavior: "create_prorations",
  });

  // Update subscription metadata
  await s.subscriptions.update(subscriptionId, {
    metadata: {
      hasManagedKeys: "true",
      managedKeyPlanDollars: String(managedKeyCents / 100),
    },
  });

  logger.info(
    { subscriptionId, itemId: item.id, managedKeyCents },
    "Added managed key line item to subscription"
  );

  return item;
}

/**
 * Update the price of an existing managed key line item (with proration).
 */
export async function updateManagedKeyLineItem(
  subscriptionItemId: string,
  newCents: number
): Promise<void> {
  const s = getStripe();

  // Get current item to find the subscription
  const currentItem = await s.subscriptionItems.retrieve(subscriptionItemId);
  const subscriptionId = currentItem.subscription as string;

  // Create a new price (Stripe prices are immutable)
  const product = currentItem.price.product as string;
  const newPrice = await s.prices.create({
    currency: "usd",
    unit_amount: newCents,
    recurring: { interval: "month" },
    product,
  });

  await s.subscriptionItems.update(subscriptionItemId, {
    price: newPrice.id,
    proration_behavior: "create_prorations",
  });

  // Update subscription metadata
  await s.subscriptions.update(subscriptionId, {
    metadata: {
      managedKeyPlanDollars: String(newCents / 100),
    },
  });

  logger.info(
    { subscriptionItemId, newCents },
    "Updated managed key line item price"
  );
}

/**
 * Remove a managed key line item from a subscription (with proration).
 */
export async function removeManagedKeyLineItem(
  subscriptionItemId: string
): Promise<void> {
  const s = getStripe();

  // Get the subscription ID before deleting the item
  const item = await s.subscriptionItems.retrieve(subscriptionItemId);
  const subscriptionId = item.subscription as string;

  await s.subscriptionItems.del(subscriptionItemId, {
    proration_behavior: "create_prorations",
  });

  // Update subscription metadata
  await s.subscriptions.update(subscriptionId, {
    metadata: {
      hasManagedKeys: "false",
      managedKeyPlanDollars: "",
    },
  });

  logger.info(
    { subscriptionItemId, subscriptionId },
    "Removed managed key line item from subscription"
  );
}

/**
 * Sum the total monthly cost across ALL line items in a subscription.
 */
export function sumSubscriptionItemsCents(subscription: Stripe.Subscription): number {
  return subscription.items.data.reduce(
    (total, item) => total + (item.price.unit_amount ?? 0),
    0
  );
}

/**
 * Get per-item breakdown of a subscription (hardware vs managed keys).
 */
export function getSubscriptionBreakdown(subscription: Stripe.Subscription): {
  hardwareCents: number;
  managedKeyCents: number;
  totalCents: number;
} {
  let hardwareCents = 0;
  let managedKeyCents = 0;

  for (const item of subscription.items.data) {
    const product = item.price.product;
    const metadata = typeof product === "object" && product !== null
      ? (product as Stripe.Product).metadata
      : null;

    const amount = item.price.unit_amount ?? 0;

    if (metadata?.type === "managed_key") {
      managedKeyCents += amount;
    } else {
      hardwareCents += amount;
    }
  }

  return { hardwareCents, managedKeyCents, totalCents: hardwareCents + managedKeyCents };
}

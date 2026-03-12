import { Router } from "express";
import type { Request, Response } from "express";
import { eq, and, isNull, or, desc, inArray } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { env } from "../utils/env.js";
import {
  isStripeConfigured,
  createCheckoutSession,
  createPortalSession,
  constructWebhookEvent,
} from "../services/stripe.js";
import { stopDeployment } from "../k8s/index.js";
import { getUserFromRequest } from "../helpers/auth.js";
import { stripeActionLimiter } from "../middleware/rateLimit.js";

/**
 * Stripe webhook handler — must be mounted BEFORE express.json() in index.ts
 * because it needs the raw request body for signature verification.
 */
export async function stripeWebhookHandler(req: Request, res: Response) {
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Stripe is not configured" });
    return;
  }

  const sig = req.headers["stripe-signature"] as string;
  if (!sig) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  try {
    const event = constructWebhookEvent(req.body, sig);
    logger.info({ type: event.type, id: event.id }, "Stripe webhook received");

    // ── Idempotency check: skip if already processed ──
    const existing = await db.select().from(tables.processedWebhookEvents)
      .where(eq(tables.processedWebhookEvents.eventId, event.id))
      .limit(1)
      .then(rows => rows[0]);

    if (existing) {
      logger.info({ eventId: event.id }, "Webhook event already processed, skipping");
      res.json({ received: true, skipped: true });
      return;
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;
        const userId = session.metadata?.userId || session.client_reference_id;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string | null;

        if (userId) {
          await db.update(tables.users)
            .set({
              stripeCustomerId: customerId,
              emailVerified: true, // If they can pay, they're verified
              ...(subscriptionId ? { pendingStripeSubscriptionId: subscriptionId } : {}),
            })
            .where(eq(tables.users.id, userId));

          logger.info({ userId, customerId, subscriptionId }, "Checkout completed — subscription pending link");

          // ── Two-sided linking: try to link subscription to an unlinked deployment ──
          // This handles the race where deployment.create already ran before the webhook arrived.
          if (subscriptionId) {
            try {
              const unlinkedDeployment = await db.select().from(tables.deployments)
                .where(and(
                  eq(tables.deployments.userId, userId),
                  isNull(tables.deployments.stripeSubscriptionId),
                  or(
                    eq(tables.deployments.isFree, false),
                    isNull(tables.deployments.isFree),
                  ),
                  inArray(tables.deployments.status, ["creating", "running", "stopped"]),
                ))
                .orderBy(desc(tables.deployments.createdAt))
                .limit(1)
                .then(rows => rows[0]);

              if (unlinkedDeployment) {
                await db.update(tables.deployments)
                  .set({ stripeSubscriptionId: subscriptionId })
                  .where(eq(tables.deployments.id, unlinkedDeployment.id));

                // Clear pending since we just linked it directly
                await db.update(tables.users)
                  .set({ pendingStripeSubscriptionId: null })
                  .where(eq(tables.users.id, userId));

                logger.info(
                  { userId, deploymentId: unlinkedDeployment.id, subscriptionId },
                  "Webhook linked subscription directly to unlinked deployment (race condition resolved)"
                );
              }
            } catch (linkErr) {
              // Non-fatal: pending subscription remains as fallback for deployment.create
              logger.warn({ err: linkErr, userId, subscriptionId }, "Failed to auto-link subscription in webhook (pending field preserved)");
            }
          }
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as any;
        const subscriptionId = subscription.id as string;
        const customerId = subscription.customer as string;
        const status = subscription.status as string;
        const cancelAtPeriodEnd = subscription.cancel_at_period_end as boolean;
        const currentPeriodEnd = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : null;

        logger.info({ customerId, subscriptionId, status, cancelAtPeriodEnd }, "Subscription updated");

        try {
          const linked = await db.select().from(tables.deployments)
            .where(eq(tables.deployments.stripeSubscriptionId, subscriptionId))
            .limit(1)
            .then(rows => rows[0]);

          if (!linked) {
            logger.warn({ subscriptionId }, "No deployment found for updated subscription");
            break;
          }

          const updates: Record<string, any> = {};

          if (cancelAtPeriodEnd && !linked.cancelledAt) {
            updates.cancelledAt = new Date().toISOString();
            updates.cancelAtPeriodEnd = currentPeriodEnd?.toISOString() || null;
            logger.info({ deploymentId: linked.id }, "Subscription cancellation synced from Stripe");
          } else if (!cancelAtPeriodEnd && linked.cancelledAt) {
            updates.cancelledAt = null;
            updates.cancelAtPeriodEnd = null;
            logger.info({ deploymentId: linked.id }, "Subscription reactivation synced from Stripe");
          }

          if (status === "past_due" || status === "unpaid") {
            updates.error = `Subscription ${status}: please update your payment method`;
            logger.warn({ deploymentId: linked.id, status }, "Subscription payment issue");
          } else if (status === "active" && linked.error?.startsWith("Subscription ")) {
            updates.error = null;
          }

          if (Object.keys(updates).length > 0) {
            await db.update(tables.deployments)
              .set(updates)
              .where(eq(tables.deployments.id, linked.id));
          }
        } catch (err) {
          logger.error({ err, subscriptionId }, "Failed to handle subscription update");
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as any;
        const subscriptionId = subscription.id as string;
        const customerId = subscription.customer as string;
        logger.info({ customerId, subscriptionId }, "Subscription canceled — stopping deployment");

        try {
          const linked = await db.select().from(tables.deployments)
            .where(eq(tables.deployments.stripeSubscriptionId, subscriptionId))
            .limit(1)
            .then(rows => rows[0]);

          if (linked) {
            await stopDeployment(linked.id);
            await db.update(tables.deployments)
              .set({ status: "stopped", error: null, stripeSubscriptionId: null, cancelledAt: null, cancelAtPeriodEnd: null })
              .where(eq(tables.deployments.id, linked.id));
            logger.info({ deploymentId: linked.id, subscriptionId }, "Deployment stopped after subscription deletion");
          } else {
            logger.warn({ subscriptionId }, "No deployment found for deleted subscription");
          }
        } catch (err) {
          logger.error({ err, subscriptionId }, "Failed to stop deployment after subscription deletion");
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as any;
        const customerId = invoice.customer as string;
        const invoiceSubscriptionId = invoice.subscription as string | null;

        logger.warn({ customerId, subscriptionId: invoiceSubscriptionId }, "Invoice payment failed");

        try {
          if (invoiceSubscriptionId) {
            const linked = await db.select().from(tables.deployments)
              .where(eq(tables.deployments.stripeSubscriptionId, invoiceSubscriptionId))
              .limit(1)
              .then(rows => rows[0]);

            if (linked) {
              await db.update(tables.deployments)
                .set({ error: "Payment failed — please update your payment method" })
                .where(eq(tables.deployments.id, linked.id));
              logger.warn({ deploymentId: linked.id, subscriptionId: invoiceSubscriptionId }, "Deployment flagged for payment failure");
            }
          } else {
            const user = await db.select().from(tables.users)
              .where(eq(tables.users.stripeCustomerId, customerId))
              .limit(1)
              .then(rows => rows[0]);

            if (user) {
              const userDeployments = await db.select().from(tables.deployments)
                .where(eq(tables.deployments.userId, user.id));
              for (const dep of userDeployments) {
                if (!dep.isFree && dep.stripeSubscriptionId) {
                  await db.update(tables.deployments)
                    .set({ error: "Payment failed — please update your payment method" })
                    .where(eq(tables.deployments.id, dep.id));
                }
              }
            }
          }
        } catch (err) {
          logger.error({ err, customerId }, "Failed to handle payment failure");
        }
        break;
      }

      default:
        logger.debug({ type: event.type }, "Unhandled Stripe event");
    }

    // Mark event as processed AFTER handler succeeds (so Stripe retries on crash)
    try {
      await db.insert(tables.processedWebhookEvents).values({
        eventId: event.id,
        eventType: event.type,
      });
    } catch (insertErr: any) {
      // Unique constraint violation = another worker already processed this event
      if (insertErr?.code === "SQLITE_CONSTRAINT" || insertErr?.code === "ER_DUP_ENTRY" || insertErr?.code === "23505") {
        logger.info({ eventId: event.id }, "Webhook event already processed by another worker");
      } else {
        throw insertErr;
      }
    }

    res.json({ received: true });
  } catch (err) {
    logger.error({ err }, "Stripe webhook error");
    res.status(400).json({ error: "Webhook signature verification failed" });
  }
}

/**
 * Stripe router — checkout and portal endpoints.
 * Mounted at /api/stripe in index.ts (after express.json()).
 */
export const stripeRouter = Router();

// ─── Stripe checkout route ───
stripeRouter.post("/checkout", stripeActionLimiter, async (req, res) => {
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Stripe is not configured" });
    return;
  }

  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { runtimeSlug } = req.body;
  if (!runtimeSlug) {
    res.status(400).json({ error: "Missing runtimeSlug" });
    return;
  }

  // Look up runtime catalog to get the canonical price (never trust client-sent price)
  const runtime = await db.select().from(tables.runtimeCatalog)
    .where(eq(tables.runtimeCatalog.slug, runtimeSlug))
    .limit(1)
    .then(rows => rows[0]);
  if (!runtime) {
    res.status(400).json({ error: "Unknown runtime" });
    return;
  }
  const monthlyPriceCents = runtime.monthlyPriceCents;
  if (!monthlyPriceCents || monthlyPriceCents <= 0) {
    res.status(400).json({ error: "Runtime has no configured price" });
    return;
  }

  // Reuse existing Stripe customer ID if available (allows returning customers
  // to subscribe to additional deployments without being blocked).
  try {
    const session = await createCheckoutSession({
      userId: user.id,
      userEmail: user.email,
      runtimeSlug,
      monthlyPriceCents,
      stripeCustomerId: user.stripeCustomerId ?? undefined,
      successUrl: `${env.FRONTEND_URL}/dashboard?checkout=success`,
      cancelUrl: `${env.FRONTEND_URL}/pricing?checkout=canceled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err, userId: user.id, runtimeSlug }, "Failed to create checkout session");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ─── Stripe portal route ───
stripeRouter.post("/portal", stripeActionLimiter, async (req, res) => {
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Stripe is not configured" });
    return;
  }

  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!user.stripeCustomerId) {
    res.status(400).json({ error: "No active subscription. Subscribe to a plan first." });
    return;
  }

  try {
    const session = await createPortalSession({
      stripeCustomerId: user.stripeCustomerId,
      returnUrl: `${env.FRONTEND_URL}/dashboard`,
    });

    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err, userId: user.id }, "Failed to create portal session");
    res.status(500).json({ error: "Failed to create portal session" });
  }
});

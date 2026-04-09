import { db, tables } from "../db/index.js";
import { eq, and, isNull, or } from "drizzle-orm";
import { stopDeployment } from "../k8s/index.js";
import { isStripeConfigured, getSubscriptionDetails } from "./stripe.js";
import { logger } from "../utils/logger.js";
import { safeFireAndForget } from "../utils/safeAsync.js";

const { deployments } = tables;

const SUBSCRIPTION_ERROR_PREFIX = "Subscription";

/**
 * Check subscription status for all active deployments and enforce limits.
 *
 * Handles:
 * 1. Deployments without subscription → stop
 * 2. Subscription status validation with Stripe API
 * 3. Cancel-at-period-end enforcement when billing period ends
 * 4. Past due / unpaid subscriptions → flag with error
 */
export async function enforceSubscriptionStatus(): Promise<void> {

  try {
    const running = await db.query.deployments.findMany({
      where: eq(deployments.status, "running"),
    });

    if (running.length === 0) return;

    logger.debug({ count: running.length }, "subscriptionEnforcement: checking running deployments");

    for (const dep of running) {
      try {
        await checkDeploymentSubscription(dep);
      } catch (err) {
        logger.warn({ deploymentId: dep.id, err }, "subscriptionEnforcement: failed to check deployment");
      }
    }
  } catch (err) {
    logger.error({ err }, "subscriptionEnforcement: sweep failed");
  }
}

async function checkDeploymentSubscription(dep: {
  id: string;
  userId: string;
  isPlatform: boolean;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: Date | null;
  error: string | null;
}): Promise<void> {
  // Platform agents are always allowed to run - no subscription needed
  if (dep.isPlatform) return;

  // All non-platform deployments need a valid subscription
  if (!dep.stripeSubscriptionId) {
    logger.warn(
      { deploymentId: dep.id },
      "subscriptionEnforcement: deployment without subscription, stopping"
    );

    await stopDeployment(dep.id);

    await db.update(deployments)
      .set({
        status: "stopped",
        error: `${SUBSCRIPTION_ERROR_PREFIX} required: no active subscription found`
      })
      .where(eq(deployments.id, dep.id));

    return;
  }

  // Check cancel-at-period-end enforcement
  if (dep.cancelAtPeriodEnd) {
    const now = new Date();
    if (dep.cancelAtPeriodEnd <= now) {
      logger.info(
        { deploymentId: dep.id, cancelAtPeriodEnd: dep.cancelAtPeriodEnd.toISOString() },
        "subscriptionEnforcement: subscription period ended, stopping deployment"
      );

      await stopDeployment(dep.id);

      await db.update(deployments)
        .set({
          status: "stopped",
          error: null,
          stripeSubscriptionId: null
        })
        .where(eq(deployments.id, dep.id));

      return;
    }
  }

  // Validate subscription status with Stripe API
  if (isStripeConfigured()) {
    await validateSubscriptionWithStripe(dep);
  }
}

/**
 * Validate subscription status with Stripe API and enforce accordingly.
 */
async function validateSubscriptionWithStripe(dep: {
  id: string;
  stripeSubscriptionId: string | null;
  cancelledAt?: Date | string | null;
  error: string | null;
}): Promise<void> {
  if (!dep.stripeSubscriptionId) return;

  try {
    const subscription = await getSubscriptionDetails(dep.stripeSubscriptionId);
    const status = subscription.status;
    const cancelAtPeriodEnd = subscription.cancel_at_period_end;
    const currentPeriodEnd = (subscription as any).current_period_end
      ? new Date((subscription as any).current_period_end * 1000)
      : null;

    // Subscription is deleted/canceled - stop deployment
    if (status === "canceled" || status === "incomplete_expired") {
      logger.info(
        { deploymentId: dep.id, status, subscriptionId: dep.stripeSubscriptionId },
        "subscriptionEnforcement: subscription no longer active, stopping"
      );

      await stopDeployment(dep.id);

      await db.update(deployments)
        .set({
          status: "stopped",
          error: `${SUBSCRIPTION_ERROR_PREFIX} canceled. Subscribe again to restart your bot.`,
          stripeSubscriptionId: null
        })
        .where(eq(deployments.id, dep.id));

      return;
    }

    // Payment issues - flag error but don't stop immediately (Stripe retries)
    if (status === "past_due" || status === "unpaid") {
      const existingPaymentError = dep.error?.startsWith(`${SUBSCRIPTION_ERROR_PREFIX} ${status}`);
      if (!existingPaymentError) {
        await db.update(deployments)
          .set({
            error: `${SUBSCRIPTION_ERROR_PREFIX} ${status}: please update your payment method to avoid service interruption.`
          })
          .where(eq(deployments.id, dep.id));

        logger.warn(
          { deploymentId: dep.id, status },
          "subscriptionEnforcement: subscription has payment issues"
        );
      }
      return;
    }

    // Subscription is active - sync cancellation state if needed
    if (status === "active") {
      const updates: Record<string, any> = {};

      if (cancelAtPeriodEnd && currentPeriodEnd) {
        const currentCancelAt = currentPeriodEnd.toISOString();
        updates.cancelAtPeriodEnd = currentCancelAt;
        if (!(dep).cancelledAt) {
          updates.cancelledAt = new Date().toISOString();
        }
      } else if (!cancelAtPeriodEnd) {
        updates.cancelAtPeriodEnd = null;
        updates.cancelledAt = null;
      }

      if (dep.error?.startsWith(SUBSCRIPTION_ERROR_PREFIX)) {
        updates.error = null;
      }

      if (Object.keys(updates).length > 0) {
        await db.update(deployments)
          .set(updates)
          .where(eq(deployments.id, dep.id));
      }
    }
  } catch (err: unknown) {
    const errObj = err as { code?: string; statusCode?: number; message?: string };
    if (errObj.code === "resource_missing" || errObj.statusCode === 404) {
      logger.warn(
        { deploymentId: dep.id, subscriptionId: dep.stripeSubscriptionId, err: errObj.message },
        "subscriptionEnforcement: subscription not found in Stripe, stopping deployment"
      );

      await stopDeployment(dep.id);

      await db.update(deployments)
        .set({
          status: "stopped",
          error: `${SUBSCRIPTION_ERROR_PREFIX} not found. Please contact support or subscribe again.`,
          stripeSubscriptionId: null
        })
        .where(eq(deployments.id, dep.id));

      return;
    }

    logger.error(
      { deploymentId: dep.id, subscriptionId: dep.stripeSubscriptionId, err },
      "subscriptionEnforcement: failed to validate subscription with Stripe"
    );
  }
}

/**
 * Check for orphaned deployments: running without subscriptions.
 */
export async function cleanupOrphanedDeployments(): Promise<void> {

  try {
    const orphaned = await db.query.deployments.findMany({
      where: and(
        eq(deployments.status, "running"),
        eq(deployments.isPlatform, false),
        or(
          isNull(deployments.stripeSubscriptionId),
          eq(deployments.stripeSubscriptionId, "")
        )
      ),
    });

    if (orphaned.length === 0) return;

    logger.warn(
      { count: orphaned.length },
      "subscriptionEnforcement: found orphaned deployments without subscriptions"
    );

    for (const dep of orphaned) {
      try {
        logger.info({ deploymentId: dep.id }, "subscriptionEnforcement: stopping orphaned deployment");

        await stopDeployment(dep.id);

        await db.update(deployments)
          .set({
            status: "stopped",
            error: `${SUBSCRIPTION_ERROR_PREFIX} required: no active subscription found for this deployment.`
          })
          .where(eq(deployments.id, dep.id));
      } catch (err) {
        logger.error({ deploymentId: dep.id, err }, "subscriptionEnforcement: failed to stop orphaned deployment");
      }
    }
  } catch (err) {
    logger.error({ err }, "subscriptionEnforcement: orphan cleanup failed");
  }
}

/**
 * Start the periodic subscription enforcement check.
 */
export function startSubscriptionEnforcement(
  intervalMs: number = 5 * 60 * 1000,
  orphanIntervalMs: number = 30 * 60 * 1000
): { primaryTimer: NodeJS.Timeout; orphanTimer: NodeJS.Timeout } {
  logger.info(
    { intervalMs, orphanIntervalMs },
    "subscriptionEnforcement: starting periodic subscription checks"
  );

  safeFireAndForget(enforceSubscriptionStatus(), { operation: "enforceSubscriptionStatus" });
  safeFireAndForget(cleanupOrphanedDeployments(), { operation: "cleanupOrphanedDeployments" });

  const primaryTimer = setInterval(() => safeFireAndForget(enforceSubscriptionStatus(), { operation: "enforceSubscriptionStatus" }), intervalMs);
  const orphanTimer = setInterval(() => safeFireAndForget(cleanupOrphanedDeployments(), { operation: "cleanupOrphanedDeployments" }), orphanIntervalMs);

  return { primaryTimer, orphanTimer };
}

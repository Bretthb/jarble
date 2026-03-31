import { eq, inArray } from "drizzle-orm";
import { db, tables, USE_SQLITE } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { env } from "../utils/env.js";
import { logAdminAction } from "./auditLog.js";
import { isStripeConfigured, cancelSubscriptionImmediately } from "./stripe.js";

/**
 * Permanently delete a user account and all associated data.
 *
 * Cascade order:
 *   1. Cancel Stripe subscriptions
 *   2. Delete K8s resources for each deployment
 *   3. Delete DB records (child tables first to avoid FK violations)
 *   4. Delete Auth0 user
 *
 * Errors in external services (Stripe, K8s, Auth0) are logged but do NOT
 * block deletion - the user's data is removed regardless.
 */
export async function deleteAccount(params: {
  userId: string;
  auth0Id: string;
  email: string;
  ipAddress: string | null;
}): Promise<void> {
  const { userId, auth0Id, email, ipAddress } = params;
  const startMs = Date.now();
  logger.info({ userId }, "Account deletion started");

  // ── Fetch user's deployments ──────────────────────────────────────────
  const userDeployments = await db.query.deployments.findMany({
    where: eq(tables.deployments.userId, userId),
  });

  const deploymentIds = userDeployments.map((d) => d.id);

  logger.info(
    { userId, deploymentCount: deploymentIds.length },
    "Account deletion: found deployments"
  );

  // ── 1. Cancel Stripe subscriptions ────────────────────────────────────
  if (isStripeConfigured()) {
    for (const dep of userDeployments) {
      if (!dep.stripeSubscriptionId) continue;
      try {
        await cancelSubscriptionImmediately(dep.stripeSubscriptionId);
        logger.info(
          { userId, deploymentId: dep.id, subscriptionId: dep.stripeSubscriptionId },
          "Account deletion: Stripe subscription canceled"
        );
      } catch (err) {
        logger.error(
          { userId, deploymentId: dep.id, subscriptionId: dep.stripeSubscriptionId, err },
          "Account deletion: failed to cancel Stripe subscription - continuing"
        );
      }
    }
  }

  // ── 2. Delete K8s resources ───────────────────────────────────────────
  if (!USE_SQLITE) {
    try {
      const { deleteDeployment } = await import("../k8s/lifecycle.js");
      for (const depId of deploymentIds) {
        try {
          await deleteDeployment(depId);
          logger.info({ userId, deploymentId: depId }, "Account deletion: K8s resources deleted");
        } catch (err) {
          logger.error(
            { userId, deploymentId: depId, err },
            "Account deletion: failed to delete K8s resources - continuing"
          );
        }
      }
    } catch (err) {
      logger.error({ userId, err }, "Account deletion: failed to load K8s module - continuing");
    }
  } else {
    logger.info({ userId }, "Account deletion: skipping K8s cleanup (SQLite/local dev)");
  }

  // ── 3. Write audit log BEFORE deleting DB records ─────────────────────
  await logAdminAction({
    userId,
    action: "account_deleted",
    targetType: "user",
    targetId: userId,
    metadata: {
      email,
      auth0Id,
      deploymentCount: deploymentIds.length,
      deploymentIds,
    },
    ipAddress: ipAddress ?? undefined,
  });

  // ── 4. Delete DB records (child tables first) ─────────────────────────
  if (deploymentIds.length > 0) {
    // Chat messages → via chat sessions
    const userChatSessions = await db.query.chatSessions.findMany({
      where: inArray(tables.chatSessions.deploymentId, deploymentIds),
      columns: { id: true },
    });
    const sessionIds = userChatSessions.map((s) => s.id);

    if (sessionIds.length > 0) {
      await db.delete(tables.chatMessages).where(
        inArray(tables.chatMessages.sessionId, sessionIds)
      );
    }

    // Chat sessions
    await db.delete(tables.chatSessions).where(
      inArray(tables.chatSessions.deploymentId, deploymentIds)
    );

    // Deployment skills
    await db.delete(tables.deploymentSkills).where(
      inArray(tables.deploymentSkills.deploymentId, deploymentIds)
    );

    // Platform credentials
    await db.delete(tables.platformCredentials).where(
      inArray(tables.platformCredentials.deploymentId, deploymentIds)
    );

    // Component installs
    await db.delete(tables.componentInstalls).where(
      inArray(tables.componentInstalls.deploymentId, deploymentIds)
    );

    // Deployments
    await db.delete(tables.deployments).where(
      inArray(tables.deployments.id, deploymentIds)
    );
  }

  // Component purchases (references userId, not deploymentId)
  await db.delete(tables.componentPurchases).where(
    eq(tables.componentPurchases.userId, userId)
  );

  // Component reviews (references userId)
  await db.delete(tables.componentReviews).where(
    eq(tables.componentReviews.userId, userId)
  );

  // Creator profile (references userId)
  await db.delete(tables.creatorProfiles).where(
    eq(tables.creatorProfiles.userId, userId)
  );

  // Marketplace components authored by this user
  await db.delete(tables.marketplaceComponents).where(
    eq(tables.marketplaceComponents.creatorId, userId)
  );

  // Audit logs: delete to satisfy FK constraint (audit record already written above)
  await db.delete(tables.auditLogs).where(
    eq(tables.auditLogs.userId, userId)
  );

  // User record
  await db.delete(tables.users).where(eq(tables.users.id, userId));
  logger.info({ userId }, "Account deletion: DB records deleted");

  // ── 5. Delete Auth0 user ──────────────────────────────────────────────
  if (env.AUTH0_MGMT_CLIENT_ID && env.AUTH0_MGMT_CLIENT_SECRET) {
    try {
      // Get Management API access token
      const tokenRes = await fetch(`https://${env.AUTH0_DOMAIN}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: env.AUTH0_MGMT_CLIENT_ID,
          client_secret: env.AUTH0_MGMT_CLIENT_SECRET,
          audience: `https://${env.AUTH0_DOMAIN}/api/v2/`,
        }),
      });

      if (!tokenRes.ok) {
        logger.error(
          { userId, status: tokenRes.status },
          "Account deletion: failed to get Auth0 Management API token"
        );
      } else {
        const { access_token } = (await tokenRes.json()) as { access_token: string };

        const deleteRes = await fetch(
          `https://${env.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(auth0Id)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${access_token}` },
          }
        );

        if (!deleteRes.ok && deleteRes.status !== 404) {
          const body = await deleteRes.text();
          logger.error(
            { userId, auth0Id, status: deleteRes.status, body },
            "Account deletion: failed to delete Auth0 user"
          );
        } else {
          logger.info({ userId, auth0Id }, "Account deletion: Auth0 user deleted");
        }
      }
    } catch (err) {
      logger.error(
        { userId, auth0Id, err },
        "Account deletion: Auth0 deletion failed - continuing"
      );
    }
  } else {
    logger.info(
      { userId },
      "Account deletion: skipping Auth0 deletion (Management API not configured)"
    );
  }

  const durationMs = Date.now() - startMs;
  logger.info({ userId, durationMs }, "Account deletion completed");
}

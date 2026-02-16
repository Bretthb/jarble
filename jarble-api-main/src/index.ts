import "dotenv/config";
import express from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./trpc/index.js";
import { createContext } from "./trpc/context.js";
import { logger } from "./utils/logger.js";
import { env } from "./utils/env.js";
import { initDatabase } from "./db/init.js";
import { db, tables } from "./db/index.js";
import { verifyToken, getUserFromToken } from "./services/auth.js";
import {
  isStripeConfigured,
  createCheckoutSession,
  createPortalSession,
  constructWebhookEvent,
} from "./services/stripe.js";
import { stopDeployment } from "./k8s/deployment.js";
import { eq } from "drizzle-orm";

const app = express();

// CORS - allow frontend origin
const allowedOrigins = [
  env.FRONTEND_URL,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else if (env.NODE_ENV === "development") {
      // In development, allow any localhost origin
      if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));

// ─── Stripe webhook (MUST be before express.json() — needs raw body) ───
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
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

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;
        const userId = session.metadata?.userId || session.client_reference_id;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string | null;
        const tier = session.metadata?.tier as string | null;

        if (userId) {
          // Update user with Stripe customer ID + store pending subscription for deployment linking
          await (db as any).update(tables.users)
            .set({
              stripeCustomerId: customerId,
              emailVerified: true, // If they can pay, they're verified
              ...(subscriptionId ? { pendingStripeSubscriptionId: subscriptionId } : {}),
              ...(tier ? { pendingStripeTier: tier } : {}),
            })
            .where(eq(tables.users.id, userId));

          logger.info({ userId, customerId, subscriptionId, tier }, "Checkout completed — subscription pending link");
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
          // Find deployment linked to this subscription
          const linked = await db.query.deployments.findFirst({
            where: eq(tables.deployments.stripeSubscriptionId, subscriptionId),
          });

          if (!linked) {
            logger.warn({ subscriptionId }, "No deployment found for updated subscription");
            break;
          }

          const dep = linked as any;
          const updates: Record<string, any> = {};

          // Sync cancellation state (handles cancel/reactivate via Stripe portal)
          if (cancelAtPeriodEnd && !dep.cancelledAt) {
            updates.cancelledAt = new Date().toISOString();
            updates.cancelAtPeriodEnd = currentPeriodEnd?.toISOString() || null;
            logger.info({ deploymentId: linked.id }, "Subscription cancellation synced from Stripe");
          } else if (!cancelAtPeriodEnd && dep.cancelledAt) {
            updates.cancelledAt = null;
            updates.cancelAtPeriodEnd = null;
            logger.info({ deploymentId: linked.id }, "Subscription reactivation synced from Stripe");
          }

          // Sync payment status
          if (status === "past_due" || status === "unpaid") {
            updates.error = `Subscription ${status}: please update your payment method`;
            logger.warn({ deploymentId: linked.id, status }, "Subscription payment issue");
          } else if (status === "active" && dep.error?.startsWith("Subscription ")) {
            // Clear payment-related error when subscription becomes active again
            updates.error = null;
          }

          if (Object.keys(updates).length > 0) {
            await (db as any).update(tables.deployments)
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
          // Find the deployment linked to this subscription (proper WHERE query)
          const linked = await db.query.deployments.findFirst({
            where: eq(tables.deployments.stripeSubscriptionId, subscriptionId),
          });

          if (linked) {
            await stopDeployment(linked.id);
            await (db as any).update(tables.deployments)
              .set({ status: "stopped", error: null })
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
            // Find the deployment linked to this subscription
            const linked = await db.query.deployments.findFirst({
              where: eq(tables.deployments.stripeSubscriptionId, invoiceSubscriptionId),
            });

            if (linked) {
              await (db as any).update(tables.deployments)
                .set({ error: "Payment failed — please update your payment method" })
                .where(eq(tables.deployments.id, linked.id));
              logger.warn({ deploymentId: linked.id, subscriptionId: invoiceSubscriptionId }, "Deployment flagged for payment failure");
            }
          } else {
            // No subscription ID on invoice — find user's deployments by customer ID
            const user = await db.query.users.findFirst({
              where: eq(tables.users.stripeCustomerId, customerId),
            });

            if (user) {
              const userDeployments = await db.query.deployments.findMany({
                where: eq(tables.deployments.userId, user.id),
              });
              for (const dep of userDeployments) {
                if (!(dep as any).isFree && (dep as any).stripeSubscriptionId) {
                  await (db as any).update(tables.deployments)
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

    res.json({ received: true });
  } catch (err) {
    logger.error({ err }, "Stripe webhook error");
    res.status(400).json({ error: "Webhook signature verification failed" });
  }
});

// ─── JSON parsing (after webhook route) ───
app.use(express.json());

// ─── Helper: extract user from Authorization header ───
async function getUserFromRequest(req: express.Request) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  try {
    const payload = await verifyToken(token);
    return await getUserFromToken(payload);
  } catch {
    return null;
  }
}

// ─── Stripe checkout route ───
app.post("/api/stripe/checkout", async (req, res) => {
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Stripe is not configured" });
    return;
  }

  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const tier = req.body.tier || req.body.runtimeSlug; // Frontend sends { tier }, legacy sends { runtimeSlug }
  if (!tier) {
    res.status(400).json({ error: "Missing tier" });
    return;
  }

  // If user already has a Stripe customer, redirect to portal for managing subscriptions
  if (user.stripeCustomerId) {
    res.json({ redirectToPortal: true });
    return;
  }

  try {
    const session = await createCheckoutSession({
      userId: user.id,
      userEmail: user.email,
      tier,
      stripeCustomerId: user.stripeCustomerId,
      successUrl: `${env.FRONTEND_URL}/dashboard?checkout=success`,
      cancelUrl: `${env.FRONTEND_URL}/pricing?checkout=canceled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err, userId: user.id, tier }, "Failed to create checkout session");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ─── Stripe portal route ───
app.post("/api/stripe/portal", async (req, res) => {
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

// ─── Auth0 webhook: email verification ───────────────────────────────────────
// Called by Auth0 Post Email Verification Action when a user verifies their email.
// Authenticated via M2M shared secret in Authorization header.
app.post("/api/auth0/email-verified", async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const m2mSecret = env.AUTH0_M2M_SECRET;

  if (!m2mSecret) {
    logger.warn("Auth0 email-verified webhook called but AUTH0_M2M_SECRET is not configured");
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }

  if (!token || token !== m2mSecret) {
    logger.warn("Auth0 email-verified webhook: invalid or missing token");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { auth0Id, email } = req.body;

  if (!auth0Id) {
    res.status(400).json({ error: "Missing auth0Id" });
    return;
  }

  try {
    const user = await db.query.users.findFirst({
      where: eq(tables.users.auth0Id, auth0Id),
    });

    if (!user) {
      logger.info({ auth0Id, email }, "Email verified webhook: user not found in DB (not yet provisioned)");
      res.json({ received: true, updated: false, reason: "user_not_found" });
      return;
    }

    if (user.emailVerified) {
      logger.info({ userId: user.id }, "Email verified webhook: already verified");
      res.json({ received: true, updated: false, reason: "already_verified" });
      return;
    }

    await (db as any).update(tables.users)
      .set({ emailVerified: true })
      .where(eq(tables.users.id, user.id));

    logger.info({ userId: user.id, email: user.email }, "Email verified via Auth0 webhook");
    res.json({ received: true, updated: true });
  } catch (err) {
    logger.error({ err, auth0Id }, "Email verification webhook error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Health check for K8s probes
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Debug endpoint - dev only
if (env.NODE_ENV === "development") {
  app.get("/debug/db", async (_req, res) => {
    try {
      const users = await db.query.users.findMany();
      const deployments = await db.query.deployments.findMany();
      const runtimeCatalog = await db.query.runtimeCatalog.findMany();

      res.json({
        _info: "Development only - shows all database tables",
        tables: {
          users: { count: users.length, data: users },
          deployments: { count: deployments.length, data: deployments },
          runtimeCatalog: { count: runtimeCatalog.length, data: runtimeCatalog },
        }
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to query database", details: String(err) });
    }
  });

  logger.info("📊 Debug endpoint enabled: /debug/db");
}

// tRPC handler
app.use("/trpc", createExpressMiddleware({
  router: appRouter,
  createContext,
  onError: ({ error, path }) => {
    logger.error({ error: error.message, path }, "tRPC error");
  }
}));

// Start server
async function start() {
  // Initialize database (creates tables for in-memory SQLite, optionally seeds)
  await initDatabase();

  const PORT = env.PORT;
  app.listen(PORT, () => {
    logger.info(`🚀 API server running on port ${PORT}`);
    logger.info(`   Health: http://localhost:${PORT}/health`);
    logger.info(`   tRPC:   http://localhost:${PORT}/trpc`);
    logger.info(`   Stripe: ${isStripeConfigured() ? "✅ configured" : "⚠️  not configured (set STRIPE_SECRET_KEY)"}`);
    logger.info(`   CORS:   ${env.FRONTEND_URL}`);
  });
}

start().catch((err) => {
  logger.error(err, "Failed to start server");
  process.exit(1);
});

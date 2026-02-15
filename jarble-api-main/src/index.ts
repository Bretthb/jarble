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

        if (userId) {
          // Update user with Stripe customer ID and subscription status
          await (db as any).update(tables.users)
            .set({
              stripeCustomerId: customerId,
              emailVerified: true, // If they can pay, they're verified
            })
            .where(eq(tables.users.id, userId));

          logger.info({ userId, customerId }, "User subscription activated");
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as any;
        const customerId = subscription.customer as string;
        logger.info({ customerId, status: subscription.status }, "Subscription updated");
        // TODO: sync tier changes when subscription plan changes
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as any;
        const customerId = subscription.customer as string;
        logger.info({ customerId }, "Subscription canceled");
        // TODO: downgrade user to free tier
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as any;
        const customerId = invoice.customer as string;
        logger.warn({ customerId }, "Payment failed");
        // TODO: flag account, notify user
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

  const { tier } = req.body;
  if (!tier || !["pro", "agency"].includes(tier)) {
    res.status(400).json({ error: "Invalid tier. Must be 'pro' or 'agency'" });
    return;
  }

  // If user already has a Stripe customer, redirect to portal for upgrades/downgrades
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
      const tiers = await db.query.tiers.findMany();

      res.json({
        _info: "Development only - shows all database tables",
        tables: {
          users: { count: users.length, data: users },
          deployments: { count: deployments.length, data: deployments },
          tiers: { count: tiers.length, data: tiers },
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

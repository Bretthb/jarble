import "dotenv/config";
import express from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./trpc/index.js";
import { createContext } from "./trpc/context.js";
import { logger } from "./utils/logger.js";
import { env } from "./utils/env.js";
import { initDatabase } from "./db/init.js";
import { isStripeConfigured } from "./services/stripe.js";
import { startStorageEnforcement } from "./services/storageEnforcement.js";
import { startSubscriptionEnforcement } from "./services/subscriptionEnforcement.js";
import { startStatusReconciler } from "./services/statusReconciler.js";
import { globalLimiter, authLimiter } from "./middleware/rateLimit.js";

// Route modules
import { stripeWebhookHandler, stripeRouter } from "./routes/stripe.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { sseRouter } from "./routes/sse.js";
import { debugRouter } from "./routes/debug.js";
import { tamboAgentRouter } from "./routes/tamboAgent.js";
import { canvasFilesRouter } from "./routes/canvasFiles.js";
import { mcpRouter } from "./routes/mcp.js";

const app = express();

// Trust first proxy (Traefik) so req.ip returns the real client IP
app.set("trust proxy", 1);

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
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "mcp-session-id", "mcp-protocol-version"],
  exposedHeaders: ["mcp-session-id"],
}));

// Global rate limiter — 300 req/min per IP (skips /health, webhooks)
app.use(globalLimiter);

// ─── Stripe webhook (MUST be before express.json() — needs raw body) ───
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);

// ─── JSON parsing (after webhook route) ───
app.use(express.json());

// ─── Route modules ───
app.use("/api/stripe", stripeRouter);
app.use("/api", webhooksRouter);
app.use("/api/deployments", sseRouter);
app.use("/api/tambo-agent", tamboAgentRouter);
app.use("/api/deployments", canvasFilesRouter);
app.use("/api/mcp", mcpRouter);

// Debug endpoints — dev only
if (env.NODE_ENV === "development") {
  app.use("/debug", debugRouter);
  logger.info("Debug endpoints enabled: /debug/db, /debug/deployment/:id/status, /debug/seed-deployment, /debug/deployment/:id/sync-config");
}

// Health check for K8s probes
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// tRPC handler
app.use("/trpc", authLimiter, createExpressMiddleware({
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

  // Start periodic enforcement services (K8s only, skips in mock/SQLite dev mode)
  startStorageEnforcement();
  startSubscriptionEnforcement();
  startStatusReconciler();  // Syncs DB status with K8s reality (fixes "stuck at creating")

  const PORT = env.PORT;
  app.listen(PORT, () => {
    logger.info(`API server running on port ${PORT}`);
    logger.info(`   Health: http://localhost:${PORT}/health`);
    logger.info(`   tRPC:   http://localhost:${PORT}/trpc`);
    logger.info(`   Stripe: ${isStripeConfigured() ? "configured" : "not configured (set STRIPE_SECRET_KEY)"}`);
    logger.info(`   CORS:   ${env.FRONTEND_URL}`);
  });
}

start().catch((err) => {
  logger.error(err, "Failed to start server");
  process.exit(1);
});

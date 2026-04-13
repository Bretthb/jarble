import "./instrument.js";  // Sentry must be imported before all other modules
import "dotenv/config";
import * as Sentry from "@sentry/node";
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
import { startWebhookCleanup } from "./services/webhookCleanup.js";
import { startStuckDeploymentMonitor } from "./services/stuckDeploymentMonitor.js";
import helmet from "helmet";
import { globalLimiter, authLimiter, mutationLimiter } from "./middleware/rateLimit.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { requestLoggingMiddleware } from "./middleware/requestLogging.js";
import { trpcCacheMiddleware } from "./middleware/cache.js";

// Route modules
import { stripeWebhookHandler, stripeRouter } from "./routes/stripe.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { sseRouter } from "./routes/sse.js";
import { debugRouter } from "./routes/debug.js";
import { tamboAgentRouter } from "./routes/tamboAgent.js";
import { canvasFilesRouter } from "./routes/canvasFiles.js";
import { artifactRouter } from "./routes/artifact.js";
import { mcpRouter } from "./routes/mcp.js";
import { diagnoseRouter } from "./routes/diagnose.js";
import { startNodeWatcher } from "./k8s/nodeManager.js";
import { podApiRouter, authenticatePod } from "./routes/podApi.js";
import { teamFilesRouter } from "./routes/teamFiles.js";
import { agentRouter } from "./routes/agentLlm.js";
import { composeRouter } from "./routes/compose.js";
import { botAskRouter } from "./routes/botAsk.js";
import { a2aGatewayRouter } from "./routes/a2aGateway.js";
import { filesRouter } from "./routes/files.js";
import { knowledgeRouter } from "./routes/knowledge.js";
import { attachTerminalWs } from "./routes/terminal.js";
import { betaRouter } from "./routes/beta.js";
import { attachChatControlWs } from "./routes/chatControl.js";
import { attachOrchestrationWs } from "./routes/orchestration.js";
import { flowExecutionRouter } from "./routes/flowExecution.js";
import { flowChatRouter } from "./routes/flowChat.js";
import { promoRouter } from "./routes/promo.js";
import { adminProxyRouter, attachAdminWsProxy } from "./routes/adminProxy.js";

const app = express();

// Trust first proxy (Traefik) so req.ip returns the real client IP
app.set("trust proxy", 1);

// CORS - allow frontend origin
const allowedOrigins = [
  env.FRONTEND_URL,
  ...env.ALLOWED_ORIGINS,
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else if (env.NODE_ENV === "development" && (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))) {
      // In development, allow any localhost origin
      callback(null, true);
    } else {
      // IMPORTANT: pass (null, false) for disallowed origins — NOT an Error.
      // Throwing an Error here bubbles up to the Express global error handler
      // and returns a 500, causing spurious Sentry alerts for every probe from
      // an unlisted origin. (null, false) returns a clean response without
      // the Access-Control-Allow-Origin header, which browsers block correctly.
      callback(null, false);
    }
  },
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "mcp-session-id", "mcp-protocol-version"],
  exposedHeaders: ["mcp-session-id"],
}));

// Security headers (HSTS, X-Content-Type-Options, X-Frame-Options, etc.)
app.use(helmet({
  contentSecurityPolicy: false,  // API-only, no HTML
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// ─── Stripe webhook (MUST be before express.json() AND rate limiter - needs raw body, must not be rate-limited) ───
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);

// Global rate limiter - 300 req/min per IP (after webhook route to avoid rate-limiting Stripe events)
app.use(globalLimiter);

// ─── JSON parsing (after webhook route) ───
// Explicit 10mb limit so normal flow definitions / large system prompts
// succeed, and oversized payloads return 413 not 500 (the default 100KB
// was too small and the error bubbled to the generic 500 handler).
app.use(express.json({ limit: "10mb" }));

// ─── Request ID + logging middleware ───
app.use(requestIdMiddleware);
app.use(requestLoggingMiddleware);

// ─── Route modules ───
app.use("/api/stripe", stripeRouter);
app.use("/api", webhooksRouter);
app.use("/api/deployments", sseRouter);
app.use("/api/tambo-agent", tamboAgentRouter);
app.use("/api/deployments", canvasFilesRouter);
app.use("/api/deployments", artifactRouter);
app.use("/api/mcp", mcpRouter);
app.use("/api/deployments", diagnoseRouter);
app.use("/api/pod", podApiRouter);
app.use("/api/pod/agent", authenticatePod, agentRouter);
app.use("/api/pod/compose", authenticatePod, composeRouter);
app.use("/api/pod/team-files", authenticatePod, teamFilesRouter);
app.use("/api/deployments", botAskRouter);
app.use("/api/deployments", filesRouter);
app.use("/api/deployments", knowledgeRouter);
app.use("/api/a2a", authLimiter, a2aGatewayRouter);
app.use("/api/beta-signup", betaRouter);
app.use("/api/promo", promoRouter);
app.use("/api/flows", authLimiter, flowExecutionRouter);
app.use("/api/flows", authLimiter, flowChatRouter);
app.use("/api/deployments", authLimiter, adminProxyRouter);

// Debug endpoints - gated by ADMIN role (not just NODE_ENV).
// Even on a deployed "development" API, /debug is accessible to the public
// internet, so a simple JWT check is not enough — any authenticated user
// could dump the entire DB. We require the caller to be in ADMIN_USER_IDS.
if (env.NODE_ENV === "development") {
  app.use("/debug", async (req, res, next) => {
    const { verifyToken, getUserFromToken } = await import("./services/auth.js");
    const { isAdmin } = await import("./utils/admin.js");

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      res.status(401).json({ error: "Debug endpoints require authentication" });
      return;
    }
    try {
      const payload = await verifyToken(token);
      const user = await getUserFromToken(payload);
      if (!user || !isAdmin(user.id)) {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  }, debugRouter);
  // Sentry test route also under /debug prefix so it inherits the admin guard
  app.get("/debug/sentry-test", (_req, _res) => { throw new Error("Sentry test error!"); });
  logger.info("Debug endpoints enabled (admin-gated): /debug/db, /debug/deployment/:id/status, /debug/seed-deployment, /debug/deployment/:id/sync-config");
} else {
  // Explicitly block debug routes in production
  app.use("/debug", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
}

// Health check for K8s probes
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Kubero probes hit "/" by default
app.get("/", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// tRPC handler - cache middleware sets Cache-Control on read-heavy queries
// mutationLimiter (30/min) only fires on POST; authLimiter (120/min) covers all
app.use("/trpc", trpcCacheMiddleware(), authLimiter, mutationLimiter, createExpressMiddleware({
  router: appRouter,
  createContext,
  onError: ({ error, path, ctx }) => {
    logger.error({
      error: error.message,
      code: error.code,
      path,
      requestId: (ctx as any)?.requestId,
      userId: (ctx as any)?.user?.id,
      ...(env.NODE_ENV === "development" ? { stack: error.stack } : {}),
    }, "tRPC error");
  }
}));

// Sentry error handler - must be before custom error handler
Sentry.setupExpressErrorHandler(app);

// Global error handler - catches unhandled sync errors in Express routes
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const log = req.log || logger;

  // Payload too large → 413 instead of 500. express.json() throws a
  // PayloadTooLargeError (type: "entity.too.large") when the body exceeds
  // the configured limit. Surface this as a proper client error instead
  // of letting it bubble to the generic 500 path.
  if ((err as any)?.type === "entity.too.large" || (err as any)?.status === 413) {
    if (!res.headersSent) {
      res.status(413).json({ error: "Request body too large (max 10MB)" });
    }
    return;
  }

  // Malformed JSON body → 400 instead of 500
  if (err instanceof SyntaxError && "body" in err) {
    if (!res.headersSent) {
      res.status(400).json({ error: "Malformed JSON in request body" });
    }
    return;
  }

  log.error({ err: err.message, stack: err.stack, method: req.method, url: req.originalUrl }, "Unhandled error");
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start server
async function start() {
  // Initialize database (Postgres via Neon — schema managed by Drizzle migrations)
  await initDatabase();

  // Start periodic enforcement services
  startStorageEnforcement();
  // startSubscriptionEnforcement(); // Disabled until Stripe is fully configured
  startStatusReconciler();  // Syncs DB status with K8s reality (fixes "stuck at creating")
  startWebhookCleanup();      // Purges processedWebhookEvents older than 30 days (every 24h)
  startNodeWatcher();         // Auto-scales Hetzner workers when bot pods go Pending
  if (env.STUCK_MONITOR_ENABLED !== "false") {
    startStuckDeploymentMonitor();  // Alerts on deployments stuck in transitional states >5 min
  }

  const PORT = env.PORT;
  const server = app.listen(PORT, () => {
    logger.info(`API server running on port ${PORT}`);
    logger.info(`   Health: http://localhost:${PORT}/health`);
    logger.info(`   tRPC:   http://localhost:${PORT}/trpc`);
    logger.info(`   Terminal WS: ws://localhost:${PORT}/ws/terminal`);
    logger.info(`   Stripe: ${isStripeConfigured() ? "configured" : "not configured (set STRIPE_SECRET_KEY)"}`);
    logger.info(`   CORS:   ${env.FRONTEND_URL}`);
  });

  // Attach WebSocket terminal server to the HTTP server
  attachTerminalWs(server);

  // Attach chat control WebSocket (feature-gated)
  if (env.ENABLE_CHAT_WS === "true" || env.ENABLE_CHAT_WS === "1") {
    attachChatControlWs(server);
    logger.info(`   Chat WS:  ws://localhost:${PORT}/ws/chat`);
  }

  // Attach orchestration WebSocket (always active)
  attachOrchestrationWs(server);
  logger.info(`   Orch WS:  ws://localhost:${PORT}/ws/orchestration`);

  // Attach admin proxy WebSocket (Control UI iframe)
  attachAdminWsProxy(server);
  logger.info(`   Admin WS: ws://localhost:${PORT}/ws/admin`);
}

start().catch((err) => {
  logger.error(err, "Failed to start server");
  process.exit(1);
});

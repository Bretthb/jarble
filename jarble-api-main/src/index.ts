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
import { startServiceHealthCheck } from "./services/serviceHealthCheck.js";
import { startWebhookCleanup } from "./services/webhookCleanup.js";
import helmet from "helmet";
import { globalLimiter, authLimiter } from "./middleware/rateLimit.js";
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
import { serviceProxyRouter } from "./routes/serviceProxy.js";
import { serviceExecutionRouter } from "./routes/serviceExecution.js";
import { serviceStreamRouter } from "./routes/serviceStream.js";
import { serviceHeartbeatRouter } from "./routes/serviceHeartbeat.js";
import { serviceJobsRouter, startJobCleanup } from "./routes/serviceJobs.js";
import { startNodeWatcher } from "./k8s/nodeManager.js";
import { podApiRouter, authenticatePod } from "./routes/podApi.js";
import { agentRouter } from "./routes/agentLlm.js";
import { composeRouter } from "./routes/compose.js";
import { bridgeFetchRouter } from "./routes/bridgeFetch.js";
import { botAskRouter } from "./routes/botAsk.js";
import { meshGatewayRouter } from "./routes/meshGateway.js";
import { meshDiscoveryRouter, registerAgentCard } from "./routes/meshDiscovery.js";
import { agentHubRouter } from "./routes/agentHub.js";
import { filesRouter } from "./routes/files.js";
import { knowledgeRouter } from "./routes/knowledge.js";
import { attachTerminalWs } from "./routes/terminal.js";
import { betaRouter } from "./routes/beta.js";
import { attachChatControlWs } from "./routes/chatControl.js";
import { attachOrchestrationWs } from "./routes/orchestration.js";
import { flowExecutionRouter } from "./routes/flowExecution.js";
import { flowChatRouter } from "./routes/flowChat.js";

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
    } else if (origin.endsWith(".preview.jarble.ai")) {
      // Allow all preview deployment origins
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
app.use(express.json());

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
app.use("/api/services", serviceProxyRouter);
app.use("/api/services", serviceExecutionRouter);
app.use("/api/services", serviceStreamRouter);
app.use("/api/services", serviceHeartbeatRouter);
app.use("/api/services", serviceJobsRouter);
app.use("/api/pod", podApiRouter);
app.use("/api/pod/agent", authenticatePod, agentRouter);
app.use("/api/pod/compose", authenticatePod, composeRouter);
app.use("/api/deployments", bridgeFetchRouter);
app.use("/api/deployments", botAskRouter);
app.use("/api/deployments", filesRouter);
app.use("/api/deployments", knowledgeRouter);
app.use("/api/mesh", meshGatewayRouter);
app.use("/api/mesh", meshDiscoveryRouter);
app.use("/api/agent-hub", agentHubRouter);
app.use("/api/beta-signup", betaRouter);
app.use("/api/flows", authLimiter, flowExecutionRouter);
app.use("/api/flows", authLimiter, flowChatRouter);

// Debug endpoints - dev only
if (env.NODE_ENV === "development") {
  app.use("/debug", debugRouter);
  app.get("/debug-sentry", (_req, _res) => { throw new Error("Sentry test error!"); });
  logger.info("Debug endpoints enabled: /debug/db, /debug/deployment/:id/status, /debug/seed-deployment, /debug/deployment/:id/sync-config");
}

// A2A agent card - public discovery endpoint
registerAgentCard(app);

// Health check for K8s probes
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Kubero probes hit "/" by default
app.get("/", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// tRPC handler - cache middleware sets Cache-Control on read-heavy queries
app.use("/trpc", trpcCacheMiddleware(), authLimiter, createExpressMiddleware({
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
  // Initialize database (creates tables for in-memory SQLite, optionally seeds)
  await initDatabase();

  // Start periodic enforcement services (K8s only, skips in mock/SQLite dev mode)
  startStorageEnforcement();
  // startSubscriptionEnforcement(); // Disabled until Stripe is fully configured
  startStatusReconciler();  // Syncs DB status with K8s reality (fixes "stuck at creating")
  startServiceHealthCheck();  // Pings remote/hybrid service health endpoints every 5 min
  startWebhookCleanup();      // Purges processedWebhookEvents older than 30 days (every 24h)
  startJobCleanup();          // Cleans up expired async service jobs (hourly)
  startNodeWatcher();         // Auto-scales Hetzner workers when bot pods go Pending

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
}

start().catch((err) => {
  logger.error(err, "Failed to start server");
  process.exit(1);
});

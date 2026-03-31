/**
 * Service Execution Engine
 *
 * Executes skill calls by running handler code in the creator's pod.
 * Unlike serviceProxy.ts which forwards to an external URL, this engine
 * execs handler code directly in the creator's K8s pod via kubectl exec.
 *
 * Route: POST /execute/:serviceId/:skillName
 *
 * Request lifecycle:
 *   1. Parse params: serviceId, skillName from URL, generate requestId
 *   2. Authenticate: Bearer JWT or X-Gateway-Token (same dual-auth as serviceProxy)
 *   3. Look up serviceCredentials for deploymentId + serviceId
 *   4. Look up service from marketplaceServices, check remoteApiConfig exists
 *   5. Parse and validate ServiceCard from remoteApiConfig
 *   6. Find the matching skill by name in ServiceCard
 *   7. Rate limit check (per-deployment+service, from ServiceCard)
 *   8. Circuit breaker check (per-service, tracks consecutive failures)
 *   9. Input schema validation (req.body vs skill.inputSchema)
 *  10. Determine execution mode from skill.executionMode (default: "handler")
 *  11. Execute: handler mode execs JS in creator pod, agent mode is TBD
 *  12. Record circuit breaker success/failure based on result
 *  13. Return result with X-Request-Id header
 */

import crypto, { timingSafeEqual } from "crypto";
import { Router } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";
import { serviceCardSchema, type ServiceCard } from "../services/serviceCard.js";
import { validateJsonSchema } from "../utils/jsonSchemaValidation.js";
import { checkServiceRateLimit } from "../middleware/serviceRateLimit.js";
import { canRequest, recordSuccess, recordFailure } from "../services/circuitBreaker.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { executeHandlerLocally } from "../services/devHandlerRuntime.js";

import type { JsonSchemaObject } from "../utils/jsonSchemaValidation.js";

/**
 * Read the expected gateway token from K8s Secret.
 * Returns null if K8s is unavailable (SQLite dev mode / tests).
 */
async function readGatewayTokenFromK8s(deploymentId: string): Promise<string | null> {
  try {
    const { coreApi } = await import("../k8s/client.js");
    const { NAMESPACE } = await import("../k8s/constants.js");
    const secret = await coreApi.readNamespacedSecret(`secret-${deploymentId}`, NAMESPACE);
    const data = secret.body.data ?? {};
    const tokenB64 = data["OPENCLAW_GATEWAY_TOKEN"];
    return tokenB64 ? Buffer.from(tokenB64, "base64").toString("utf-8") : "";
  } catch {
    return null; // K8s not available
  }
}

const log = createModuleLogger("service-execution");

const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds
const MAX_TIMEOUT_MS = 120_000; // 120 seconds

export const serviceExecutionRouter = Router();

serviceExecutionRouter.post(
  "/execute/:serviceId/:skillName",
  async (req, res) => {
    const { serviceId, skillName } = req.params;

    // ── 1. Request ID tracing ─────────────────────────────────────────────────
    const requestId =
      (req.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID();

    log.info({ serviceId, skillName, requestId }, "Service execution: incoming request");

    // ── 2. Authenticate: Bearer JWT or X-Gateway-Token ────────────────────────
    // The caller must provide a deploymentId header so we know which buyer is invoking.
    const deploymentId = req.headers["x-deployment-id"] as string | undefined;
    if (!deploymentId) {
      res.status(400).set("X-Request-Id", requestId).json({
        error: "Missing X-Deployment-Id header",
      });
      return;
    }

    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const gatewayToken = req.headers["x-gateway-token"] as string | undefined;

    if (bearerToken) {
      // JWT auth - verify token and check deployment ownership
      try {
        const payload = await verifyToken(bearerToken);
        const user = await getUserFromToken(payload);
        if (!user) {
          log.warn({ deploymentId }, "Service execution: bearer token valid but user not found");
          res.status(401).set("X-Request-Id", requestId).json({ error: "Unauthorized" });
          return;
        }

        // Verify the user owns this deployment
        const deployment = await db.query.deployments.findFirst({
          where: eq(tables.deployments.id, deploymentId),
        });
        if (!deployment || deployment.userId !== user.id) {
          log.warn({ deploymentId, userId: user.id }, "Service execution: user does not own deployment");
          res.status(403).set("X-Request-Id", requestId).json({ error: "Forbidden" });
          return;
        }
      } catch {
        log.warn({ deploymentId }, "Service execution: invalid or expired bearer token");
        res.status(401).set("X-Request-Id", requestId).json({ error: "Invalid token" });
        return;
      }
    } else if (gatewayToken) {
      // Gateway token auth - verify against K8s Secret (primary) or DB field (fallback)
      const deployment = await db.query.deployments.findFirst({
        where: eq(tables.deployments.id, deploymentId),
      });
      if (!deployment) {
        log.warn({ deploymentId }, "Service execution: deployment not found for gateway token auth");
        res.status(401).set("X-Request-Id", requestId).json({ error: "Unauthorized" });
        return;
      }

      // Try K8s Secret first (production), fall back to DB field (tests/legacy)
      const k8sToken = await readGatewayTokenFromK8s(deploymentId);
      const expectedToken = k8sToken ?? (deployment as any).gatewayToken;

      if (!expectedToken) {
        log.warn({ deploymentId }, "Service execution: no gateway token configured - rejecting request");
        res.status(401).set("X-Request-Id", requestId).json({ error: "Unauthorized - gateway token not configured" });
        return;
      }
      if (gatewayToken.length !== expectedToken.length ||
          !timingSafeEqual(Buffer.from(gatewayToken), Buffer.from(expectedToken))) {
        log.warn({ deploymentId }, "Service execution: invalid gateway token");
        res.status(401).set("X-Request-Id", requestId).json({ error: "Unauthorized" });
        return;
      }
    } else {
      log.warn({ deploymentId }, "Service execution: no authentication provided");
      res.status(401).set("X-Request-Id", requestId).json({
        error: "Unauthorized - provide Bearer JWT or X-Gateway-Token",
      });
      return;
    }

    // ── 3. Look up serviceCredentials ───────────────────────────────────────────
    const creds = await db.query.serviceCredentials.findFirst({
      where: and(
        eq(tables.serviceCredentials.deploymentId, deploymentId),
        eq(tables.serviceCredentials.packageId, serviceId),
      ),
    });

    if (!creds) {
      log.warn({ deploymentId, serviceId }, "Service execution: credentials not found");
      res.status(404).set("X-Request-Id", requestId).json({
        error: "Service credentials not found for this deployment",
      });
      return;
    }

    // ── 4. Look up service remoteApiConfig ──────────────────────────────────────
    const svc = await db.query.marketplaceServices.findFirst({
      where: eq(tables.marketplaceServices.id, serviceId),
    });

    if (!svc) {
      log.warn({ serviceId }, "Service execution: service not found");
      res.status(404).set("X-Request-Id", requestId).json({ error: "Service not found" });
      return;
    }

    if (!svc.remoteApiConfig) {
      log.warn({ serviceId }, "Service execution: service has no remoteApiConfig");
      res.status(404).set("X-Request-Id", requestId).json({
        error: "Service has no remote API configuration",
      });
      return;
    }

    // ── 5. Parse and validate the ServiceCard ───────────────────────────────────
    let serviceCard: ServiceCard;
    try {
      const raw = JSON.parse(svc.remoteApiConfig);
      const result = serviceCardSchema.safeParse(raw);
      if (!result.success) {
        log.warn({ serviceId, issues: result.error.issues }, "Service execution: invalid ServiceCard");
        res.status(502).set("X-Request-Id", requestId).json({
          error: "Invalid service card configuration",
        });
        return;
      }
      serviceCard = result.data;
    } catch (err) {
      log.warn({ serviceId, err }, "Service execution: failed to parse remoteApiConfig");
      res.status(502).set("X-Request-Id", requestId).json({
        error: "Malformed service card configuration",
      });
      return;
    }

    // ── 6. Find the matching skill by name ──────────────────────────────────────
    const skill = serviceCard.skills.find((s) => s.name === skillName);
    if (!skill) {
      log.warn({ serviceId, skillName }, "Service execution: skill not found in service card");
      res.status(404).set("X-Request-Id", requestId).json({
        error: `Skill "${skillName}" not found in service`,
      });
      return;
    }

    // ── 7. Rate limit check ─────────────────────────────────────────────────────
    const rateLimitResult = await checkServiceRateLimit(
      deploymentId,
      serviceId,
      serviceCard.rateLimits,
    );
    if (!rateLimitResult.allowed) {
      log.warn(
        {
          deploymentId,
          serviceId,
          skillName,
          limitType: rateLimitResult.limitType,
          limit: rateLimitResult.limit,
          current: rateLimitResult.current,
        },
        "Service execution: rate limit exceeded",
      );
      res
        .status(429)
        .set("Retry-After", String(rateLimitResult.retryAfterSeconds))
        .set("X-Request-Id", requestId)
        .json({
          error: `Rate limit exceeded (${rateLimitResult.limitType}: ${rateLimitResult.current}/${rateLimitResult.limit})`,
          retryAfterSeconds: rateLimitResult.retryAfterSeconds,
        });
      return;
    }

    // ── 8. Circuit breaker check ────────────────────────────────────────────────
    const circuitResult = await canRequest(serviceId);
    if (!circuitResult.allowed) {
      log.warn(
        { deploymentId, serviceId, skillName, retryAfterMs: circuitResult.retryAfterMs },
        "Service execution: circuit breaker OPEN",
      );
      const retryAfterSeconds = Math.ceil(circuitResult.retryAfterMs / 1000);
      res
        .status(503)
        .set("Retry-After", String(retryAfterSeconds))
        .set("X-Request-Id", requestId)
        .json({
          error: "Creator pod is temporarily unavailable (circuit breaker open)",
          retryAfterSeconds,
        });
      return;
    }

    // ── 9. Input schema validation ──────────────────────────────────────────────
    const inputValidation = validateJsonSchema(
      req.body ?? {},
      skill.inputSchema as JsonSchemaObject,
    );
    if (!inputValidation.valid) {
      log.warn(
        { deploymentId, serviceId, skillName, errors: inputValidation.errors },
        "Service execution: input schema validation failed",
      );
      res.status(400).set("X-Request-Id", requestId).json({
        error: "Input validation failed",
        details: inputValidation.errors,
      });
      return;
    }

    // ── 10. Determine execution mode ────────────────────────────────────────────
    const executionMode = skill.executionMode ?? "handler";

    // ── 11. Execute ─────────────────────────────────────────────────────────────
    if (executionMode === "agent") {
      // Agent mode - future enhancement. The bot would receive a structured
      // skill call message and respond with JSON. Not yet implemented.
      res.status(501).set("X-Request-Id", requestId).json({
        error: "Agent mode not yet implemented. Use handler mode.",
      });
      return;
    }

    // Handler mode - execute JS handler code in the creator pod
    const creatorDeploymentId = serviceCard.creatorDeploymentId;
    if (!creatorDeploymentId) {
      log.warn({ serviceId }, "Service execution: service has no creator deployment");
      res.status(502).set("X-Request-Id", requestId).json({
        error: "Service has no creator deployment",
      });
      return;
    }

    const handlerCode = skill.handlerCode;
    if (!handlerCode) {
      log.warn({ serviceId, skillName }, "Service execution: skill has no handler code");
      res.status(502).set("X-Request-Id", requestId).json({
        error: "Skill has no handler code defined",
      });
      return;
    }

    // Find creator pod (or fall back to dev-mode local execution)
    let podName: string | null = null;
    let useDevRuntime = false;

    try {
      const { findPodForDeployment } = await import("../k8s/exec.js");
      podName = await findPodForDeployment(creatorDeploymentId);
    } catch {
      // K8s not available - check if we can use dev runtime
      if (process.env.USE_SQLITE === "true") {
        useDevRuntime = true;
        log.info({ serviceId, skillName }, "Service execution: K8s unavailable, using dev handler runtime");
      } else {
        log.error({ serviceId, creatorDeploymentId }, "Service execution: failed to find creator pod");
        await recordFailure(serviceId);
        res.status(503).set("X-Request-Id", requestId).json({
          error: "Failed to locate creator pod",
        });
        return;
      }
    }

    if (!podName && !useDevRuntime) {
      // Pod not found - try dev runtime as fallback if SQLite mode
      if (process.env.USE_SQLITE === "true") {
        useDevRuntime = true;
        log.info({ serviceId, skillName }, "Service execution: pod not found, using dev handler runtime");
      } else {
        log.warn({ serviceId, creatorDeploymentId }, "Service execution: creator pod not available");
        await recordFailure(serviceId);
        res.status(503).set("X-Request-Id", requestId).json({
          error: "Creator pod not available",
        });
        return;
      }
    }

    // ── Dev-mode local execution ───────────────────────────────────────────
    if (useDevRuntime) {
      try {
        const devResult = await executeHandlerLocally(
          serviceId,
          skillName,
          handlerCode,
          req.body ?? {},
        );

        if (devResult.ok) {
          await recordSuccess(serviceId);
          log.info(
            { deploymentId, serviceId, skillName, requestId, mode: "dev" },
            "Service execution: dev handler completed successfully",
          );
          res.status(200).set("X-Request-Id", requestId).json(devResult.result);
        } else {
          await recordFailure(serviceId);
          res.status(500).set("X-Request-Id", requestId).json({
            error: devResult.error ?? "Handler execution failed",
          });
        }
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        await recordFailure(serviceId);
        log.error({ serviceId, skillName, err: e.message, stack: e.stack }, "Service execution: dev handler threw");
        res.status(500).set("X-Request-Id", requestId).json({
          error: `Dev handler execution failed: ${e.message}`,
        });
      }

      void recordUsage(deploymentId, serviceId, skillName).catch(() => {});
      return;
    }

    // Build wrapper script that executes the handler in the pod Node.js runtime.
    // The handler code is a JS function body string - we wrap it in a Function
    // constructor, invoke it with the request body, and print the JSON result.
    const wrapperScript = [
      `const handler = new Function('args', 'context', ${JSON.stringify(handlerCode)});`,
      `const args = ${JSON.stringify(req.body ?? {})};`,
      "const context = { env: { DEPLOYMENT_ID: process.env.DEPLOYMENT_ID } };",
      "Promise.resolve(handler(args, context))",
      '  .then(result => { process.stdout.write(JSON.stringify({ ok: true, result })); })',
      '  .catch(err => { process.stdout.write(JSON.stringify({ ok: false, error: err.message })); });',
    ].join("\n");

    // Resolve timeout: per-service config (capped at MAX_TIMEOUT_MS), or default
    const timeoutMs = serviceCard.timeoutMs
      ? Math.min(serviceCard.timeoutMs, MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;

    try {
      const { execInPod } = await import("../k8s/exec.js");

      // execInPod has no built-in timeout, so we use Promise.race with a timer
      const execPromise = execInPod(podName!, ["node", "-e", wrapperScript]);
      const timeoutPromise = new Promise<never>((_, reject) => {
        const tid = setTimeout(() => {
          reject(new Error(`Skill execution timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        // Don't block process exit
        if (typeof tid === "object" && "unref" in tid) {
          tid.unref();
        }
      });

      const stdout = await Promise.race([execPromise, timeoutPromise]);

      // Parse the JSON result from stdout
      let parsed: { ok: boolean; result?: unknown; error?: string };
      try {
        parsed = JSON.parse(stdout);
      } catch {
        // stdout was not valid JSON - the handler likely printed raw output
        log.warn(
          { serviceId, skillName, requestId, stdout: stdout.slice(0, 500) },
          "Service execution: handler output is not valid JSON",
        );
        await recordFailure(serviceId);
        res.status(500).set("X-Request-Id", requestId).json({
          error: "Handler produced invalid JSON output",
        });
        return;
      }

      if (parsed.ok) {
        // ── 12. Record circuit breaker success ──────────────────────────────
        await recordSuccess(serviceId);

        // Output schema validation (warn-only, non-blocking)
        const responseHeaders: Record<string, string> = {
          "X-Request-Id": requestId,
        };

        if (skill.outputSchema && parsed.result !== undefined) {
          const outputValidation = validateJsonSchema(
            parsed.result,
            skill.outputSchema as JsonSchemaObject,
          );
          if (!outputValidation.valid) {
            log.warn(
              {
                serviceId,
                skillName,
                requestId,
                errors: outputValidation.errors,
              },
              "Service execution: output schema validation mismatch (non-blocking)",
            );
            responseHeaders["X-Jarble-Schema-Warning"] = "output schema mismatch";
          }
        }

        // ── 13. Return result ───────────────────────────────────────────────
        log.info(
          { deploymentId, serviceId, skillName, requestId },
          "Service execution: request completed successfully",
        );

        res.status(200).set(responseHeaders).json(parsed.result);
      } else {
        // Handler returned an error
        await recordFailure(serviceId);
        log.warn(
          { deploymentId, serviceId, skillName, requestId, error: parsed.error },
          "Service execution: handler returned error",
        );
        res.status(500).set("X-Request-Id", requestId).json({
          error: parsed.error ?? "Handler execution failed",
        });
      }
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));

      await recordFailure(serviceId);

      if (e.message.includes("timed out")) {
        log.warn(
          { deploymentId, serviceId, skillName, requestId, creatorDeploymentId, timeoutMs },
          "Service execution: skill execution timed out",
        );
        res.status(504).set("X-Request-Id", requestId).json({
          error: "Skill execution timed out",
        });
      } else {
        log.error(
          { deploymentId, serviceId, skillName, requestId, creatorDeploymentId, err: e.message },
          "Service execution: exec failed",
        );
        res.status(502).set("X-Request-Id", requestId).json({
          error: "Skill execution failed in creator pod",
        });
      }
      return;
    }

    // Fire-and-forget usage recording
    void recordUsage(deploymentId, serviceId, skillName).catch(() => {});
  },
);

/**
 * Record a single request against the service_usage table.
 * Upserts per deployment+service+skill+billingCycle.
 */
async function recordUsage(deploymentId: string, serviceId: string, skillName: string): Promise<void> {
  const now = new Date();
  const billingCycleStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  // Try to find existing record for this billing cycle
  const existing = await (db.query as any).serviceUsage?.findFirst?.({
    where: and(
      eq(tables.serviceUsage.deploymentId, deploymentId),
      eq(tables.serviceUsage.packageId, serviceId),
      eq(tables.serviceUsage.skillName, skillName),
      eq(tables.serviceUsage.billingCycleStart, billingCycleStart),
    ),
  });

  if (existing) {
    await db.update(tables.serviceUsage)
      .set({ requestCount: sql`${tables.serviceUsage.requestCount} + 1` as any })
      .where(eq(tables.serviceUsage.id, existing.id));
  } else {
    // Need to find the serviceInstallId
    const install = await (db.query as any).serviceInstalls?.findFirst?.({
      where: and(
        eq(tables.serviceInstalls.deploymentId, deploymentId),
        eq(tables.serviceInstalls.packageId, serviceId),
      ),
    });
    if (install) {
      await db.insert(tables.serviceUsage).values({
        packageInstallId: install.id,
        deploymentId,
        packageId: serviceId,
        skillName,
        requestCount: 1,
        billingCycleStart,
      } as any);
    }
  }
}

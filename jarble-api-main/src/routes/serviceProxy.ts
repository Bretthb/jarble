/**
 * Service Proxy Route
 *
 * Proxies skill-call requests from buyer pods to creator remote APIs.
 * Adds HMAC-SHA256 signatures and auth headers before forwarding.
 *
 * Route: POST /api/services/proxy/:deploymentId/:serviceId/:skillName
 *
 * Request lifecycle:
 *   1. Look up serviceCredentials row for deploymentId + serviceId
 *   2. Look up the service's remoteApiConfig (ServiceCard JSON)
 *   3. Parse and validate the ServiceCard
 *   4. Find the matching skill definition by name
 *   5. *** Rate limit check (per-deployment+service, from ServiceCard) ***
 *   6. *** Circuit breaker check (per-service, tracks consecutive failures) ***
 *   7. *** Input schema validation (req.body vs skill.inputSchema) ***
 *   8. Decrypt the HMAC signing secret
 *   9. Build outbound request with auth + HMAC headers
 *  10. Forward req.body (tool arguments) to the creator's API
 *  11. Exponential backoff retry for transient 502/503 errors
 *  12. Record circuit breaker success/failure
 *  13. *** Output schema validation (response vs skill.outputSchema, warn-only) ***
 *  14. Return the creator's response (or 202 for async mode)
 */

import crypto, { timingSafeEqual } from "crypto";
import { Router } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { decryptApiKey } from "../utils/encryption.js";
import { signRequest } from "../utils/hmac.js";
import { createModuleLogger } from "../utils/logger.js";
import { serviceCardSchema, type ServiceCard } from "../services/serviceCard.js";
import { validateJsonSchema } from "../utils/jsonSchemaValidation.js";
import { checkServiceRateLimit } from "../middleware/serviceRateLimit.js";
import { canRequest, recordSuccess, recordFailure } from "../services/circuitBreaker.js";
import { validateExternalUrl } from "../utils/urlValidation.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { createAsyncJob, completeAsyncJob } from "./serviceJobs.js";
import { meshGatewayToken } from "./meshGatewayToken.js";

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

const log = createModuleLogger("service-proxy");

const MAX_RESPONSE_BYTES = 1 * 1024 * 1024; // 1 MB
const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds
const MAX_TIMEOUT_MS = 120_000; // 120 seconds - absolute cap

/**
 * Hop-by-hop headers that MUST NOT be forwarded from the upstream response.
 * See RFC 2616 section 13.5.1 / RFC 7230 section 6.1.
 */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  // Also skip headers we set ourselves:
  "content-length",
  "content-encoding",
]);

/**
 * Sleep for a given duration with optional jitter.
 * Jitter adds up to `jitterFraction` of the delay randomly.
 */
function sleepWithJitter(baseMs: number, jitterFraction = 0.5): Promise<void> {
  const jitter = baseMs * jitterFraction * Math.random();
  return new Promise((r) => setTimeout(r, baseMs + jitter));
}

export const serviceProxyRouter = Router();

serviceProxyRouter.post(
  "/proxy/:deploymentId/:serviceId/:skillName",
  async (req, res) => {
    const { deploymentId, serviceId, skillName } = req.params;

    // ── Request ID tracing ──────────────────────────────────────────────────
    // Accept an incoming X-Request-Id or generate one. Forward to the creator
    // API and include in the response for end-to-end tracing.
    const requestId =
      (req.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID();

    log.info({ deploymentId, serviceId, skillName, requestId }, "Service proxy: incoming request");

    // ── 0. Authenticate: Bearer JWT or X-Gateway-Token ──────────────────────
    // Accepts either:
    //   - Bearer JWT: user-initiated calls from the frontend (verifies deployment ownership)
    //   - X-Gateway-Token: pod-to-API calls (validated against the deployment's gateway token)
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const gatewayToken = req.headers["x-gateway-token"] as string | undefined;

    if (bearerToken) {
      // JWT auth - verify token and check deployment ownership
      try {
        const payload = await verifyToken(bearerToken);
        const user = await getUserFromToken(payload);
        if (!user) {
          log.warn({ deploymentId }, "Service proxy: bearer token valid but user not found");
          res.status(401).json({ error: "Unauthorized" });
          return;
        }

        // Verify the user owns this deployment
        const deployment = await db.query.deployments.findFirst({
          where: eq(tables.deployments.id, deploymentId),
        });
        if (!deployment || deployment.userId !== user.id) {
          log.warn({ deploymentId, userId: user.id }, "Service proxy: user does not own deployment");
          res.status(403).json({ error: "Forbidden" });
          return;
        }
      } catch {
        log.warn({ deploymentId }, "Service proxy: invalid or expired bearer token");
        res.status(401).json({ error: "Invalid token" });
        return;
      }
    } else if (gatewayToken) {
      // Gateway token auth - verify against K8s Secret (primary) or DB field (fallback)
      const deployment = await db.query.deployments.findFirst({
        where: eq(tables.deployments.id, deploymentId),
      });
      if (!deployment) {
        log.warn({ deploymentId }, "Service proxy: deployment not found for gateway token auth");
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      // Accept the mesh gateway's own shared secret (same-process internal calls).
      // This is checked first so mesh gateway requests succeed even when K8s is
      // unavailable (e.g. SQLite dev mode).
      if (meshGatewayToken && gatewayToken.length === meshGatewayToken.length &&
          timingSafeEqual(Buffer.from(gatewayToken), Buffer.from(meshGatewayToken))) {
        // Authenticated via mesh gateway shared secret - proceed.
      } else {
        // Try K8s Secret first (production), fall back to DB field (tests/legacy)
        const k8sToken = await readGatewayTokenFromK8s(deploymentId);
        const expectedToken = k8sToken ?? (deployment as any).gatewayToken;

        // Security: ALWAYS reject if we have no expected token to compare against.
        // Previous code allowed requests through when expectedToken was falsy
        // (e.g. K8s Secret lookup failed and no DB fallback). This was a bypass
        // vulnerability - an attacker with any gateway token value could authenticate
        // simply because there was nothing to compare against.
        if (!expectedToken) {
          log.warn({ deploymentId }, "Service proxy: no gateway token configured - rejecting request");
          res.status(401).json({ error: "Unauthorized - gateway token not configured for deployment" });
          return;
        }

        if (gatewayToken.length !== expectedToken.length ||
            !timingSafeEqual(Buffer.from(gatewayToken), Buffer.from(expectedToken))) {
          log.warn({ deploymentId }, "Service proxy: invalid gateway token");
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
      }
    } else {
      log.warn({ deploymentId }, "Service proxy: no authentication provided");
      res.status(401).json({ error: "Unauthorized - provide Bearer JWT or X-Gateway-Token" });
      return;
    }

    // ── 1. Look up serviceCredentials ─────────────────────────────────────────
    const creds = await db.query.serviceCredentials.findFirst({
      where: and(
        eq(tables.serviceCredentials.deploymentId, deploymentId),
        eq(tables.serviceCredentials.packageId, serviceId),
      ),
    });

    if (!creds) {
      log.warn({ deploymentId, serviceId }, "Service proxy: credentials not found");
      res.status(404).json({ error: "Service credentials not found for this deployment" });
      return;
    }

    // ── 2. Look up service remoteApiConfig ────────────────────────────────────
    const svc = await db.query.marketplaceServices.findFirst({
      where: eq(tables.marketplaceServices.id, serviceId),
    });

    if (!svc) {
      log.warn({ serviceId }, "Service proxy: service not found");
      res.status(404).json({ error: "Service not found" });
      return;
    }

    if (!svc.remoteApiConfig) {
      log.warn({ serviceId }, "Service proxy: service has no remoteApiConfig");
      res.status(404).json({ error: "Service has no remote API configuration" });
      return;
    }

    // ── 3. Parse and validate the ServiceCard ─────────────────────────────────
    let serviceCard: ServiceCard;
    try {
      const raw = JSON.parse(svc.remoteApiConfig);
      const result = serviceCardSchema.safeParse(raw);
      if (!result.success) {
        log.warn({ serviceId, issues: result.error.issues }, "Service proxy: invalid ServiceCard");
        res.status(502).json({ error: "Invalid service card configuration" });
        return;
      }
      serviceCard = result.data;
    } catch (err) {
      log.warn({ serviceId, err }, "Service proxy: failed to parse remoteApiConfig");
      res.status(502).json({ error: "Malformed service card configuration" });
      return;
    }

    // ── 4. Find the matching skill by name ────────────────────────────────────
    const skill = serviceCard.skills.find((s) => s.name === skillName);
    if (!skill) {
      log.warn({ serviceId, skillName }, "Service proxy: skill not found in service card");
      res.status(404).json({ error: `Skill "${skillName}" not found in service` });
      return;
    }

    // ── 5. Rate limit check ───────────────────────────────────────────────────
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
        "Service proxy: rate limit exceeded",
      );
      res
        .status(429)
        .set("Retry-After", String(rateLimitResult.retryAfterSeconds))
        .json({
          error: `Rate limit exceeded (${rateLimitResult.limitType}: ${rateLimitResult.current}/${rateLimitResult.limit})`,
          retryAfterSeconds: rateLimitResult.retryAfterSeconds,
        });
      return;
    }

    // ── 6. Circuit breaker check ──────────────────────────────────────────────
    const circuitResult = await canRequest(serviceId);
    if (!circuitResult.allowed) {
      log.warn(
        { deploymentId, serviceId, skillName, retryAfterMs: circuitResult.retryAfterMs },
        "Service proxy: circuit breaker OPEN",
      );
      const retryAfterSeconds = Math.ceil(circuitResult.retryAfterMs / 1000);
      res
        .status(503)
        .set("Retry-After", String(retryAfterSeconds))
        .json({
          error: "Creator API is temporarily unavailable (circuit breaker open)",
          retryAfterSeconds,
        });
      return;
    }

    // ── 7. Input schema validation ────────────────────────────────────────────
    const inputValidation = validateJsonSchema(
      req.body ?? {},
      skill.inputSchema as JsonSchemaObject,
    );
    if (!inputValidation.valid) {
      log.warn(
        { deploymentId, serviceId, skillName, errors: inputValidation.errors },
        "Service proxy: input schema validation failed",
      );
      res.status(400).json({
        error: "Input validation failed",
        details: inputValidation.errors,
      });
      return;
    }

    // ── 8. Decrypt the signing secret ─────────────────────────────────────────
    let signingSecret: string;
    let fallbackSigningSecret: string | null = null;
    try {
      signingSecret = decryptApiKey(creds.signingSecret);

      // During the grace period after rotation, also decrypt the previous
      // secret so we can retry with it if the creator hasn't picked up the
      // new secret yet.
      if (creds.previousSigningSecret && creds.previousSecretExpiresAt) {
        const expiresAt = new Date(creds.previousSecretExpiresAt).getTime();
        if (Date.now() < expiresAt) {
          fallbackSigningSecret = decryptApiKey(creds.previousSigningSecret);
        }
      }
    } catch (err) {
      log.error({ deploymentId, serviceId, err }, "Service proxy: failed to decrypt signing secret");
      res.status(500).json({ error: "Internal configuration error" });
      return;
    }

    // ── 9. Build the outbound request ─────────────────────────────────────────
    // Resolve timeout: per-service config (capped at MAX_TIMEOUT_MS), or default
    const timeoutMs = serviceCard.timeoutMs
      ? Math.min(serviceCard.timeoutMs, MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;

    const targetUrl = `${serviceCard.endpoint}/skills/${skillName}`;

    // Defense-in-depth: validate the constructed URL even though ServiceCard
    // schema already validates the endpoint. This catches edge cases where
    // the endpoint was stored before SSRF validation was added.
    if (!validateExternalUrl(targetUrl)) {
      log.warn({ deploymentId, serviceId, skillName, targetUrl }, "Service proxy: SSRF blocked - target URL points to private/internal network");
      res.status(403).json({ error: "Target URL is blocked for security reasons" });
      return;
    }

    const bodyJson = JSON.stringify(req.body ?? {});

    // Build outbound headers for a given signing secret
    function buildOutboundHeaders(secret: string): Record<string, string> {
      const ts = Date.now();
      const sig = signRequest(secret, ts, bodyJson);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Jarble-Signature": sig,
        "X-Jarble-Timestamp": String(ts),
        "X-Jarble-Deployment-Id": deploymentId,
        "X-Request-Id": requestId,
      };

      // Add auth headers based on the ServiceCard auth config
      const auth = serviceCard.auth;
      if (auth.type === "api_key") {
        headers[auth.headerName] = secret;
      } else if (auth.type === "bearer") {
        headers[auth.headerName] = `Bearer ${secret}`;
      }
      return headers;
    }

    let outboundHeaders = buildOutboundHeaders(signingSecret);

    // ── 9a. Async execution mode ─────────────────────────────────────────────
    if (skill.callMode === "async") {
      try {
        const jobId = await createAsyncJob(deploymentId, serviceId, skillName, bodyJson);
        log.info({ deploymentId, serviceId, skillName, requestId, jobId }, "Service proxy: async job created");

        res.status(202).json({
          jobId,
          pollUrl: `/api/services/jobs/${jobId}`,
          status: "pending",
        });

        // Fire-and-forget: execute the proxy call with retries in the background
        void executeWithRetries(
          targetUrl,
          outboundHeaders,
          bodyJson,
          timeoutMs,
          fallbackSigningSecret ? buildOutboundHeaders(fallbackSigningSecret) : null,
          skill.maxRetries ?? 2,
        ).then(async (result) => {
          if (result.success) {
            await completeAsyncJob(jobId, {
              status: "completed",
              responseBody: result.body,
              responseStatus: result.status,
            });
            await recordSuccess(serviceId);
          } else {
            await completeAsyncJob(jobId, {
              status: "failed",
              errorMessage: result.error,
              responseStatus: result.status,
            });
            await recordFailure(serviceId);
          }
        }).catch(async () => {
          await completeAsyncJob(jobId, {
            status: "failed",
            errorMessage: "Internal proxy error",
          });
          await recordFailure(serviceId);
        });

        // Fire-and-forget usage recording
        void recordUsage(deploymentId, serviceId, skillName).catch(() => {});
        return;
      } catch (err) {
        log.error({ deploymentId, serviceId, skillName, err }, "Service proxy: failed to create async job");
        res.status(500).json({ error: "Failed to create async job" });
        return;
      }
    }

    // ── 10. Forward the request to the creator's API ──────────────────────────
    // Helper: make a single fetch attempt with the configured timeout.
    async function attemptFetch(headers?: Record<string, string>): Promise<Response> {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(targetUrl, {
          method: "POST",
          headers: headers ?? outboundHeaders,
          body: bodyJson,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(tid);
      }
    }

    let upstreamRes: Response;
    const maxRetries = skill.maxRetries ?? 2;
    try {
      upstreamRes = await attemptFetch();

      // ── 10a. Retry with fallback secret on 401 during grace period ────────
      if (upstreamRes.status === 401 && fallbackSigningSecret) {
        log.info(
          { deploymentId, serviceId, skillName, requestId },
          "Service proxy: 401 from creator - retrying with previous signing secret (grace period)",
        );
        outboundHeaders = buildOutboundHeaders(fallbackSigningSecret);
        upstreamRes = await attemptFetch();
      }

      // ── 10b. Exponential backoff retry for transient 502/503 ──────────────
      if (upstreamRes.status === 502 || upstreamRes.status === 503) {
        let lastStatus = upstreamRes.status;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          const delayMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
          log.info(
            { deploymentId, serviceId, skillName, requestId, status: lastStatus, attempt: attempt + 1, delayMs },
            "Service proxy: transient error - retrying with backoff",
          );
          await sleepWithJitter(delayMs);
          upstreamRes = await attemptFetch();
          if (upstreamRes.status !== 502 && upstreamRes.status !== 503) break;
          lastStatus = upstreamRes.status;
        }
      }
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));

      // Record failure for circuit breaker
      await recordFailure(serviceId);

      if (e.name === "AbortError") {
        log.warn({ deploymentId, serviceId, skillName, requestId, targetUrl }, "Service proxy: upstream request timed out");
        res.status(504).json({ error: "Upstream API timed out", requestId });
      } else {
        log.error({ deploymentId, serviceId, skillName, requestId, targetUrl, err: e.message }, "Service proxy: upstream fetch failed");
        res.status(502).json({ error: "Failed to reach creator API", requestId });
      }
      return;
    }

    // ── 11. Circuit breaker: record success/failure based on HTTP status ─────
    if (upstreamRes.status >= 500) {
      await recordFailure(serviceId);
    } else {
      await recordSuccess(serviceId);
    }

    // ── 12. Enforce 1 MB response size limit ────────────────────────────────
    const contentLength = upstreamRes.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      log.warn({ deploymentId, serviceId, skillName, requestId, contentLength }, "Service proxy: response too large");
      res.status(502).json({ error: "Creator API response exceeds size limit", requestId });
      return;
    }

    // ── 12a. Validate upstream content-type before parsing ──────────────────
    const upstreamContentType = upstreamRes.headers.get("content-type") ?? "";
    const isJsonResponse = upstreamContentType.includes("application/json");

    // If it's a success response but not JSON, the creator returned something
    // unexpected (e.g., an HTML error page). Warn but still forward the body.
    if (upstreamRes.status >= 200 && upstreamRes.status < 300 && !isJsonResponse && upstreamContentType) {
      log.warn(
        { deploymentId, serviceId, skillName, requestId, contentType: upstreamContentType },
        "Service proxy: upstream response is not JSON",
      );
    }

    // Read response body with size enforcement
    let responseBody: string;
    try {
      const reader = upstreamRes.body?.getReader();
      if (!reader) {
        responseBody = "";
      } else {
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        let done = false;

        while (!done) {
          const { value, done: streamDone } = await reader.read();
          done = streamDone;
          if (value) {
            totalBytes += value.byteLength;
            if (totalBytes > MAX_RESPONSE_BYTES) {
              reader.cancel();
              log.warn({ deploymentId, serviceId, skillName, requestId }, "Service proxy: response body exceeded 1MB limit during streaming");
              res.status(502).json({ error: "Creator API response exceeds size limit", requestId });
              return;
            }
            chunks.push(value);
          }
        }

        responseBody = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
      }
    } catch (err) {
      log.error({ deploymentId, serviceId, skillName, requestId, err }, "Service proxy: failed to read upstream response body");
      res.status(502).json({ error: "Failed to read creator API response", requestId });
      return;
    }

    // ── 13. Output schema validation (warn-only) ────────────────────────────
    const responseHeaders: Record<string, string> = {
      "X-Request-Id": requestId,
    };

    // Forward safe upstream response headers (exclude hop-by-hop)
    upstreamRes.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (!HOP_BY_HOP_HEADERS.has(lower) && !lower.startsWith("x-jarble-")) {
        responseHeaders[key] = value;
      }
    });

    if (skill.outputSchema && upstreamRes.status >= 200 && upstreamRes.status < 300) {
      if (!isJsonResponse) {
        // Cannot validate non-JSON response against schema
        responseHeaders["X-Jarble-Schema-Warning"] = "response is not JSON - cannot validate";
      } else {
        try {
          const parsedResponse = JSON.parse(responseBody);
          const outputValidation = validateJsonSchema(
            parsedResponse,
            skill.outputSchema as JsonSchemaObject,
          );
          if (!outputValidation.valid) {
            log.warn(
              {
                deploymentId,
                serviceId,
                skillName,
                requestId,
                errors: outputValidation.errors,
              },
              "Service proxy: output schema validation mismatch (non-blocking)",
            );
            responseHeaders["X-Jarble-Schema-Warning"] = "output schema mismatch";
          }
        } catch {
          log.warn(
            { deploymentId, serviceId, skillName, requestId },
            "Service proxy: response claims JSON content-type but body is not valid JSON",
          );
          responseHeaders["X-Jarble-Schema-Warning"] = "response is not valid JSON";
        }
      }
    }

    // ── 14. Return the creator's response ───────────────────────────────────
    log.info(
      {
        deploymentId,
        serviceId,
        skillName,
        requestId,
        status: upstreamRes.status,
        responseBytes: responseBody.length,
      },
      "Service proxy: request completed",
    );

    res
      .status(upstreamRes.status)
      .set("Content-Type", upstreamContentType || "application/octet-stream")
      .set(responseHeaders)
      .send(responseBody);

    // Fire-and-forget usage recording
    void recordUsage(deploymentId, serviceId, skillName).catch(() => {});
  },
);

// ── Async Execution Helper ──────────────────────────────────────────────────

interface ExecuteResult {
  success: boolean;
  status?: number;
  body?: string;
  error?: string;
}

async function executeWithRetries(
  targetUrl: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
  fallbackHeaders: Record<string, string> | null,
  maxRetries: number,
): Promise<ExecuteResult> {
  async function attempt(hdrs: Record<string, string>): Promise<Response> {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(targetUrl, {
        method: "POST",
        headers: hdrs,
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(tid);
    }
  }

  try {
    let response = await attempt(headers);

    // Retry with fallback on 401
    if (response.status === 401 && fallbackHeaders) {
      response = await attempt(fallbackHeaders);
    }

    // Exponential backoff for 502/503
    if (response.status === 502 || response.status === 503) {
      for (let i = 0; i < maxRetries; i++) {
        const delayMs = 1000 * Math.pow(2, i);
        await sleepWithJitter(delayMs);
        response = await attempt(headers);
        if (response.status !== 502 && response.status !== 503) break;
      }
    }

    const responseBody = await response.text();

    if (response.status >= 500) {
      return { success: false, status: response.status, error: `Upstream returned ${response.status}`, body: responseBody };
    }

    return { success: true, status: response.status, body: responseBody };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    return { success: false, error: e.message };
  }
}

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

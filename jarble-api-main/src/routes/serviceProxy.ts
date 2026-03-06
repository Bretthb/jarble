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
 *  11. Record circuit breaker success/failure
 *  12. *** Output schema validation (response vs skill.outputSchema, warn-only) ***
 *  13. Return the creator's response
 */

import { Router } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { decryptApiKey } from "../utils/encryption.js";
import { signRequest } from "../utils/hmac.js";
import { createModuleLogger } from "../utils/logger.js";
import { serviceCardSchema } from "../services/serviceCard.js";
import { validateJsonSchema } from "../utils/jsonSchemaValidation.js";
import { checkServiceRateLimit } from "../middleware/serviceRateLimit.js";
import { canRequest, recordSuccess, recordFailure } from "../services/circuitBreaker.js";

import type { JsonSchemaObject } from "../utils/jsonSchemaValidation.js";

const log = createModuleLogger("service-proxy");

const MAX_RESPONSE_BYTES = 1 * 1024 * 1024; // 1 MB
const REQUEST_TIMEOUT_MS = 30_000; // 30 seconds

export const serviceProxyRouter = Router();

serviceProxyRouter.post(
  "/proxy/:deploymentId/:serviceId/:skillName",
  async (req, res) => {
    const { deploymentId, serviceId, skillName } = req.params;

    log.info({ deploymentId, serviceId, skillName }, "Service proxy: incoming request");

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
    let serviceCard;
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
    const rateLimitResult = checkServiceRateLimit(
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
    const circuitResult = canRequest(serviceId);
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
    try {
      signingSecret = decryptApiKey(creds.signingSecret);
    } catch (err) {
      log.error({ deploymentId, serviceId, err }, "Service proxy: failed to decrypt signing secret");
      res.status(500).json({ error: "Internal configuration error" });
      return;
    }

    // ── 9. Build the outbound request ─────────────────────────────────────────
    const targetUrl = `${serviceCard.endpoint}/skills/${skillName}`;
    const bodyJson = JSON.stringify(req.body ?? {});
    const timestamp = Date.now();

    // HMAC signature over: `${timestamp}.${bodyJson}`
    const signature = signRequest(signingSecret, timestamp, bodyJson);

    const outboundHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Jarble-Signature": signature,
      "X-Jarble-Timestamp": String(timestamp),
      "X-Jarble-Deployment-Id": deploymentId,
    };

    // Add auth headers based on the ServiceCard auth config
    const auth = serviceCard.auth;
    if (auth.type === "api_key") {
      // API key auth: use the signing secret as the key value
      // The creator generates a separate API key during handshake; for MVP
      // we use the signing secret as the shared credential.
      outboundHeaders[auth.headerName] = signingSecret;
    } else if (auth.type === "bearer") {
      outboundHeaders[auth.headerName] = `Bearer ${signingSecret}`;
    }
    // oauth2_client_credentials: token exchange is out of scope for proxy MVP;
    // the HMAC signature headers are sufficient for creator to authenticate.

    // ── 10. Forward the request to the creator's API ──────────────────────────
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(targetUrl, {
        method: "POST",
        headers: outboundHeaders,
        body: bodyJson,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const e = err instanceof Error ? err : new Error(String(err));

      // Record failure for circuit breaker
      recordFailure(serviceId);

      if (e.name === "AbortError") {
        log.warn({ deploymentId, serviceId, skillName, targetUrl }, "Service proxy: upstream request timed out");
        res.status(504).json({ error: "Upstream API timed out" });
      } else {
        log.error({ deploymentId, serviceId, skillName, targetUrl, err: e.message }, "Service proxy: upstream fetch failed");
        res.status(502).json({ error: "Failed to reach creator API" });
      }
      return;
    } finally {
      clearTimeout(timeoutId);
    }

    // ── 11. Circuit breaker: record success/failure based on HTTP status ─────
    if (upstreamRes.status >= 500) {
      recordFailure(serviceId);
    } else {
      recordSuccess(serviceId);
    }

    // ── 12. Enforce 1 MB response size limit ────────────────────────────────
    const contentLength = upstreamRes.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      log.warn({ deploymentId, serviceId, skillName, contentLength }, "Service proxy: response too large");
      res.status(502).json({ error: "Creator API response exceeds size limit" });
      return;
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
              log.warn({ deploymentId, serviceId, skillName }, "Service proxy: response body exceeded 1MB limit during streaming");
              res.status(502).json({ error: "Creator API response exceeds size limit" });
              return;
            }
            chunks.push(value);
          }
        }

        responseBody = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
      }
    } catch (err) {
      log.error({ deploymentId, serviceId, skillName, err }, "Service proxy: failed to read upstream response body");
      res.status(502).json({ error: "Failed to read creator API response" });
      return;
    }

    // ── 13. Output schema validation (warn-only) ────────────────────────────
    const responseHeaders: Record<string, string> = {};
    const upstreamContentType = upstreamRes.headers.get("content-type") ?? "application/json";

    if (skill.outputSchema && upstreamRes.status >= 200 && upstreamRes.status < 300) {
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
              errors: outputValidation.errors,
            },
            "Service proxy: output schema validation mismatch (non-blocking)",
          );
          responseHeaders["X-Jarble-Schema-Warning"] = "output schema mismatch";
        }
      } catch {
        // Response body is not JSON — can't validate, just warn
        if (upstreamContentType.includes("application/json")) {
          log.warn(
            { deploymentId, serviceId, skillName },
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
        status: upstreamRes.status,
        responseBytes: responseBody.length,
      },
      "Service proxy: request completed",
    );

    res
      .status(upstreamRes.status)
      .set("Content-Type", upstreamContentType)
      .set(responseHeaders)
      .send(responseBody);

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

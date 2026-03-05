/**
 * Package Proxy Route
 *
 * Proxies skill-call requests from buyer pods to creator remote APIs.
 * Adds HMAC-SHA256 signatures and auth headers before forwarding.
 *
 * Route: POST /api/packages/proxy/:deploymentId/:packageId/:skillName
 *
 * Request lifecycle:
 *   1. Look up packageCredentials row for deploymentId + packageId
 *   2. Look up the package's remoteApiConfig (PackageCard JSON)
 *   3. Parse and validate the PackageCard
 *   4. Find the matching skill definition by name
 *   5. *** Rate limit check (per-deployment+package, from PackageCard) ***
 *   6. *** Circuit breaker check (per-package, tracks consecutive failures) ***
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
import { packageCardSchema } from "../services/packageCard.js";
import { validateJsonSchema } from "../utils/jsonSchemaValidation.js";
import { checkPackageRateLimit } from "../middleware/packageRateLimit.js";
import { canRequest, recordSuccess, recordFailure } from "../services/circuitBreaker.js";

import type { JsonSchemaObject } from "../utils/jsonSchemaValidation.js";

const log = createModuleLogger("package-proxy");

const MAX_RESPONSE_BYTES = 1 * 1024 * 1024; // 1 MB
const REQUEST_TIMEOUT_MS = 30_000; // 30 seconds

export const packageProxyRouter = Router();

packageProxyRouter.post(
  "/proxy/:deploymentId/:packageId/:skillName",
  async (req, res) => {
    const { deploymentId, packageId, skillName } = req.params;

    log.info({ deploymentId, packageId, skillName }, "Package proxy: incoming request");

    // ── 1. Look up packageCredentials ─────────────────────────────────────────
    const creds = await db.query.packageCredentials.findFirst({
      where: and(
        eq(tables.packageCredentials.deploymentId, deploymentId),
        eq(tables.packageCredentials.packageId, packageId),
      ),
    });

    if (!creds) {
      log.warn({ deploymentId, packageId }, "Package proxy: credentials not found");
      res.status(404).json({ error: "Package credentials not found for this deployment" });
      return;
    }

    // ── 2. Look up package remoteApiConfig ────────────────────────────────────
    const pkg = await db.query.marketplacePackages.findFirst({
      where: eq(tables.marketplacePackages.id, packageId),
    });

    if (!pkg) {
      log.warn({ packageId }, "Package proxy: package not found");
      res.status(404).json({ error: "Package not found" });
      return;
    }

    if (!pkg.remoteApiConfig) {
      log.warn({ packageId }, "Package proxy: package has no remoteApiConfig");
      res.status(404).json({ error: "Package has no remote API configuration" });
      return;
    }

    // ── 3. Parse and validate the PackageCard ─────────────────────────────────
    let packageCard;
    try {
      const raw = JSON.parse(pkg.remoteApiConfig);
      const result = packageCardSchema.safeParse(raw);
      if (!result.success) {
        log.warn({ packageId, issues: result.error.issues }, "Package proxy: invalid PackageCard");
        res.status(502).json({ error: "Invalid package card configuration" });
        return;
      }
      packageCard = result.data;
    } catch (err) {
      log.warn({ packageId, err }, "Package proxy: failed to parse remoteApiConfig");
      res.status(502).json({ error: "Malformed package card configuration" });
      return;
    }

    // ── 4. Find the matching skill by name ────────────────────────────────────
    const skill = packageCard.skills.find((s) => s.name === skillName);
    if (!skill) {
      log.warn({ packageId, skillName }, "Package proxy: skill not found in package card");
      res.status(404).json({ error: `Skill "${skillName}" not found in package` });
      return;
    }

    // ── 5. Rate limit check ───────────────────────────────────────────────────
    const rateLimitResult = checkPackageRateLimit(
      deploymentId,
      packageId,
      packageCard.rateLimits,
    );
    if (!rateLimitResult.allowed) {
      log.warn(
        {
          deploymentId,
          packageId,
          skillName,
          limitType: rateLimitResult.limitType,
          limit: rateLimitResult.limit,
          current: rateLimitResult.current,
        },
        "Package proxy: rate limit exceeded",
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
    const circuitResult = canRequest(packageId);
    if (!circuitResult.allowed) {
      log.warn(
        { deploymentId, packageId, skillName, retryAfterMs: circuitResult.retryAfterMs },
        "Package proxy: circuit breaker OPEN",
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
        { deploymentId, packageId, skillName, errors: inputValidation.errors },
        "Package proxy: input schema validation failed",
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
      log.error({ deploymentId, packageId, err }, "Package proxy: failed to decrypt signing secret");
      res.status(500).json({ error: "Internal configuration error" });
      return;
    }

    // ── 9. Build the outbound request ─────────────────────────────────────────
    const targetUrl = `${packageCard.endpoint}/skills/${skillName}`;
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

    // Add auth headers based on the PackageCard auth config
    const auth = packageCard.auth;
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
      recordFailure(packageId);

      if (e.name === "AbortError") {
        log.warn({ deploymentId, packageId, skillName, targetUrl }, "Package proxy: upstream request timed out");
        res.status(504).json({ error: "Upstream API timed out" });
      } else {
        log.error({ deploymentId, packageId, skillName, targetUrl, err: e.message }, "Package proxy: upstream fetch failed");
        res.status(502).json({ error: "Failed to reach creator API" });
      }
      return;
    } finally {
      clearTimeout(timeoutId);
    }

    // ── 11. Circuit breaker: record success/failure based on HTTP status ─────
    if (upstreamRes.status >= 500) {
      recordFailure(packageId);
    } else {
      recordSuccess(packageId);
    }

    // ── 12. Enforce 1 MB response size limit ────────────────────────────────
    const contentLength = upstreamRes.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      log.warn({ deploymentId, packageId, skillName, contentLength }, "Package proxy: response too large");
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
              log.warn({ deploymentId, packageId, skillName }, "Package proxy: response body exceeded 1MB limit during streaming");
              res.status(502).json({ error: "Creator API response exceeds size limit" });
              return;
            }
            chunks.push(value);
          }
        }

        responseBody = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
      }
    } catch (err) {
      log.error({ deploymentId, packageId, skillName, err }, "Package proxy: failed to read upstream response body");
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
              packageId,
              skillName,
              errors: outputValidation.errors,
            },
            "Package proxy: output schema validation mismatch (non-blocking)",
          );
          responseHeaders["X-Jarble-Schema-Warning"] = "output schema mismatch";
        }
      } catch {
        // Response body is not JSON — can't validate, just warn
        if (upstreamContentType.includes("application/json")) {
          log.warn(
            { deploymentId, packageId, skillName },
            "Package proxy: response claims JSON content-type but body is not valid JSON",
          );
          responseHeaders["X-Jarble-Schema-Warning"] = "response is not valid JSON";
        }
      }
    }

    // ── 14. Return the creator's response ───────────────────────────────────
    log.info(
      {
        deploymentId,
        packageId,
        skillName,
        status: upstreamRes.status,
        responseBytes: responseBody.length,
      },
      "Package proxy: request completed",
    );

    res
      .status(upstreamRes.status)
      .set("Content-Type", upstreamContentType)
      .set(responseHeaders)
      .send(responseBody);

    // Fire-and-forget usage recording
    void recordUsage(deploymentId, packageId, skillName).catch(() => {});
  },
);

/**
 * Record a single request against the package_usage table.
 * Upserts per deployment+package+skill+billingCycle.
 */
async function recordUsage(deploymentId: string, packageId: string, skillName: string): Promise<void> {
  const now = new Date();
  const billingCycleStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  // Try to find existing record for this billing cycle
  const existing = await (db.query as any).packageUsage?.findFirst?.({
    where: and(
      eq(tables.packageUsage.deploymentId, deploymentId),
      eq(tables.packageUsage.packageId, packageId),
      eq(tables.packageUsage.skillName, skillName),
      eq(tables.packageUsage.billingCycleStart, billingCycleStart),
    ),
  });

  if (existing) {
    await db.update(tables.packageUsage)
      .set({ requestCount: sql`${tables.packageUsage.requestCount} + 1` as any })
      .where(eq(tables.packageUsage.id, existing.id));
  } else {
    // Need to find the packageInstallId
    const install = await (db.query as any).packageInstalls?.findFirst?.({
      where: and(
        eq(tables.packageInstalls.deploymentId, deploymentId),
        eq(tables.packageInstalls.packageId, packageId),
      ),
    });
    if (install) {
      await db.insert(tables.packageUsage).values({
        packageInstallId: install.id,
        deploymentId,
        packageId,
        skillName,
        requestCount: 1,
        billingCycleStart,
      } as any);
    }
  }
}

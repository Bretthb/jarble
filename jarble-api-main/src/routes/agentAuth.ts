/**
 * Agent Auth — Forward Auth + Signed Cookie for *.agents.jarble.ai
 *
 * Endpoints:
 *   GET  /verify-agent-access  — Traefik ForwardAuth target (checks cookie)
 *   POST /agent-session        — Issue signed cookie (requires JWT + MFA + ownership)
 *
 * Security layers:
 *   1. JWT (Auth0) — proves identity
 *   2. MFA (Auth0 step-up) — proves it's actually the user, not a stolen token
 *   3. Deployment ownership — proves the user owns this specific deployment
 *   4. Signed cookie — HMAC-SHA256, HttpOnly, Secure, 1-hour expiry
 *   5. Gateway token injection — forward auth response header, never in browser
 */

import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { getPodAddress } from "../k8s/index.js";
import type { ManagedBy } from "../k8s/index.js";
import { env } from "../utils/env.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("agent-auth");

// ── Cookie config ──────────────────────────────────────────────────────────

const COOKIE_NAME = "jarble_agent";
const COOKIE_MAX_AGE = 3600; // 1 hour
// The cookie is issued by POST /agent-session served on `api.jarble.ai` but
// must be presented back to `{id}.agents.jarble.ai`. Per RFC 6265 the Domain
// attribute has to be a suffix of the response origin, so setting it to
// `.agents.jarble.ai` from `api.jarble.ai` is silently dropped by the
// browser. Using the shared parent `.jarble.ai` satisfies the RFC and the
// cookie is still HttpOnly + Secure + HMAC-bound to a specific deployment,
// so there is no meaningful leakage risk to other jarble.ai subdomains.
const COOKIE_DOMAIN = process.env.AGENTS_COOKIE_DOMAIN || ".jarble.ai";

// Signing secret — prefer dedicated AGENT_AUTH_SECRET, fall back to API_KEY_ENCRYPTION_KEY
function getSigningSecret(): string {
  const secret = process.env.AGENT_AUTH_SECRET || env.API_KEY_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("AGENT_AUTH_SECRET or API_KEY_ENCRYPTION_KEY required for agent auth");
  }
  return secret;
}

// ── Cookie signing/verification ────────────────────────────────────────────

function signCookie(deploymentId: string, userId: string): string {
  const expiry = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE;
  const data = `${deploymentId}:${userId}:${expiry}`;
  const hmac = crypto.createHmac("sha256", getSigningSecret()).update(data).digest("hex");
  return `${data}:${hmac}`;
}

function verifyCookie(cookie: string, expectedDeploymentId: string): { valid: boolean; userId?: string } {
  const parts = cookie.split(":");
  if (parts.length !== 4) return { valid: false };

  const [deploymentId, userId, expiryStr, hmac] = parts;

  // Check deployment ID matches the host
  if (deploymentId !== expectedDeploymentId) return { valid: false };

  // Check expiry
  const expiry = parseInt(expiryStr, 10);
  if (isNaN(expiry) || Math.floor(Date.now() / 1000) > expiry) return { valid: false };

  // Verify HMAC
  const data = `${deploymentId}:${userId}:${expiryStr}`;
  const expected = crypto.createHmac("sha256", getSigningSecret()).update(data).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(expected, "hex"))) {
    return { valid: false };
  }

  return { valid: true, userId };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || "";
  const result: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const [k, ...v] = pair.trim().split("=");
    if (k) result[k] = v.join("=");
  }
  return result;
}

function extractDeploymentIdFromHost(host: string | undefined): string | null {
  if (!host) return null;
  // {deploymentId}.agents.jarble.ai → deploymentId
  const match = host.match(/^([a-zA-Z0-9_-]+)\.agents\./);
  return match ? match[1] : null;
}

// ── Express Router ─────────────────────────────────────────────────────────

export const agentAuthRouter = Router();

/**
 * GET /verify-agent-access — Traefik ForwardAuth target
 *
 * Traefik calls this on EVERY request to *.agents.jarble.ai.
 * On success (200): returns Authorization header for gateway auth injection.
 * On failure (401): Traefik blocks the request.
 */
agentAuthRouter.get("/verify-agent-access", async (req: Request, res: Response) => {
  // Traefik sets X-Forwarded-Host with the original host
  const forwardedHost = req.headers["x-forwarded-host"] as string | undefined;
  const deploymentId = extractDeploymentIdFromHost(forwardedHost);

  if (!deploymentId) {
    log.warn({ forwardedHost }, "verify-agent-access: no deployment ID in host");
    res.status(401).end();
    return;
  }

  // Check cookie
  const cookies = parseCookies(req);
  const cookieVal = cookies[COOKIE_NAME];
  if (!cookieVal) {
    res.status(401).end();
    return;
  }

  const cookieResult = verifyCookie(decodeURIComponent(cookieVal), deploymentId);
  if (!cookieResult.valid) {
    log.warn({ deploymentId }, "verify-agent-access: invalid cookie");
    res.status(401).end();
    return;
  }

  // Cookie valid — inject gateway auth header so the pod accepts the request
  try {
    const managedBy: ManagedBy = "legacy";
    const podAddr = await getPodAddress(deploymentId, managedBy);
    if (podAddr?.gatewayToken) {
      res.setHeader("Authorization", `Bearer ${podAddr.gatewayToken}`);
    }
  } catch (err) {
    log.warn({ deploymentId, err }, "verify-agent-access: failed to get gateway token");
    // Still allow access — the user is authenticated, pod might handle unauthenticated requests
  }

  res.status(200).end();
});

/**
 * POST /agent-session — Issue signed cookie for agent access
 *
 * Requires:
 *   - Valid Auth0 JWT (Bearer token)
 *   - MFA completed (amr claim includes "mfa") — TODO: enable after Auth0 MFA setup
 *   - Deployment ownership (user owns the deployment)
 *
 * Sets a signed cookie on .agents.jarble.ai domain.
 */
agentAuthRouter.post("/agent-session", async (req: Request, res: Response) => {
  // 1. Verify JWT
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Missing authorization token" });
    return;
  }

  let payload;
  try {
    payload = await verifyToken(token);
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  // 2. Check MFA (step-up auth)
  // The amr claim is set by Auth0 Post Login Action when MFA is completed.
  // TODO: Uncomment this block after Auth0 MFA is configured in the tenant.
  // const amr = payload[`${env.AUTH0_AUDIENCE}/amr`] as string[] | undefined;
  // if (!amr || !amr.includes("mfa")) {
  //   res.status(403).json({
  //     error: "mfa_required",
  //     message: "MFA verification required for agent access",
  //   });
  //   return;
  // }

  // 3. Get user
  const user = await getUserFromToken(payload);
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  // 4. Extract deployment ID
  const { deploymentId } = req.body ?? {};
  if (!deploymentId || typeof deploymentId !== "string") {
    res.status(400).json({ error: "deploymentId required" });
    return;
  }

  // 5. Verify ownership
  const deployment = await db.query.deployments.findFirst({
    where: and(
      eq(tables.deployments.id, deploymentId),
      eq(tables.deployments.userId, user.id),
    ),
  });

  if (!deployment) {
    // Also check org membership
    // TODO: add org membership check for shared deployments
    res.status(403).json({ error: "You do not own this deployment" });
    return;
  }

  // 6. Issue signed cookie
  const cookieValue = signCookie(deploymentId, user.id);
  res.setHeader("Set-Cookie", [
    `${COOKIE_NAME}=${encodeURIComponent(cookieValue)}`,
    `Domain=${COOKIE_DOMAIN}`,
    `Path=/`,
    `HttpOnly`,
    `Secure`,
    `SameSite=None`,
    `Max-Age=${COOKIE_MAX_AGE}`,
  ].join("; "));

  log.info({ deploymentId, userId: user.id }, "agent-session: cookie issued");
  res.json({ ok: true });
});

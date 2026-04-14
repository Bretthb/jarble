/**
 * Open WebUI Proxy — reverse proxy to the Open WebUI sidecar container
 *
 * Routes:
 *   GET/POST /api/deployments/:id/webui/*  — HTTP proxy to pod:8080
 *
 * Auth: Bearer JWT header OR ?token= query param (for iframe loads).
 * Sets an HttpOnly session cookie on first auth so iframe sub-resources
 * (CSS, JS, images, API calls) don't need the JWT on every request.
 */

import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { getPodAddress } from "../k8s/index.js";
import type { ManagedBy } from "../k8s/index.js";
import { OPEN_WEBUI_PORT } from "../k8s/constants.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("webui-proxy");

// ── Session cookie for iframe sub-resource auth ──────────────────────────

const COOKIE_NAME = "jarble_webui_session";
const COOKIE_SECRET = crypto.randomBytes(32).toString("hex");
const COOKIE_MAX_AGE = 3600; // 1 hour

function signCookie(deploymentId: string, userId: string): string {
  const data = `${deploymentId}:${userId}:${Math.floor(Date.now() / 1000)}`;
  const sig = crypto.createHmac("sha256", COOKIE_SECRET).update(data).digest("hex");
  return `${data}:${sig}`;
}

function verifyCookie(cookie: string): { deploymentId: string; userId: string } | null {
  const parts = cookie.split(":");
  if (parts.length !== 4) return null;
  const [deploymentId, userId, ts, sig] = parts;
  const data = `${deploymentId}:${userId}:${ts}`;
  const expected = crypto.createHmac("sha256", COOKIE_SECRET).update(data).digest("hex");
  if (sig !== expected) return null;
  const age = Math.floor(Date.now() / 1000) - parseInt(ts, 10);
  if (age > COOKIE_MAX_AGE) return null;
  return { deploymentId, userId };
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || "";
  const result: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const [k, ...v] = pair.trim().split("=");
    if (k) result[k] = v.join("=");
  }
  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function resolveUser(req: Request) {
  const authHeader = req.headers.authorization;
  let token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) token = (req.query.token as string) || null;
  if (!token) return null;

  try {
    const payload = await verifyToken(token);
    return getUserFromToken(payload);
  } catch {
    return null;
  }
}

async function verifyOwnership(deploymentId: string, userId: string) {
  return db.query.deployments.findFirst({
    where: and(
      eq(tables.deployments.id, deploymentId),
      eq(tables.deployments.userId, userId),
    ),
  });
}

// ── Express Router ─────────────────────────────────────────────────────────

export const openWebUiProxyRouter = Router();

/**
 * ALL /:id/webui/* — reverse-proxy HTTP requests to the Open WebUI
 * sidecar container running on port 8080 inside the deployment pod.
 */
openWebUiProxyRouter.all("/:id/webui/*", async (req: Request, res: Response) => {
  const deploymentId = req.params.id;

  // Auth: try JWT first (initial page load), then fall back to session cookie
  let userId: string | null = null;
  let setSessionCookie = false;

  const user = await resolveUser(req);
  if (user) {
    userId = user.id;
    setSessionCookie = true;
  } else {
    const cookies = parseCookies(req);
    const cookieVal = cookies[COOKIE_NAME];
    if (cookieVal) {
      const session = verifyCookie(decodeURIComponent(cookieVal));
      if (session && session.deploymentId === deploymentId) {
        userId = session.userId;
      }
    }
  }

  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const deployment = await verifyOwnership(deploymentId, userId);
  if (!deployment) { res.status(404).json({ error: "Not found" }); return; }

  const managedBy: ManagedBy = (deployment as any).managedBy ?? "legacy";
  const podAddr = await getPodAddress(deploymentId, managedBy);
  if (!podAddr) { res.status(503).json({ error: "Pod not reachable" }); return; }

  // Set session cookie on the initial authenticated request
  if (setSessionCookie) {
    const cookie = signCookie(deploymentId, userId);
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(cookie)}; Path=/api/deployments/${deploymentId}/webui; HttpOnly; SameSite=None; Secure; Max-Age=${COOKIE_MAX_AGE}`);
  }

  // Build the proxied URL — strip /api/deployments/:id/webui prefix
  const suffix = (req.params as any)[0] || "";
  const upstream = new URL(`http://${podAddr.ip}:${OPEN_WEBUI_PORT}/${suffix}`);

  // Forward query params (except auth-only params)
  for (const [key, val] of Object.entries(req.query)) {
    if (key === "token") continue;
    if (typeof val === "string") upstream.searchParams.set(key, val);
  }

  try {
    // Build request options
    const fetchOpts: RequestInit = {
      method: req.method,
      headers: {
        "Accept": req.headers.accept || "*/*",
        "Content-Type": req.headers["content-type"] || "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    };

    // Forward request body for POST/PUT/PATCH
    if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
      fetchOpts.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    }

    const proxyRes = await fetch(upstream.toString(), fetchOpts);

    res.status(proxyRes.status);

    // Forward response headers
    const ct = proxyRes.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);

    const body = Buffer.from(await proxyRes.arrayBuffer());

    // For the root HTML page, inject a <base> tag so the SPA's absolute
    // asset paths (/static/..., /manifest.json, etc.) resolve through
    // the proxy instead of the API server's root.
    const isHtml = ct?.includes("text/html") && (suffix === "" || suffix === "/");
    if (isHtml) {
      let html = body.toString("utf-8");
      const baseHref = `/api/deployments/${deploymentId}/webui/`;
      html = html.replace("<head>", `<head><base href="${baseHref}">`);
      res.setHeader("Content-Length", Buffer.byteLength(html));
      res.end(html);
    } else {
      const cl = proxyRes.headers.get("content-length");
      if (cl) res.setHeader("Content-Length", cl);
      res.end(body);
    }
  } catch (err) {
    log.error({ err, deploymentId, suffix }, "Open WebUI proxy failed");
    if (!res.headersSent) {
      res.status(502).json({ error: "Open WebUI not reachable" });
    }
  }
});

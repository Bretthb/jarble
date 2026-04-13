/**
 * Admin Proxy — Control UI iframe + chat.inject
 *
 * Provides:
 * - POST /api/deployments/:id/inject  — admin whisper (chat.inject)
 * - GET  /api/deployments/:id/admin/* — HTTP proxy to pod's OpenClaw Control UI (port 18789)
 * - attachAdminWsProxy(server)        — WS proxy at /ws/admin that pipes to pod's gateway WS
 *
 * Auth: Bearer JWT header OR ?token= query param (for iframe loads).
 */

import http from "http";
import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { URL } from "url";
import { eq, and } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { getPodAddress } from "../k8s/index.js";
import type { ManagedBy } from "../k8s/index.js";
import { injectViaGateway } from "../services/openclawGateway.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("admin-proxy");

// ── Session cookie for iframe sub-resource auth ──────────────────────────
// The initial HTML page request carries ?token=JWT. Sub-resource requests
// (CSS, JS, images) don't carry the token. We set an HttpOnly cookie on
// the first authenticated request so subsequent asset loads are authorized.

const COOKIE_NAME = "jarble_admin_session";
const COOKIE_SECRET = crypto.randomBytes(32).toString("hex"); // per-process secret
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
  // Check expiry
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

/** Extract JWT from Authorization header or ?token= query param. */
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

/** Verify the caller owns the deployment. Returns deployment row or null. */
async function verifyOwnership(deploymentId: string, userId: string) {
  return db.query.deployments.findFirst({
    where: and(
      eq(tables.deployments.id, deploymentId),
      eq(tables.deployments.userId, userId),
    ),
  });
}

// ── Express Router ─────────────────────────────────────────────────────────

export const adminProxyRouter = Router();

/**
 * GET /:id/admin-token — return the pod's gateway token so the frontend
 * can build the iframe URL with #token= for auto-connect.
 */
adminProxyRouter.get("/:id/admin-token", async (req: Request, res: Response) => {
  const user = await resolveUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const deploymentId = req.params.id;
  const deployment = await verifyOwnership(deploymentId, user.id);
  if (!deployment) { res.status(404).json({ error: "Not found" }); return; }

  const managedBy: ManagedBy = (deployment as any).managedBy ?? "legacy";
  const podAddr = await getPodAddress(deploymentId, managedBy);
  if (!podAddr) { res.status(503).json({ error: "Pod not reachable" }); return; }

  res.json({ gatewayToken: podAddr.gatewayToken });
});

/**
 * POST /:id/inject — send a whisper message into a running deployment's
 * gateway via the chat.inject method.
 */
adminProxyRouter.post("/:id/inject", async (req: Request, res: Response) => {
  const user = await resolveUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const deploymentId = req.params.id;
  const deployment = await verifyOwnership(deploymentId, user.id);
  if (!deployment) { res.status(404).json({ error: "Not found" }); return; }

  const { message, role = "assistant" } = req.body ?? {};
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }
  if (role !== "assistant" && role !== "system") {
    res.status(400).json({ error: "role must be assistant or system" });
    return;
  }

  const managedBy: ManagedBy = (deployment as any).managedBy ?? "legacy";
  const podAddr = await getPodAddress(deploymentId, managedBy);
  if (!podAddr) { res.status(503).json({ error: "Pod not reachable" }); return; }

  try {
    const result = await injectViaGateway(
      { ip: podAddr.ip, port: podAddr.port, gatewayToken: podAddr.gatewayToken },
      message,
      role,
    );
    res.json(result);
  } catch (err) {
    log.error({ err, deploymentId }, "inject failed");
    res.status(500).json({ error: "Inject failed" });
  }
});

/**
 * GET /:id/admin/* — reverse-proxy HTTP requests to the pod's Control UI
 * running on the same port as the gateway (18789).
 */
adminProxyRouter.get("/:id/admin/*", async (req: Request, res: Response) => {
  const deploymentId = req.params.id;

  // Auth: try JWT first (initial page load), then fall back to session cookie (sub-resources)
  let userId: string | null = null;
  let setSessionCookie = false;

  const user = await resolveUser(req);
  if (user) {
    userId = user.id;
    setSessionCookie = true; // First authenticated request — set cookie for asset loads
  } else {
    // Check session cookie for sub-resource requests (CSS, JS, images)
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
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(cookie)}; Path=/api/deployments/${deploymentId}/admin; HttpOnly; SameSite=None; Secure; Max-Age=${COOKIE_MAX_AGE}`);
  }

  // Build the proxied URL — strip the /api/deployments/:id/admin prefix
  // req.params[0] captures the wildcard portion after /admin/
  const suffix = (req.params as any)[0] || "";
  const upstream = new URL(`http://${podAddr.ip}:${podAddr.port}/${suffix}`);

  // Forward query params except token and gatewayUrl (auth-only, not for pod)
  for (const [key, val] of Object.entries(req.query)) {
    if (key === "token" || key === "gatewayUrl") continue;
    if (typeof val === "string") upstream.searchParams.set(key, val);
  }

  try {
    const proxyRes = await fetch(upstream.toString(), {
      headers: {
        "Authorization": `Bearer ${podAddr.gatewayToken}`,
        "Accept": req.headers.accept || "*/*",
      },
      signal: AbortSignal.timeout(30_000),
    });

    res.status(proxyRes.status);
    // Forward content-type
    const ct = proxyRes.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);

    const body = Buffer.from(await proxyRes.arrayBuffer());

    // For the HTML page: inject the gateway token into the gatewayUrl param
    // so the SPA can auto-connect without showing the login form.
    //
    // The OpenClaw SPA reads ?gatewayUrl= and expects the gateway token as
    // a URL fragment: ws://host:port#token=GATEWAY_TOKEN
    // We enrich the gatewayUrl before the SPA's module scripts execute.
    const isHtml = ct?.includes("text/html") && suffix === "";
    if (isHtml) {
      let html = body.toString("utf-8");

      // Escape the gateway token for safe JS string embedding
      const escapedToken = podAddr.gatewayToken.replace(/[\\'"]/g, "\\$&");

      const autoConnectScript = `<script>
// Jarble: inject gateway token via page hash before SPA init.
// The SPA reads the gateway token from window.location.hash (#token=...).
// The gatewayUrl param sets the WS URL; the hash sets the auth token.
(function() {
  try {
    if (!window.location.hash || !window.location.hash.includes('token=')) {
      window.location.hash = 'token=${escapedToken}';
    }
  } catch(e) {}

  // Also auto-confirm the security dialog if it still appears
  var observer = new MutationObserver(function(mutations) {
    for (var m of mutations) {
      for (var node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        var btns = node.querySelectorAll ? node.querySelectorAll('button') : [];
        for (var btn of btns) {
          var text = (btn.textContent || '').trim().toLowerCase();
          if (text === 'confirm' || text === 'connect' || text === 'yes' || text === 'accept') {
            setTimeout(function() { btn.click(); }, 50);
            observer.disconnect();
            return;
          }
        }
      }
    }
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
  setTimeout(function() { observer.disconnect(); }, 10000);
})();
</script>`;
      // Inject in <head> so it runs before module scripts
      html = html.replace("</head>", autoConnectScript + "</head>");
      res.send(html);
    } else {
      res.send(body);
    }
  } catch (err) {
    log.error({ err, deploymentId, upstream: upstream.toString() }, "admin proxy error");
    res.status(502).json({ error: "Upstream unreachable" });
  }
});

// ── WebSocket Proxy — /ws/admin ────────────────────────────────────────────

export function attachAdminWsProxy(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (url.pathname !== "/ws/admin") return;

    const token = url.searchParams.get("token");
    const deploymentId = url.searchParams.get("deploymentId");

    if (!token || !deploymentId) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    // Authenticate
    let user: Awaited<ReturnType<typeof getUserFromToken>>;
    try {
      const payload = await verifyToken(token);
      user = await getUserFromToken(payload);
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Verify ownership
    const deployment = await verifyOwnership(deploymentId, user.id);
    if (!deployment) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    const managedBy: ManagedBy = (deployment as any).managedBy ?? "legacy";
    const podAddr = await getPodAddress(deploymentId, managedBy);
    if (!podAddr) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }

    // Accept the client WebSocket
    wss.handleUpgrade(request, socket, head, (clientWs) => {
      wss.emit("connection", clientWs);

      // Buffer messages from client until the pod WS is ready
      const clientBuffer: string[] = [];
      let podReady = false;

      // Open WS to pod gateway
      const podWsUrl = `ws://${podAddr.ip}:${podAddr.port}`;
      const podWs = new WebSocket(podWsUrl, {
        origin: `http://${podAddr.ip}:${podAddr.port}`,
        handshakeTimeout: 10_000,
      });

      podWs.on("open", () => {
        podReady = true;
        log.info({ deploymentId }, "Admin WS proxy: pod connected");
        // Flush buffered messages
        for (const msg of clientBuffer) {
          podWs.send(msg);
        }
        clientBuffer.length = 0;
      });

      // Bidirectional pipe
      podWs.on("message", (data) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data.toString());
        }
      });

      clientWs.on("message", (data) => {
        const msg = data.toString();
        if (podReady && podWs.readyState === WebSocket.OPEN) {
          podWs.send(msg);
        } else {
          clientBuffer.push(msg);
        }
      });

      // Cleanup on pod error / close
      podWs.on("error", (err) => {
        log.warn({ err, deploymentId }, "Admin WS proxy: pod error");
        clientBuffer.length = 0;
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(1011, "Pod connection error");
        }
      });

      podWs.on("close", () => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(1000, "Pod disconnected");
        }
      });

      // Cleanup on client close
      clientWs.on("close", () => {
        if (podWs.readyState === WebSocket.OPEN || podWs.readyState === WebSocket.CONNECTING) {
          podWs.close();
        }
      });

      clientWs.on("error", () => {
        if (podWs.readyState === WebSocket.OPEN || podWs.readyState === WebSocket.CONNECTING) {
          podWs.close();
        }
      });
    });
  });
}

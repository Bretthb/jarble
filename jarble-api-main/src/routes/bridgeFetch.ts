/**
 * Bridge Data Fetch - routes sandbox jarble.fetch() requests to MCP tools and services.
 *
 * POST /api/deployments/:id/bridge/fetch
 * Auth: Bearer JWT (user must own the deployment)
 *
 * This is the server-side relay for the sandbox bridge data channel.
 * Sandbox components can't make network requests (CSP), so they send
 * fetch requests via postMessage → frontend bridge → this endpoint.
 *
 * Supported tools:
 *   web_search, web_fetch, news_search, hacker_news, github_search,
 *   npm_search, academic_search, dictionary, currency_exchange,
 *   timezone, country_info, open_library, wikipedia, rss_reader,
 *   url_metadata, service_call
 */
import { Router, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { createModuleLogger } from "../utils/logger.js";

const logger = createModuleLogger("bridgeFetch");

export const bridgeFetchRouter = Router();

// ── Tool executor imports ────────────────────────────────────────────────────
// These are lightweight HTTP-based tools that don't need a pod or MCP server.
// They mirror the MCP server's tool implementations but run server-side.

async function executeWebSearch(payload: { query: string; maxResults?: number }) {
  const q = encodeURIComponent(payload.query);
  const max = payload.maxResults || 5;
  const res = await fetch(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&no_redirect=1`);
  const data: any = await res.json();
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  if (data.AbstractText) {
    results.push({ title: data.Heading || "Result", url: data.AbstractURL || "", snippet: data.AbstractText });
  }
  for (const r of (data.RelatedTopics || []).slice(0, max)) {
    if (r.Text && r.FirstURL) {
      results.push({ title: r.Text.slice(0, 100), url: r.FirstURL, snippet: r.Text });
    }
  }
  return { results, source: "duckduckgo" };
}

async function executeWebFetch(payload: { url: string; maxLength?: number }) {
  if (!payload.url) throw new Error("Missing url");
  const maxLen = payload.maxLength || 10000;
  const res = await fetch(payload.url, {
    headers: { "User-Agent": "JarbleBridge/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  // Strip HTML tags for plain text extraction
  const clean = text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
  return { text: clean, url: payload.url, status: res.status };
}

async function executeNewsSearch(payload: { query: string; maxResults?: number }) {
  const q = encodeURIComponent(payload.query);
  const res = await fetch(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1`);
  const data: any = await res.json();
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  for (const r of (data.RelatedTopics || []).slice(0, payload.maxResults || 5)) {
    if (r.Text && r.FirstURL) {
      results.push({ title: r.Text.slice(0, 100), url: r.FirstURL, snippet: r.Text });
    }
  }
  return { results, source: "duckduckgo" };
}

async function executeCurrencyExchange(payload: { from?: string; to?: string; amount?: number }) {
  const from = (payload.from || "USD").toUpperCase();
  const to = (payload.to || "EUR").toUpperCase();
  const amount = payload.amount || 1;
  const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}&amount=${amount}`);
  return await res.json();
}

async function executeTimezone(payload: { timezone?: string }) {
  const tz = payload.timezone || "UTC";
  const res = await fetch(`https://worldtimeapi.org/api/timezone/${encodeURIComponent(tz)}`);
  return await res.json();
}

async function executeWikipedia(payload: { query: string }) {
  const q = encodeURIComponent(payload.query);
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${q}`);
  const data: any = await res.json();
  return { title: data.title, extract: data.extract, thumbnail: data.thumbnail?.source, url: data.content_urls?.desktop?.page };
}

// ── Tool dispatch ────────────────────────────────────────────────────────────

async function executeServiceCall(
  payload: { service: string; endpoint: string; body?: any },
  deploymentId?: string,
  authHeader?: string,
) {
  if (!payload.service || !payload.endpoint) {
    throw new Error("service_call requires 'service' and 'endpoint' fields");
  }
  if (!deploymentId) {
    throw new Error("service_call requires deployment context");
  }

  // Look up the installed service by display name or ID
  const svcInstall = await db.query.serviceInstalls.findFirst({
    where: eq(tables.serviceInstalls.deploymentId, deploymentId),
  });
  if (!svcInstall) throw new Error("No services installed on this deployment");

  // Find the service matching the name or ID
  const allInstalls = await db.query.serviceInstalls.findMany({
    where: eq(tables.serviceInstalls.deploymentId, deploymentId),
  });

  let serviceId: string | null = null;
  for (const install of allInstalls) {
    const svc = await db.query.marketplaceServices.findFirst({
      where: eq(tables.marketplaceServices.id, install.packageId),
    });
    if (svc && (svc.displayName === payload.service || svc.id === payload.service || svc.name === payload.service)) {
      serviceId = svc.id;
      break;
    }
  }

  if (!serviceId) throw new Error(`Service "${payload.service}" not found or not installed`);

  // Internal redirect to the existing service proxy - reuses all rate limiting,
  // circuit breaking, HMAC signing, input/output validation
  const apiBase = process.env.JARBLE_API_URL ?? process.env.API_BASE_URL ?? "http://localhost:3001";
  const proxyUrl = `${apiBase}/api/services/proxy/${deploymentId}/${serviceId}/${payload.endpoint}`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers.Authorization = authHeader;

  const res = await fetch(proxyUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload.body ?? {}),
    signal: AbortSignal.timeout(30000),
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (!res.ok) throw new Error(`Service call failed (${res.status}): ${text.slice(0, 500)}`);
    return { text, status: res.status };
  }
}

const ALLOWED_TOOLS: Record<string, (payload: any, deploymentId?: string, authHeader?: string) => Promise<any>> = {
  web_search: executeWebSearch,
  web_fetch: executeWebFetch,
  news_search: executeNewsSearch,
  currency_exchange: executeCurrencyExchange,
  timezone: executeTimezone,
  wikipedia: executeWikipedia,
  service_call: executeServiceCall,
};

// ── Route ────────────────────────────────────────────────────────────────────

bridgeFetchRouter.post("/:id/bridge/fetch", async (req: Request, res: Response) => {
  const { id: deploymentId } = req.params;
  const { tool, payload } = req.body;

  if (!tool || typeof tool !== "string") {
    res.status(400).json({ error: "Missing required field: tool" });
    return;
  }

  // Auth: verify JWT and ownership
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Bearer token required" });
    return;
  }

  try {
    const tokenPayload = await verifyToken(authHeader.slice(7));
    const user = await getUserFromToken(tokenPayload);
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    // Verify user owns this deployment
    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, deploymentId),
    });
    if (!deployment || (deployment as any).userId !== user.id) {
      res.status(403).json({ error: "Not authorized for this deployment" });
      return;
    }
  } catch {
    // In dev mode (SQLite), auth may not be configured - allow through
    // But NEVER in production, even if USE_SQLITE is accidentally set
    if (process.env.USE_SQLITE !== "true" || process.env.NODE_ENV === "production") {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
  }

  // Dispatch to tool executor
  const executor = ALLOWED_TOOLS[tool];
  if (!executor) {
    res.status(400).json({ error: `Unknown tool: ${tool}. Available: ${Object.keys(ALLOWED_TOOLS).join(", ")}` });
    return;
  }

  try {
    logger.info({ deploymentId, tool }, "Bridge fetch: executing tool");
    const result = await executor(payload || {}, deploymentId, authHeader || "");
    res.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ deploymentId, tool, err: message }, "Bridge fetch: tool execution failed");
    res.status(500).json({ error: `Tool execution failed: ${message}` });
  }
});

#!/usr/bin/env node
/**
 * Shared utilities for the extensive QA test suite.
 * Provides auth, API client, SSE consumer, assertion helpers, and logging.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Configuration ───────────────────────────────────────────────────────────

export const API_BASE = process.env.QA_API_URL || "https://api.jarble.ai";
export const FRONTEND_BASE = process.env.QA_FRONTEND_URL || "https://dev.jarble.ai";
export const OUT_DIR = join(tmpdir(), "qa-teams-extensive");
mkdirSync(OUT_DIR, { recursive: true });

// ── Token management ────────────────────────────────────────────────────────

const TOKEN_FILE = join(tmpdir(), "jarble_qa_token.txt");

export function getToken() {
  const token = (
    process.env.JARBLE_QA_TOKEN ||
    (existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8") : "")
  ).trim();
  if (!token) {
    console.error("No token. Set JARBLE_QA_TOKEN env var or write to " + TOKEN_FILE);
    process.exit(2);
  }
  return token;
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

export function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/** tRPC query (GET) */
export async function trpcQ(path, input = {}, token) {
  const enc = encodeURIComponent(JSON.stringify({ json: input }));
  const r = await fetch(`${API_BASE}/trpc/${path}?input=${enc}`, {
    headers: authHeaders(token),
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: r.status, body };
}

/** tRPC mutation (POST) with automatic 429 retry */
export async function trpcM(path, input = {}, token, { retries = 3 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const r = await fetch(`${API_BASE}/trpc/${path}`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ json: input }),
    });
    if (r.status === 429 && attempt < retries) {
      const wait = 2000 * (attempt + 1);
      console.log(`    [429] ${path} — retrying in ${wait}ms (attempt ${attempt + 1}/${retries})`);
      await sleep(wait);
      continue;
    }
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: r.status, body };
  }
}

/** Unwrap tRPC response data */
export function unwrap(body) {
  return body?.result?.data?.json;
}

/** Extract error message from tRPC response */
export function errMsg(body) {
  return body?.error?.json?.message || body?.error?.message || JSON.stringify(body).slice(0, 300);
}

// ── SSE chat consumer ───────────────────────────────────────────────────────

/**
 * Send a chat message via the tambo-agent endpoint and collect SSE events.
 * @param {string} deploymentId
 * @param {string} message
 * @param {string} token
 * @param {object} [opts] - { conversationId, sessionId, timeout }
 * @returns {{ events: Array, fullText: string, uiBlocks: Array, durationMs: number }}
 */
export async function chatWithDeployment(deploymentId, message, token, opts = {}) {
  const timeout = opts.timeout || 120_000;
  const conversationId = opts.conversationId || `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const r = await fetch(`${API_BASE}/api/tambo-agent`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        deploymentId,
        messages: [{ role: "user", content: message }],
        conversationId,
        sessionId: opts.sessionId,
      }),
      signal: controller.signal,
    });

    if (!r.ok) {
      return {
        events: [],
        fullText: `HTTP ${r.status}: ${await r.text()}`,
        uiBlocks: [],
        durationMs: Date.now() - start,
        error: true,
        conversationId,
      };
    }

    const events = [];
    const uiBlocks = [];
    let fullText = "";

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            events.push(data);
            // Handle multiple SSE event formats (AG-UI, tambo-agent, legacy)
            if (data.type === "TEXT_DELTA" && data.textDelta) fullText += data.textDelta;
            if (data.type === "TEXT_MESSAGE_CONTENT" && data.delta) fullText += data.delta;
            if (data.type === "TOOL_CALL" && data.component) uiBlocks.push(data);
            if (data.type === "TOOL_CALL_START") uiBlocks.push(data);
          } catch { /* non-JSON SSE line */ }
        }
      }
    }

    return { events, fullText, uiBlocks, durationMs: Date.now() - start, conversationId };
  } catch (e) {
    return {
      events: [],
      fullText: e.name === "AbortError" ? "TIMEOUT" : e.message,
      uiBlocks: [],
      durationMs: Date.now() - start,
      error: true,
      conversationId,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a message to the flow chat endpoint and collect SSE events.
 */
export async function chatWithFlow(flowId, message, token, opts = {}) {
  const timeout = opts.timeout || 120_000;
  const conversationId = opts.conversationId || `qa-flow-${Date.now()}`;

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const r = await fetch(`${API_BASE}/api/flows/${flowId}/chat`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ message, conversationId }),
      signal: controller.signal,
    });

    if (!r.ok) {
      return {
        events: [],
        fullText: `HTTP ${r.status}: ${await r.text()}`,
        durationMs: Date.now() - start,
        error: true,
        conversationId,
      };
    }

    const events = [];
    let fullText = "";

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            events.push(data);
            // Handle multiple SSE event formats
            if (data.type === "TEXT_DELTA" && data.textDelta) fullText += data.textDelta;
            if (data.type === "TEXT_MESSAGE_CONTENT" && data.delta) fullText += data.delta;
            if (data.delta && !data.type?.includes("MESSAGE")) fullText += data.delta;
          } catch { /* non-JSON SSE line */ }
        }
      }
    }

    return { events, fullText, durationMs: Date.now() - start, conversationId };
  } catch (e) {
    return {
      events: [],
      fullText: e.name === "AbortError" ? "TIMEOUT" : e.message,
      durationMs: Date.now() - start,
      error: true,
      conversationId,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Test result tracking ────────────────────────────────────────────────────

export class TestRunner {
  constructor(teamName) {
    this.teamName = teamName;
    this.results = [];
    this.startTime = Date.now();
  }

  pass(name, detail = "") {
    this.results.push({ name, status: "PASS", detail, timestamp: new Date().toISOString() });
    console.log(`  ✓ [PASS] ${name}${detail ? " — " + detail : ""}`);
  }

  fail(name, detail = "") {
    this.results.push({ name, status: "FAIL", detail, timestamp: new Date().toISOString() });
    console.log(`  ✗ [FAIL] ${name}${detail ? " — " + detail : ""}`);
  }

  warn(name, detail = "") {
    this.results.push({ name, status: "WARN", detail, timestamp: new Date().toISOString() });
    console.log(`  ! [WARN] ${name}${detail ? " — " + detail : ""}`);
  }

  skip(name, detail = "") {
    this.results.push({ name, status: "SKIP", detail, timestamp: new Date().toISOString() });
    console.log(`  - [SKIP] ${name}${detail ? " — " + detail : ""}`);
  }

  /** Assert a condition, log pass/fail */
  assert(name, condition, detail = "") {
    if (condition) this.pass(name, detail);
    else this.fail(name, detail);
    return condition;
  }

  summary() {
    const pass = this.results.filter(r => r.status === "PASS").length;
    const fail = this.results.filter(r => r.status === "FAIL").length;
    const warn = this.results.filter(r => r.status === "WARN").length;
    const skip = this.results.filter(r => r.status === "SKIP").length;
    const total = this.results.length;
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);
    return { teamName: this.teamName, pass, fail, warn, skip, total, duration, results: this.results };
  }
}

// ── Rate limiting ───────────────────────────────────────────────────────────

/** Sleep for ms milliseconds. Use between write operations to avoid 429. */
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── File helpers ────────────────────────────────────────────────────────────

export function saveResults(filename, data) {
  writeFileSync(join(OUT_DIR, filename), JSON.stringify(data, null, 2));
}

/** Discover running deployments for testing. Filters to user-owned if possible. */
export async function discoverDeployments(token) {
  const r = await trpcQ("deployment.list", {}, token);
  const all = unwrap(r.body) || [];

  // Get current user ID to filter to owned deployments
  let userId = null;
  try {
    const userRes = await trpcQ("user.me", {}, token);
    userId = unwrap(userRes.body)?.id;
  } catch { /* ignore */ }

  const running = all.filter(d => d.status === "running");
  const owned = userId ? running.filter(d => d.userId === userId) : running;
  return { all, running: owned.length > 0 ? owned : running, userId };
}

/** Find existing flows */
export async function discoverFlows(token) {
  const r = await trpcQ("flows.list", {}, token);
  return unwrap(r.body) || [];
}

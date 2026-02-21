/**
 * Chat Endpoint — Pod proxy for direct OpenClaw conversation.
 *
 * Frontend calls POST /api/tambo-agent with Bearer JWT auth:
 *   1. Verify Auth0 JWT
 *   2. Extract deployment ID from body
 *   3. Verify user owns the deployment
 *   4. If MOCK_K8S → streamMockAgent()
 *   5. Else → connect to pod's OpenClaw gateway via WebSocket → stream response as SSE
 *
 * SSE events:
 *   RUN_STARTED, TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT,
 *   TEXT_MESSAGE_END, TOOL_CALL_START, TOOL_CALL_ARGS,
 *   TOOL_CALL_END, RUN_FINISHED
 */
import { Router } from "express";
import { timingSafeEqual } from "crypto";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";
import { streamMockAgent } from "../services/agentMock.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { getPodAddress } from "../k8s/deployment.js";
import { chatViaGateway } from "../services/openclawGateway.js";

const MOCK_K8S = process.env.MOCK_K8S === "true";

export const tamboAgentRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function sendEvent(res: any, event: Record<string, unknown>) {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

/**
 * Extract deploymentId from the request body.
 * Looks in body.deploymentId first, then state.deploymentId,
 * then scans system messages for JSON with deploymentId.
 */
function extractDeploymentId(body: any): string | null {
  if (body.deploymentId) return body.deploymentId;
  if (body.state?.deploymentId) return body.state.deploymentId;

  const messages = body.messages || [];
  for (const msg of messages) {
    if (msg.role === "system") {
      const text = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c: any) => c.text || "").join("")
          : "";
      try {
        const parsed = JSON.parse(text);
        if (parsed.deploymentId) return parsed.deploymentId;
      } catch {
        // Not JSON, skip
      }
    }
  }
  return null;
}

// ─── Main Chat Endpoint ─────────────────────────────────────────────────────

tamboAgentRouter.post("/", async (req, res) => {
  // 1. Authenticate: Bearer JWT or X-Agent-Secret
  let authenticatedUserId: string | null = null;

  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (bearerToken) {
    try {
      const payload = await verifyToken(bearerToken);
      const user = await getUserFromToken(payload);
      if (user) {
        authenticatedUserId = user.id;
      } else {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    } catch {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
  } else {
    const secret = (env as any).TAMBO_AGENT_SECRET as string | undefined;
    if (secret) {
      const provided = req.headers["x-agent-secret"] as string | undefined;
      if (!provided || !secureCompare(provided, secret)) {
        res.status(401).json({ error: "Invalid agent secret" });
        return;
      }
    } else if (env.NODE_ENV !== "development") {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  // 2. Parse request
  const body = req.body;
  const threadId = body.threadId || nanoid();
  const runId = body.runId || nanoid();

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  // 3. Extract deployment ID
  const deploymentId = extractDeploymentId(body);
  if (!deploymentId) {
    sendEvent(res, { type: "RUN_STARTED", runId, threadId });
    const errMsgId = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId: errMsgId, role: "assistant" });
    sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId: errMsgId, delta: "Could not identify the deployment. Please refresh the page." });
    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId: errMsgId });
    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();
    return;
  }

  // 4. Load deployment
  const deployment = await db.query.deployments.findFirst({
    where: eq(tables.deployments.id, deploymentId),
  });

  if (!deployment) {
    sendEvent(res, { type: "RUN_STARTED", runId, threadId });
    const errMsgId = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId: errMsgId, role: "assistant" });
    sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId: errMsgId, delta: "Deployment not found. It may have been deleted." });
    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId: errMsgId });
    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();
    return;
  }

  // 5. Verify ownership
  if (authenticatedUserId && (deployment as any).userId !== authenticatedUserId) {
    sendEvent(res, { type: "RUN_STARTED", runId, threadId });
    const errMsgId = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId: errMsgId, role: "assistant" });
    sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId: errMsgId, delta: "You don't have access to this deployment." });
    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId: errMsgId });
    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();
    return;
  }

  const dep = deployment as any;
  const agMessages = body.messages || [];

  // Extract last user message
  const lastUserMsg = [...agMessages].reverse().find((m: any) => m.role === "user");
  const lastUserText = lastUserMsg
    ? (typeof lastUserMsg.content === "string"
      ? lastUserMsg.content
      : Array.isArray(lastUserMsg.content)
        ? lastUserMsg.content.map((c: any) => c.text || "").join("")
        : "")
    : "";

  // Send RUN_STARTED
  sendEvent(res, { type: "RUN_STARTED", runId, threadId });

  // Handle client disconnect
  const abortController = new AbortController();
  req.on("close", () => {
    logger.debug({ deploymentId, threadId }, "Chat client disconnected");
    abortController.abort();
  });

  // ── Mock mode ──────────────────────────────────────────────────────────────

  if (MOCK_K8S) {
    const messageId = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId, role: "assistant" });

    await streamMockAgent({
      userMessage: lastUserText,
      deploymentName: dep.name || "Bot",
      deploymentId,
      onChunk: (delta) => sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta }),
      onToolCall: () => {},
      onDone: () => {
        sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
        sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
        res.end();
      },
    });
    return;
  }

  // ── Pod Proxy — WebSocket to OpenClaw gateway ──────────────────────────────

  if (dep.status !== "running") {
    const messageId = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
    sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: `Your bot is currently ${dep.status}. It needs to be running to chat. You can start it using the Start button.` });
    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();
    return;
  }

  try {
    const podAddr = await getPodAddress(deploymentId);

    if (!podAddr) {
      const messageId = nanoid();
      sendEvent(res, { type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
      sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "No running pod found for this deployment. Try restarting the bot." });
      sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
      sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
      res.end();
      return;
    }

    const messageId = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId, role: "assistant" });

    // Track the last delta text to compute incremental deltas for SSE
    let lastDeltaText = "";

    const sessionKey = `jarble-web-${authenticatedUserId || "anon"}`;
    const botText = await chatViaGateway(
      {
        ip: podAddr.ip,
        port: podAddr.port,
        gatewayToken: podAddr.gatewayToken,
        sessionKey,
      },
      lastUserText,
      (fullTextSoFar) => {
        // Gateway sends full accumulated text on each delta — compute the new portion
        if (fullTextSoFar.length > lastDeltaText.length) {
          const newPart = fullTextSoFar.slice(lastDeltaText.length);
          sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: newPart });
          lastDeltaText = fullTextSoFar;
        }
      },
      abortController.signal,
    );

    // If there's text we haven't streamed yet (e.g. final came without prior deltas), send it
    if (botText.length > lastDeltaText.length) {
      const remaining = botText.slice(lastDeltaText.length);
      sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: remaining });
    }

    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();

  } catch (err: any) {
    if (err.name === "AbortError" || abortController.signal.aborted) return;

    logger.error({ deploymentId, error: err.message }, "Gateway proxy error");
    const messageId = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
    sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: `Sorry, I couldn't reach the bot: ${err.message}` });
    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();
  }
});

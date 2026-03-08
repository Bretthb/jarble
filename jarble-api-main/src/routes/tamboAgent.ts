/**
 * Chat Endpoint — Pod proxy for direct OpenClaw conversation.
 *
 * Frontend calls POST /api/tambo-agent with Bearer JWT auth:
 *   1. Verify Auth0 JWT
 *   2. Extract deployment ID from body
 *   3. Verify user owns the deployment
 *   4. Connect to pod's OpenClaw gateway via WebSocket → stream response as SSE
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
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { getPodAddress, findPodForDeployment, execInPod } from "../k8s/index.js";
import { chatViaGateway, chatViaHttp, chatViaExec, type GatewayResponse } from "../services/openclawGateway.js";
import { extractUIBlocks, type JarbleUIBlock, type JarbleComponentDef } from "../utils/uiBlockParser.js";
import { readComponentFromPvc, writeComponentToPvc } from "../k8s/index.js";
import {
  isBuiltinComponent,
  resolveCustomComponent,
  type ComponentDefinition,
} from "../utils/componentResolver.js";
import { classifyError } from "../utils/chatErrors.js";
import { JARBLE_UI_PROMPT } from "../runtimes/handlers/openclaw.js";

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

/**
 * Resolve custom component references in UI blocks.
 * If a block references a custom component (not built-in), reads its definition
 * from the PVC, substitutes props, and expands into a layout block.
 */
async function resolveUIBlocks(
  blocks: JarbleUIBlock[],
  deploymentId: string
): Promise<JarbleUIBlock[]> {
  const resolved: JarbleUIBlock[] = [];
  for (const block of blocks) {
    if (isBuiltinComponent(block.component)) {
      resolved.push(block);
      continue;
    }
    // Custom component — try to resolve from PVC
    try {
      const definition = await readComponentFromPvc(deploymentId, block.component);
      if (!definition) {
        resolved.push(block); // Let frontend show "unknown component"
        continue;
      }
      const children = resolveCustomComponent(
        definition as unknown as ComponentDefinition,
        block.props
      );
      resolved.push({
        id: block.id,
        component: "layout",
        props: {
          title: (definition as any).description || undefined,
          children,
        },
      });
    } catch {
      resolved.push(block); // On error, pass through as-is
    }
  }
  return resolved;
}

// ─── Chat History Endpoints ─────────────────────────────────────────────────

const SESSIONS_DIR = "/data/.openclaw/.openclaw/agents/main/sessions";

/**
 * List chat sessions for a deployment.
 * Reads the session JSONL files from the pod's PVC.
 */
tamboAgentRouter.get("/sessions/:deploymentId", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }

    const payload = await verifyToken(token);
    const user = await getUserFromToken(payload);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { deploymentId } = req.params;
    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, deploymentId),
    });
    if (!deployment || deployment.userId !== user.id) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    const podName = await findPodForDeployment(deploymentId);
    if (!podName) {
      res.json({ sessions: [] });
      return;
    }

    // List session JSONL files and read first user message from each for title
    let fileList: string;
    try {
      fileList = await execInPod(podName, ["sh", "-c", `ls -1 ${SESSIONS_DIR}/*.jsonl 2>/dev/null || true`]);
    } catch {
      res.json({ sessions: [] });
      return;
    }

    const files = fileList.trim().split("\n").filter((f) => f.endsWith(".jsonl"));
    if (files.length === 0) {
      res.json({ sessions: [] });
      return;
    }

    // For each session file, read first few lines to extract metadata + first user message
    const sessions = await Promise.all(files.map(async (filePath) => {
      try {
        const head = await execInPod(podName, ["sh", "-c", `head -20 "${filePath}"`]);
        const lines = head.trim().split("\n");

        let sessionId = "";
        let createdAt = "";
        let firstUserMessage = "";
        let messageCount = 0;

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === "session") {
              sessionId = entry.id;
              createdAt = entry.timestamp;
            }
            if (entry.type === "message" && entry.message?.role === "user" && !firstUserMessage) {
              const content = entry.message.content;
              firstUserMessage = typeof content === "string"
                ? content
                : Array.isArray(content)
                  ? content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("")
                  : "";
            }
          } catch { /* skip unparseable lines */ }
        }

        // Count total messages (wc -l is fast even for large files)
        try {
          const wcOut = await execInPod(podName, ["sh", "-c", `grep -c '"type":"message"' "${filePath}" 2>/dev/null || echo 0`]);
          messageCount = parseInt(wcOut.trim(), 10) || 0;
        } catch { /* ignore */ }

        if (!sessionId) return null;

        // Auto-title: first 60 chars of first user message, stripped of [CANVAS_STATE] blocks
        let title = firstUserMessage
          .replace(/\[CANVAS_STATE\][\s\S]*?\[\/CANVAS_STATE\]\s*/g, "")
          .replace(/\[EDITING [^\]]+\]\s*/g, "")
          .trim();
        if (title.length > 60) title = title.slice(0, 57) + "...";
        if (!title) title = "New conversation";

        return { sessionId, title, createdAt, messageCount };
      } catch {
        return null;
      }
    }));

    // Filter nulls and sort newest first
    const valid = sessions
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({ sessions: valid });
  } catch (err) {
    logger.error({ err }, "Failed to list chat sessions");
    res.status(500).json({ error: "Failed to list sessions" });
  }
});

/**
 * Load messages for a specific chat session.
 * Reads the session JSONL file and extracts user/assistant messages.
 */
tamboAgentRouter.get("/sessions/:deploymentId/:sessionId", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }

    const payload = await verifyToken(token);
    const user = await getUserFromToken(payload);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { deploymentId, sessionId } = req.params;
    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, deploymentId),
    });
    if (!deployment || deployment.userId !== user.id) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    const podName = await findPodForDeployment(deploymentId);
    if (!podName) {
      res.status(400).json({ error: "Pod not running" });
      return;
    }

    // Read the session JSONL file
    const filePath = `${SESSIONS_DIR}/${sessionId}.jsonl`;
    let content: string;
    try {
      content = await execInPod(podName, ["sh", "-c", `cat "${filePath}"`]);
    } catch {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const lines = content.trim().split("\n");
    const messages: Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
      thinkingText?: string;
      createdAt: string;
    }> = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "message") continue;

        const msg = entry.message;
        if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;

        let content = "";
        let thinkingText = "";

        if (typeof msg.content === "string") {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === "text") content += part.text;
            if (part.type === "thinking") thinkingText += part.thinking;
          }
        }

        // Strip jarble_ui fenced blocks from assistant messages
        if (msg.role === "assistant") {
          content = content.replace(/```jarble_ui(?:_update|_define)?\s*\n[\s\S]*?```/g, "").replace(/\n{3,}/g, "\n\n").trim();
        }
        // Strip [CANVAS_STATE] blocks from user messages
        if (msg.role === "user") {
          content = content
            .replace(/\[CANVAS_STATE\][\s\S]*?\[\/CANVAS_STATE\]\s*/g, "")
            .replace(/\[EDITING [^\]]+\]\s*/g, "")
            .trim();
        }

        if (!content) continue;

        messages.push({
          id: entry.id,
          role: msg.role,
          content,
          ...(thinkingText ? { thinkingText } : {}),
          createdAt: entry.timestamp,
        });
      } catch { /* skip unparseable lines */ }
    }

    res.json({ messages });
  } catch (err) {
    logger.error({ err }, "Failed to load chat session");
    res.status(500).json({ error: "Failed to load session" });
  }
});

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
        logger.warn("Chat: bearer token valid but user not found in DB");
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    } catch {
      logger.warn("Chat: invalid or expired bearer token");
      res.status(401).json({ error: "Invalid token" });
      return;
    }
  } else {
    const secret = env.TAMBO_AGENT_SECRET;
    if (secret) {
      const provided = req.headers["x-agent-secret"] as string | undefined;
      if (!provided || !secureCompare(provided, secret)) {
        logger.warn("Chat: invalid or missing agent secret");
        res.status(401).json({ error: "Invalid agent secret" });
        return;
      }
      // Secret auth is service-to-service — require userId in body for ownership check
      if (req.body.userId) {
        authenticatedUserId = req.body.userId;
      }
    } else {
      // No secret configured and no JWT — always reject (even in dev mode)
      logger.warn("Chat: no auth token and no agent secret configured");
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
    logger.warn("Chat: could not extract deploymentId from request body");
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
    logger.warn({ deploymentId }, "Chat: deployment not found");
    sendEvent(res, { type: "RUN_STARTED", runId, threadId });
    const errMsgId = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId: errMsgId, role: "assistant" });
    sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId: errMsgId, delta: "Deployment not found. It may have been deleted." });
    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId: errMsgId });
    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();
    return;
  }

  // 5. Verify ownership (always enforced regardless of auth method)
  if (deployment.userId !== authenticatedUserId) {
    logger.warn({ deploymentId, userId: authenticatedUserId }, "Chat: user does not own deployment");
    sendEvent(res, { type: "RUN_STARTED", runId, threadId });
    const errMsgId = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId: errMsgId, role: "assistant" });
    sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId: errMsgId, delta: "You don't have access to this deployment." });
    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId: errMsgId });
    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();
    return;
  }

  const requestStartMs = Date.now();
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

  logger.info({ deploymentId, messageLength: lastUserText.length }, "Chat: request started");

  // Send RUN_STARTED
  sendEvent(res, { type: "RUN_STARTED", runId, threadId });

  // Handle client disconnect
  const abortController = new AbortController();
  req.on("close", () => {
    logger.debug({ deploymentId, threadId }, "Chat client disconnected");
    abortController.abort();
  });

  // ── Pod Proxy — WebSocket to OpenClaw gateway (streaming) ───────────────────

  // Empty messages (e.g. Tambo init probes or StrictMode double-mounts) —
  // return a no-op success instead of exec'ing with an empty --message flag.
  if (!lastUserText.trim()) {
    const messageId = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
    sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "Connected to your bot. Send a message to start chatting!" });
    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();
    return;
  }

  if (deployment.status !== "running") {
    const classified = classifyError("", { deploymentStatus: deployment.status });
    const messageId = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
    sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: `Your bot is currently ${deployment.status}. It needs to be running to chat. You can start it using the Start button.` });
    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
    sendEvent(res, { type: "CHAT_ERROR", error: classified });
    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();
    return;
  }

  const messageId = nanoid();
  sendEvent(res, { type: "TEXT_MESSAGE_START", messageId, role: "assistant" });

  // Track the last delta text and thinking text to compute incremental deltas for SSE
  let lastDeltaText = "";
  let lastThinkingText = "";
  const sessionKey = `jarble-web-${authenticatedUserId || "anon"}`;

  // In local dev (USE_SQLITE), pod IPs are unreachable from the host — skip
  // the WS gateway entirely and go straight to exec through the K8s API.
  const useExecOnly = process.env.USE_SQLITE === "true" || process.env.USE_SQLITE === "1";

  // Helper: send a gateway result as SSE events
  const emitGatewayResult = async (gatewayResult: GatewayResponse) => {
    if (gatewayResult.rawText.length > lastDeltaText.length) {
      const remaining = gatewayResult.rawText.slice(lastDeltaText.length);
      sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: remaining });
    }

    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });

    logger.info(
      {
        deploymentId,
        rawText: gatewayResult.rawText.slice(0, 500),
        blockCount: gatewayResult.uiBlocks.length,
        updateCount: gatewayResult.uiUpdates?.length ?? 0,
      },
      "chatWithBot: gateway response summary"
    );
    const resolvedBlocks = await resolveUIBlocks(gatewayResult.uiBlocks, deploymentId);
    const customCount = resolvedBlocks.filter(b => b.component === "layout" && !gatewayResult.uiBlocks.find(orig => orig.id === b.id && orig.component === "layout")).length;
    if (resolvedBlocks.length > 0) {
      logger.debug({ deploymentId, blockCount: resolvedBlocks.length, customCount }, "Chat: resolved UI blocks");
    }

    for (const block of resolvedBlocks) {
      sendEvent(res, {
        type: "UI_BLOCK_START",
        blockId: block.id,
        component: block.component,
        messageId,
        ...(block.editable ? { editable: true } : {}),
        ...(block.fileId ? { fileId: block.fileId } : {}),
        ...(block.saveMethod ? { saveMethod: block.saveMethod } : {}),
        ...(block.layoutHint ? { layoutHint: block.layoutHint } : {}),
      });
      sendEvent(res, { type: "UI_BLOCK_PROPS", blockId: block.id, props: block.props });
      sendEvent(res, { type: "UI_BLOCK_END", blockId: block.id });
    }

    // Emit UI_BLOCK_UPDATE events for in-place card updates
    if (gatewayResult.uiUpdates) {
      for (const update of gatewayResult.uiUpdates) {
        sendEvent(res, {
          type: "UI_BLOCK_UPDATE",
          cardId: update.cardId,
          props: update.props,
          merge: update.merge,
          ...(update.component ? { component: update.component } : {}),
        });
      }
    }

    // Handle component definitions — save to PVC and notify frontend
    if (gatewayResult.componentDefs && gatewayResult.componentDefs.length > 0) {
      for (const def of gatewayResult.componentDefs) {
        // Save to PVC in the background (fire-and-forget)
        writeComponentToPvc(deploymentId, def.name, def as unknown as Record<string, unknown>).catch((err: unknown) => {
          logger.warn({ deploymentId, name: def.name, error: err instanceof Error ? err.message : String(err) }, "Failed to save component definition to PVC");
        });

        // Emit event so frontend can register the component immediately
        sendEvent(res, {
          type: "COMPONENT_DEFINED",
          name: def.name,
          description: def.description,
          layout: def.layout,
        });
        logger.info({ deploymentId, name: def.name, childCount: def.layout.length }, "Chat: component defined");
      }
    }

    const durationMs = Date.now() - requestStartMs;
    const eventCount = resolvedBlocks.length + (gatewayResult.uiUpdates?.length ?? 0);
    logger.info(
      { deploymentId, durationMs, blockCount: resolvedBlocks.length, updateCount: gatewayResult.uiUpdates?.length ?? 0, rawTextLength: gatewayResult.rawText.length },
      "Chat: request completed"
    );

    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();
  };

  // Helper: run chat via exec (kubectl exec into pod)
  const tryExec = async (): Promise<GatewayResponse> => {
    const podName = await findPodForDeployment(deploymentId, { requireReady: false });
    if (!podName) throw new Error("No pod found for this deployment");
    return chatViaExec(
      podName,
      sessionKey,
      lastUserText,
      (fullTextSoFar) => {
        if (fullTextSoFar.length > lastDeltaText.length) {
          const newPart = fullTextSoFar.slice(lastDeltaText.length);
          sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: newPart });
          lastDeltaText = fullTextSoFar;
        }
      },
    );
  };

  // ── Exec-only path (local dev) ──────────────────────────────────────────────
  if (useExecOnly) {
    try {
      logger.debug({ deploymentId }, "Local dev: using exec-only path (skipping WS gateway)");
      const result = await tryExec();
      await emitGatewayResult(result);
      return;
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (e.name === "AbortError" || abortController.signal.aborted) return;
      logger.error({ deploymentId, error: e.message }, "Exec-only chat failed");
      const classified = classifyError(e.message, { deploymentStatus: deployment.status });
      sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: `Sorry, I couldn't reach the bot: ${e.message}` });
      sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
      sendEvent(res, { type: "CHAT_ERROR", error: classified });
      sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
      res.end();
      return;
    }
  }

  // ── Standard path: WS gateway with exec fallback ────────────────────────────
  const MAX_ATTEMPTS = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const podAddr = await getPodAddress(deploymentId);

      if (!podAddr) {
        const classified = classifyError("No pod found", { deploymentStatus: deployment.status });
        sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "No running pod found for this deployment. Try restarting the bot." });
        sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
        sendEvent(res, { type: "CHAT_ERROR", error: classified });
        sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
        res.end();
        return;
      }

      const gwOpts = {
        ip: podAddr.ip,
        port: podAddr.port,
        gatewayToken: podAddr.gatewayToken,
        sessionKey,
      };
      const onFullTextDelta = (fullTextSoFar: string) => {
        if (fullTextSoFar.length > lastDeltaText.length) {
          const newPart = fullTextSoFar.slice(lastDeltaText.length);
          sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: newPart });
          lastDeltaText = fullTextSoFar;
        }
      };
      const onThinking = (fullThinkingText: string) => {
        if (fullThinkingText.length > lastThinkingText.length) {
          const newPart = fullThinkingText.slice(lastThinkingText.length);
          sendEvent(res, { type: "THINKING_CONTENT", messageId, delta: newPart });
          lastThinkingText = fullThinkingText;
        }
      };
      const onBlock = async (block: JarbleUIBlock) => {
        try {
          const resolved = await resolveUIBlocks([block], deploymentId);
          for (const b of resolved) {
            sendEvent(res, {
              type: "UI_BLOCK_START",
              blockId: b.id,
              component: b.component,
              messageId,
              ...(b.editable ? { editable: true } : {}),
              ...(b.fileId ? { fileId: b.fileId } : {}),
              ...(b.saveMethod ? { saveMethod: b.saveMethod } : {}),
              ...(b.layoutHint ? { layoutHint: b.layoutHint } : {}),
            });
            sendEvent(res, { type: "UI_BLOCK_PROPS", blockId: b.id, props: b.props });
            sendEvent(res, { type: "UI_BLOCK_END", blockId: b.id });
          }
        } catch (err: unknown) {
          logger.warn({ deploymentId, blockId: block.id, error: err instanceof Error ? err.message : String(err) }, "Chat: failed to emit streamed UI block");
        }
      };

      // Try HTTP chat completions first (no device pairing needed),
      // fall back to WS gateway if HTTP fails.
      let gatewayResult: GatewayResponse;
      try {
        gatewayResult = await chatViaHttp(gwOpts, lastUserText, onFullTextDelta, abortController.signal, onBlock, onThinking, JARBLE_UI_PROMPT);
      } catch (httpErr: unknown) {
        const httpE = httpErr instanceof Error ? httpErr : new Error(String(httpErr));
        logger.warn({ deploymentId, error: httpE.message }, "HTTP chat failed, trying WS gateway");
        lastDeltaText = "";
        gatewayResult = await chatViaGateway(gwOpts, lastUserText, onFullTextDelta, abortController.signal, onBlock);
      }

      await emitGatewayResult(gatewayResult);
      return;

    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (e.name === "AbortError" || abortController.signal.aborted) return;
      lastError = e;

      // On connection-level errors, fall back to exec through K8s API
      const isConnectionError = /ETIMEDOUT|ECONNREFUSED|ECONNRESET|handshake|closed before auth/i.test(e.message);
      if (isConnectionError && attempt < MAX_ATTEMPTS - 1) {
        logger.warn({ deploymentId, attempt, error: e.message }, "Gateway WS failed, falling back to exec (npx openclaw agent)");
        lastDeltaText = "";

        try {
          const result = await tryExec();
          await emitGatewayResult(result);
          return;
        } catch (execErr: unknown) {
          const execE = execErr instanceof Error ? execErr : new Error(String(execErr));
          logger.warn({ deploymentId, error: execE.message }, "Exec fallback also failed");
          lastError = execE;
        }
        continue;
      }
      break;
    }
  }

  // All attempts failed
  logger.error({ deploymentId, error: lastError?.message }, "Gateway proxy error (all attempts failed)");
  const classified = classifyError(lastError?.message ?? "", { deploymentStatus: deployment.status });
  sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: `Sorry, I couldn't reach the bot: ${lastError?.message}` });
  sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
  sendEvent(res, { type: "CHAT_ERROR", error: classified });
  sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
  res.end();
});

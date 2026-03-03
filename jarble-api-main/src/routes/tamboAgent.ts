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
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("chat");
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { getPodAddress, findPodForDeployment } from "../k8s/index.js";
import type { ManagedBy } from "../k8s/constants.js";
import { getContainerName } from "../k8s/constants.js";
import { chatViaGateway, chatViaExec, type GatewayResponse } from "../services/openclawGateway.js";
import { extractUIBlocks, type JarbleUIBlock, type JarbleComponentDef } from "../utils/uiBlockParser.js";
import { readComponentFromPvc, writeComponentToPvc } from "../k8s/index.js";
import {
  isBuiltinComponent,
  resolveCustomComponent,
  type ComponentDefinition,
} from "../utils/componentResolver.js";
import { classifyError } from "../utils/chatErrors.js";

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
  deploymentId: string,
  managedBy: ManagedBy = "legacy"
): Promise<JarbleUIBlock[]> {
  const resolved: JarbleUIBlock[] = [];
  for (const block of blocks) {
    if (isBuiltinComponent(block.component)) {
      resolved.push(block);
      continue;
    }
    // Custom component — try to resolve from PVC
    try {
      const definition = await readComponentFromPvc(deploymentId, block.component, managedBy);
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
    } catch (err) {
      log.warn({ deploymentId, component: block.component, error: err instanceof Error ? err.message : String(err) }, "resolveUIBlocks: custom component resolution failed");
      resolved.push(block); // On error, pass through as-is
    }
  }
  return resolved;
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
        log.warn("Chat: bearer token valid but user not found in DB");
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    } catch {
      log.warn("Chat: invalid or expired bearer token");
      res.status(401).json({ error: "Invalid token" });
      return;
    }
  } else {
    const secret = env.TAMBO_AGENT_SECRET;
    if (secret) {
      const provided = req.headers["x-agent-secret"] as string | undefined;
      if (!provided || !secureCompare(provided, secret)) {
        log.warn("Chat: invalid or missing agent secret");
        res.status(401).json({ error: "Invalid agent secret" });
        return;
      }
      // Secret auth is service-to-service — require userId in body for ownership check
      if (req.body.userId) {
        authenticatedUserId = req.body.userId;
      }
    } else {
      // No secret configured and no JWT — always reject (even in dev mode)
      log.warn("Chat: no auth token and no agent secret configured");
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
    log.warn("Chat: could not extract deploymentId from request body");
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
    log.warn({ deploymentId }, "Chat: deployment not found");
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
    log.warn({ deploymentId, userId: authenticatedUserId }, "Chat: user does not own deployment");
    sendEvent(res, { type: "RUN_STARTED", runId, threadId });
    const errMsgId = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId: errMsgId, role: "assistant" });
    sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId: errMsgId, delta: "You don't have access to this deployment." });
    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId: errMsgId });
    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();
    return;
  }

  const managedBy = ((deployment as any).managedBy ?? "legacy") as ManagedBy;
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

  log.info({ deploymentId, messageLength: lastUserText.length }, "Chat: request started");

  // Send RUN_STARTED
  sendEvent(res, {
    type: "RUN_STARTED",
    runId,
    threadId,
    llmProvider: deployment.llmProvider,
    llmModel: deployment.llmModel,
  });

  // Handle client disconnect
  const abortController = new AbortController();
  req.on("close", () => {
    log.debug({ deploymentId, threadId }, "Chat client disconnected");
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

  // Track the last delta text to compute incremental deltas for SSE
  let lastDeltaText = "";
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

    log.info(
      {
        deploymentId,
        rawText: gatewayResult.rawText.slice(0, 500),
        blockCount: gatewayResult.uiBlocks.length,
        updateCount: gatewayResult.uiUpdates?.length ?? 0,
      },
      "chatWithBot: gateway response summary"
    );
    const resolvedBlocks = await resolveUIBlocks(gatewayResult.uiBlocks, deploymentId, managedBy);
    const customCount = resolvedBlocks.filter(b => b.component === "layout" && !gatewayResult.uiBlocks.find(orig => orig.id === b.id && orig.component === "layout")).length;
    if (resolvedBlocks.length > 0) {
      log.debug({ deploymentId, blockCount: resolvedBlocks.length, customCount }, "Chat: resolved UI blocks");
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
        writeComponentToPvc(deploymentId, def.name, def as unknown as Record<string, unknown>, managedBy).catch((err: unknown) => {
          log.warn({ deploymentId, name: def.name, error: err instanceof Error ? err.message : String(err) }, "Failed to save component definition to PVC");
        });

        // Emit event so frontend can register the component immediately
        sendEvent(res, {
          type: "COMPONENT_DEFINED",
          name: def.name,
          description: def.description,
          layout: def.layout,
        });
        log.info({ deploymentId, name: def.name, childCount: def.layout.length }, "Chat: component defined");
      }
    }

    const durationMs = Date.now() - requestStartMs;
    const eventCount = resolvedBlocks.length + (gatewayResult.uiUpdates?.length ?? 0);
    log.info(
      { deploymentId, durationMs, blockCount: resolvedBlocks.length, updateCount: gatewayResult.uiUpdates?.length ?? 0, rawTextLength: gatewayResult.rawText.length },
      "Chat: request completed"
    );

    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();
  };

  // Helper: run chat via exec (kubectl exec into pod)
  const tryExec = async (): Promise<GatewayResponse> => {
    const podName = await findPodForDeployment(deploymentId, { requireReady: false, managedBy });
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
      log.debug({ deploymentId }, "Local dev: using exec-only path (skipping WS gateway)");
      const result = await tryExec();
      await emitGatewayResult(result);
      return;
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (e.name === "AbortError" || abortController.signal.aborted) return;
      log.error({ deploymentId, error: e.message }, "Exec-only chat failed");
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
      const podAddr = await getPodAddress(deploymentId, managedBy);

      if (!podAddr) {
        const classified = classifyError("No pod found", { deploymentStatus: deployment.status });
        sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "No running pod found for this deployment. Try restarting the bot." });
        sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
        sendEvent(res, { type: "CHAT_ERROR", error: classified });
        sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
        res.end();
        return;
      }

      const gatewayResult = await chatViaGateway(
        {
          ip: podAddr.ip,
          port: podAddr.port,
          gatewayToken: podAddr.gatewayToken,
          sessionKey,
        },
        lastUserText,
        (fullTextSoFar) => {
          if (fullTextSoFar.length > lastDeltaText.length) {
            const newPart = fullTextSoFar.slice(lastDeltaText.length);
            sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: newPart });
            lastDeltaText = fullTextSoFar;
          }
        },
        abortController.signal,
        // Emit UI blocks as soon as they're detected during streaming (before response finishes)
        async (block) => {
          try {
            const resolved = await resolveUIBlocks([block], deploymentId, managedBy);
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
            log.warn({ deploymentId, blockId: block.id, error: err instanceof Error ? err.message : String(err) }, "Chat: failed to emit streamed UI block");
          }
        },
      );

      await emitGatewayResult(gatewayResult);
      return;

    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (e.name === "AbortError" || abortController.signal.aborted) return;
      lastError = e;

      // On connection-level errors, fall back to exec through K8s API
      const isConnectionError = /ETIMEDOUT|ECONNREFUSED|ECONNRESET|handshake|closed before auth/i.test(e.message);
      if (isConnectionError && attempt < MAX_ATTEMPTS - 1) {
        log.warn({ deploymentId, attempt, error: e.message }, "Gateway WS failed, falling back to exec (npx openclaw agent)");
        lastDeltaText = "";

        try {
          const result = await tryExec();
          await emitGatewayResult(result);
          return;
        } catch (execErr: unknown) {
          const execE = execErr instanceof Error ? execErr : new Error(String(execErr));
          log.warn({ deploymentId, error: execE.message }, "Exec fallback also failed");
          lastError = execE;
        }
        continue;
      }
      break;
    }
  }

  // All attempts failed
  log.error({ deploymentId, error: lastError?.message }, "Gateway proxy error (all attempts failed)");
  const classified = classifyError(lastError?.message ?? "", { deploymentStatus: deployment.status });
  sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: `Sorry, I couldn't reach the bot: ${lastError?.message}` });
  sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
  sendEvent(res, { type: "CHAT_ERROR", error: classified });
  sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
  res.end();
});

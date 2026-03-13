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
import { markDeploymentActive, markDeploymentIdle } from "../services/configSync.js";
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
import {
  TOOL_CALL_START,
  TOOL_CALL_ARGS,
  TOOL_CALL_END,
  CUSTOM,
  CUSTOM_CARD_UPDATE,
  CUSTOM_COMPONENT_DEFINED,
  CUSTOM_CHAT_ERROR,
  CUSTOM_DASHBOARD_CREATED,
  CUSTOM_ARTIFACT_UPDATED,
} from "../utils/eventTypes.js";

export const tamboAgentRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function sendEvent(res: any, event: Record<string, unknown>) {
  if (res.writableEnded) return;
  try {
    const json = JSON.stringify(event);
    res.write(`data: ${json}\n\n`);
  } catch (err) {
    log.error(
      { eventType: event.type, error: err instanceof Error ? err.message : String(err) },
      "Failed to stringify SSE event"
    );
    // Send a minimal error event so the frontend knows something went wrong
    try {
      res.write(
        `data: ${JSON.stringify({
          type: "CUSTOM",
          name: "jarble.sse.error",
          value: { message: "Failed to serialize event data" },
        })}\n\n`
      );
    } catch {
      // Connection is doomed — nothing more we can do
    }
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

// ── Theme/Skin intent detection + in-process handling ─────────────────────

import { validateThemeConfig, THEME_PRESET_NAMES, SKIN_NAMES } from "@jarble/component-manifest";

const THEME_PRESET_SET = new Set(THEME_PRESET_NAMES);
const SKIN_SET = new Set(SKIN_NAMES as readonly string[]);

/**
 * Detect if the user's message is a theme/skin change request.
 * If so, handle it directly (no pod needed) and return true.
 */
async function tryHandleThemeRequest(
  userText: string,
  deploymentId: string,
  deployment: any,
  res: any,
  runId: string,
  threadId: string,
): Promise<boolean> {
  const lower = userText.toLowerCase().trim();

  // Quick gate: must mention theme, skin, or a known preset/skin name
  const themeKeywords = /\b(theme|skin|set.?theme|change.?theme|switch.?theme|reset.?theme|default.?theme)\b/i;
  const hasPresetName = THEME_PRESET_NAMES.some(p => lower.includes(p));
  const hasSkinName = (SKIN_NAMES as readonly string[]).some(s => s !== "default" && lower.includes(s));

  if (!themeKeywords.test(lower) && !hasPresetName && !hasSkinName) {
    return false; // Not a theme request — let the pod handle it
  }

  // Parse intent
  let preset: string | undefined;
  let skin: string | undefined;
  const isReset = /\b(reset|default|back to (default|normal|original))\b/i.test(lower);

  if (isReset) {
    preset = "default";
    skin = "default";
  } else {
    // Find preset name
    for (const p of THEME_PRESET_NAMES) {
      if (lower.includes(p)) {
        preset = p;
        break;
      }
    }
    // Find skin name
    for (const s of SKIN_NAMES as readonly string[]) {
      if (s !== "default" && lower.includes(s)) {
        skin = s;
        break;
      }
    }
  }

  // If we only matched keywords but no actual preset/skin, let the pod handle it
  if (!preset && !skin) return false;

  // Build theme config
  const currentConfig = deployment.themeConfig
    ? (() => { try { return JSON.parse(deployment.themeConfig); } catch { return {}; } })()
    : {};

  const newConfig = { ...currentConfig };
  if (preset) newConfig.preset = preset;
  if (skin) newConfig.skin = skin;

  const isFullReset = preset === "default" && skin === "default";

  // Send RUN_STARTED so the frontend knows we're handling this
  sendEvent(res, { type: "RUN_STARTED", runId, threadId });

  // Validate
  if (!isFullReset) {
    const error = validateThemeConfig(newConfig);
    if (error) {
      const mid = nanoid();
      sendEvent(res, { type: "TEXT_MESSAGE_START", messageId: mid, role: "assistant" });
      sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId: mid, delta: `Couldn't set that theme: ${error}` });
      sendEvent(res, { type: "TEXT_MESSAGE_END", messageId: mid });
      sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
      res.end();
      return true;
    }
  }

  // Persist to DB
  await db.update(tables.deployments)
    .set({ themeConfig: isFullReset ? null : JSON.stringify(newConfig) } as any)
    .where(eq(tables.deployments.id, deploymentId));

  // Send SSE events
  const mid = nanoid();
  sendEvent(res, { type: "TEXT_MESSAGE_START", messageId: mid, role: "assistant" });

  // Build friendly response
  const parts: string[] = [];
  if (isFullReset) {
    parts.push("Reset to the default theme.");
  } else {
    if (preset) parts.push(`**Color preset**: ${preset}`);
    if (skin) parts.push(`**Skin**: ${skin}`);
  }

  const skinDescriptions: Record<string, string> = {
    terminal: "monospace font, CRT scanlines, command-line prompts",
    retro: "8-bit pixel font, NES-style borders, classic gaming aesthetic",
    handdrawn: "hand-drawn sketchy borders, wobbly elements, cursive font",
    neobrutalist: "bold 3px borders, chunky offset shadows, playful rotations",
    glass: "frosted glassmorphism with blur effects and subtle glow",
    minimal: "clean and spacious — hidden avatars, borderless messages",
    win98: "classic Windows 98 — silver gray, 3D beveled borders, blue title bar",
  };

  if (skin && skin !== "default" && skinDescriptions[skin]) {
    parts.push(`\n*${skinDescriptions[skin]}*`);
  }

  const responseText = isFullReset
    ? "Theme reset to default. Clean slate!"
    : `Theme updated!\n\n${parts.join("\n")}`;

  sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId: mid, delta: responseText });
  sendEvent(res, { type: "TEXT_MESSAGE_END", messageId: mid });

  // Fire live theme update event so frontend applies immediately
  sendEvent(res, {
    type: CUSTOM,
    name: "jarble.theme.updated",
    value: isFullReset ? null : newConfig,
  });

  log.info({ deploymentId, preset, skin, isReset: isFullReset }, "Chat: theme changed via in-process interception");

  sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
  res.end();
  return true;
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
    "Cache-Control": "no-cache, no-store, no-transform",
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

  // Track active chat session so auto-sync doesn't restart the gateway mid-conversation
  markDeploymentActive(deploymentId);

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

  // Handle client disconnect and resource cleanup
  const abortController = new AbortController();

  // Keep-alive ping every 25s to prevent proxy/load-balancer timeouts
  const keepAliveInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(": keepalive\n\n");
    }
  }, 25_000);

  // Master timeout: 5 minutes — prevents indefinitely hanging connections
  // if the gateway WebSocket or exec hangs without triggering its own timeout.
  const MASTER_TIMEOUT_MS = 5 * 60 * 1000;
  const masterTimeout = setTimeout(() => {
    if (res.writableEnded) return;
    log.warn({ deploymentId, threadId }, "Chat SSE master timeout (5 min) — closing connection");
    sendEvent(res, {
      type: "TEXT_MESSAGE_CONTENT",
      messageId,
      delta: "\n\nSorry, the request timed out. The bot may be processing a complex task — please try again.",
    });
    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();
    abortController.abort();
  }, MASTER_TIMEOUT_MS);

  /** Clear all timers and abort. Called on disconnect or successful completion. */
  const cleanupTimers = () => {
    clearInterval(keepAliveInterval);
    clearTimeout(masterTimeout);
  };

  // Wrap res.end to always clean up timers
  const originalEnd = res.end.bind(res);
  res.end = ((...args: any[]) => {
    cleanupTimers();
    return originalEnd(...args);
  }) as typeof res.end;

  req.on("close", () => {
    log.debug({ deploymentId, threadId }, "Chat client disconnected");
    cleanupTimers();
    abortController.abort();
    markDeploymentIdle(deploymentId);
  });

  req.on("error", (err: Error) => {
    log.warn({ err, deploymentId, threadId }, "Chat SSE request error");
    cleanupTimers();
    abortController.abort();
  });

  res.on("error", (err: Error) => {
    log.warn({ err, deploymentId, threadId }, "Chat SSE response error");
    cleanupTimers();
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

  // ── Theme/skin interception — handle directly without pod ────────────────
  // Detect theme/skin intent in user message and handle via in-process tool
  const themeResult = await tryHandleThemeRequest(lastUserText, deploymentId, deployment, res, runId, threadId);
  if (themeResult) return;

  if (deployment.status !== "running") {
    const classified = classifyError("", { deploymentStatus: deployment.status });
    const messageId = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
    sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: `Your bot is currently ${deployment.status}. It needs to be running to chat. You can start it using the Start button.` });
    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
    sendEvent(res, { type: CUSTOM, name: CUSTOM_CHAT_ERROR, value: { error: classified } });
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
      // AG-UI standard: component rendering = tool call
      const toolCallId = block.id;
      sendEvent(res, {
        type: TOOL_CALL_START,
        toolCallId,
        toolCallName: `show_${block.component}`,
        parentMessageId: messageId,
        ...(block.editable ? { editable: true } : {}),
        ...(block.fileId ? { fileId: block.fileId } : {}),
        ...(block.saveMethod ? { saveMethod: block.saveMethod } : {}),
        ...(block.layoutHint ? { layoutHint: block.layoutHint } : {}),
        ...(block.dashboardId ? { dashboardId: block.dashboardId } : {}),
        ...(block.dashboardTitle ? { dashboardTitle: block.dashboardTitle } : {}),
      });
      sendEvent(res, {
        type: TOOL_CALL_ARGS,
        toolCallId,
        delta: JSON.stringify(block.props),
      });
      sendEvent(res, { type: TOOL_CALL_END, toolCallId });
    }

    // Emit dashboard grouping events
    const dashboardGroups = new Map<string, { title: string; cardIds: string[] }>();
    for (const block of resolvedBlocks) {
      if (block.dashboardId) {
        const group = dashboardGroups.get(block.dashboardId) || { title: block.dashboardTitle || "Dashboard", cardIds: [] };
        group.cardIds.push(`card-${block.id}`);
        dashboardGroups.set(block.dashboardId, group);
      }
    }
    for (const [dashboardId, group] of dashboardGroups) {
      sendEvent(res, {
        type: CUSTOM,
        name: CUSTOM_DASHBOARD_CREATED,
        value: { dashboardId, title: group.title, cardIds: group.cardIds },
      });
    }

    // Emit card updates as AG-UI CUSTOM events
    if (gatewayResult.uiUpdates) {
      for (const update of gatewayResult.uiUpdates) {
        sendEvent(res, {
          type: CUSTOM,
          name: CUSTOM_CARD_UPDATE,
          value: {
            cardId: update.cardId,
            props: update.props,
            merge: update.merge,
            ...(update.component ? { component: update.component } : {}),
          },
        });
        // Also emit artifact updated for live data subscriptions
        sendEvent(res, {
          type: CUSTOM,
          name: CUSTOM_ARTIFACT_UPDATED,
          value: {
            id: update.cardId,
            props: update.props,
            ...(update.component ? { component: update.component } : {}),
          },
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

        sendEvent(res, {
          type: CUSTOM,
          name: CUSTOM_COMPONENT_DEFINED,
          value: {
            name: def.name,
            description: def.description,
            layout: def.layout,
          },
        });
        log.info({ deploymentId, name: def.name, childCount: def.layout.length }, "Chat: component defined");
      }
    }

    // ── Check for pending theme change from MCP set_theme ─────────────
    // The MCP server writes /data/config/pending-theme.json when set_theme
    // is called. We pick it up here and persist to the DB so the frontend
    // can apply it immediately.
    try {
      const podName = await findPodForDeployment(deploymentId, { requireReady: false, managedBy });
      if (podName) {
        const { execInPod } = await import("../k8s/index.js");
        const containerName = getContainerName(managedBy);
        const themeJson = await execInPod(podName, [
          "sh", "-c",
          "cat /data/config/pending-theme.json 2>/dev/null && rm -f /data/config/pending-theme.json",
        ], containerName).catch(() => "");
        if (themeJson.trim()) {
          const { validateThemeConfig } = await import("@jarble/component-manifest");
          const themeConfig = JSON.parse(themeJson.trim());
          const error = validateThemeConfig(themeConfig);
          if (!error) {
            const isReset = themeConfig.preset === "default" && Object.keys(themeConfig).length === 1;
            await db.update(tables.deployments)
              .set({ themeConfig: isReset ? null : JSON.stringify(themeConfig) } as any)
              .where(eq(tables.deployments.id, deploymentId));
            sendEvent(res, {
              type: CUSTOM,
              name: "jarble.theme.updated",
              value: isReset ? null : themeConfig,
            });
            log.info({ deploymentId, preset: themeConfig.preset }, "Chat: theme updated from MCP set_theme");
          }
        }
      }
    } catch (themeErr) {
      log.warn({ deploymentId, err: themeErr }, "Chat: failed to check pending theme (non-fatal)");
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
      sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: `Sorry, I couldn't reach the bot. ${classified.suggestion}` });
      sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
      sendEvent(res, { type: CUSTOM, name: CUSTOM_CHAT_ERROR, value: { error: classified } });
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
        sendEvent(res, { type: CUSTOM, name: CUSTOM_CHAT_ERROR, value: { error: classified } });
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
              // AG-UI TOOL_CALL events
              const toolCallId = b.id;
              sendEvent(res, {
                type: TOOL_CALL_START,
                toolCallId,
                toolCallName: `show_${b.component}`,
                parentMessageId: messageId,
                ...(b.editable ? { editable: true } : {}),
                ...(b.fileId ? { fileId: b.fileId } : {}),
                ...(b.saveMethod ? { saveMethod: b.saveMethod } : {}),
                ...(b.layoutHint ? { layoutHint: b.layoutHint } : {}),
                ...(b.dashboardId ? { dashboardId: b.dashboardId } : {}),
                ...(b.dashboardTitle ? { dashboardTitle: b.dashboardTitle } : {}),
              });
              sendEvent(res, {
                type: TOOL_CALL_ARGS,
                toolCallId,
                delta: JSON.stringify(b.props),
              });
              sendEvent(res, { type: TOOL_CALL_END, toolCallId });
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
  sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: `Sorry, I couldn't reach the bot. ${classified.suggestion}` });
  sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
  sendEvent(res, { type: CUSTOM, name: CUSTOM_CHAT_ERROR, value: { error: classified } });
  sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
  res.end();
});

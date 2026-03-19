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
import { generateSuggestions } from "../services/suggestions.js";
import { generateReasoning } from "../services/reasoning.js";
import { sessionManager } from "../services/chatSessionManager.js";
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
  CUSTOM_SUGGESTIONS,
  CUSTOM_DESIGN_CONTEXT,
  CUSTOM_TOOL_STATUS,
  CUSTOM_AGENT_CALL_START,
  CUSTOM_AGENT_CALL_END,
  REASONING_START,
  REASONING_CONTENT,
  REASONING_END,
} from "../utils/eventTypes.js";
import { agentCallEvents, type AgentCallStartEvent, type AgentCallEndEvent } from "../utils/agentCallEvents.js";

export const tamboAgentRouter = Router();

// ── Tool status descriptions ─────────────────────────────────────────────────
// Maps component names to human-readable status for the frontend indicator

const TOOL_STATUS_MAP: Record<string, string> = {
  chart: "Rendering chart...",
  data_table: "Building table...",
  sandbox: "Creating sandbox...",
  code_block: "Writing code...",
  code_editor: "Opening editor...",
  card: "Creating card...",
  form: "Building form...",
  metric_card: "Computing metrics...",
  statistic: "Computing statistics...",
  stat_grid: "Building stat grid...",
  page: "Creating page...",
  tabs: "Arranging tabs...",
  list: "Building list...",
  progress: "Tracking progress...",
  layout: "Arranging layout...",
  image: "Loading image...",
};

function getToolStatus(component: string): string {
  return TOOL_STATUS_MAP[component] || `Rendering ${component.replace(/_/g, " ")}...`;
}

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

// ── Reasoning Tag Tracker ────────────────────────────────────────────────────
//
// Tracks `<think>` / `<reasoning>` tags in the streaming text and splits
// content into reasoning vs. visible text. The LLM streams text incrementally,
// so we process only the new delta on each call.

interface ReasoningState {
  /** Whether we are currently inside a reasoning block */
  inReasoning: boolean;
  /** How much of the accumulated text we have already processed */
  processedLength: number;
  /** Whether we have emitted REASONING_START for the current block */
  started: boolean;
}

function createReasoningTracker() {
  const state: ReasoningState = {
    inReasoning: false,
    processedLength: 0,
    started: false,
  };

  /**
   * Process accumulated text and emit reasoning / text events as appropriate.
   *
   * `fullText` is the full accumulated bot text so far.
   * Returns the text delta that should be sent as TEXT_MESSAGE_CONTENT
   * (with reasoning sections stripped out). May be empty if the new text
   * is entirely reasoning content.
   *
   * `onReasoningStart` / `onReasoningContent` / `onReasoningEnd` are callbacks
   * for emitting the corresponding SSE events.
   */
  function process(
    fullText: string,
    callbacks: {
      onReasoningStart: () => void;
      onReasoningContent: (delta: string) => void;
      onReasoningEnd: () => void;
    },
  ): string {
    const newText = fullText.slice(state.processedLength);
    if (!newText) return "";

    let visibleDelta = "";
    let remaining = newText;

    while (remaining.length > 0) {
      if (!state.inReasoning) {
        // Look for opening tag
        const openMatch = remaining.match(/<(think|reasoning)>/i);
        if (openMatch && openMatch.index !== undefined) {
          // Emit text before the tag as visible
          visibleDelta += remaining.slice(0, openMatch.index);
          state.inReasoning = true;
          state.started = false;
          remaining = remaining.slice(openMatch.index + openMatch[0].length);

          // Check if the opening tag might be at the very end (incomplete)
          // No — we matched it, so it's complete
          callbacks.onReasoningStart();
          state.started = true;
        } else {
          // Check if there's a potential partial opening tag at the end
          // e.g., the text ends with "<thi" which might become "<think>"
          const partialTagIdx = findPartialOpenTag(remaining);
          if (partialTagIdx !== -1) {
            // Emit everything before the potential partial tag
            visibleDelta += remaining.slice(0, partialTagIdx);
            // Don't advance processedLength past the partial tag — we'll
            // re-process it on the next delta when more text arrives.
            state.processedLength += newText.length - remaining.length + partialTagIdx;
            return visibleDelta;
          }
          // No tag found — all visible text
          visibleDelta += remaining;
          remaining = "";
        }
      } else {
        // Inside reasoning — look for closing tag
        const closeMatch = remaining.match(/<\/(think|reasoning)>/i);
        if (closeMatch && closeMatch.index !== undefined) {
          // Emit reasoning content before the closing tag
          const reasoningChunk = remaining.slice(0, closeMatch.index);
          if (reasoningChunk) {
            callbacks.onReasoningContent(reasoningChunk);
          }
          callbacks.onReasoningEnd();
          state.inReasoning = false;
          state.started = false;
          remaining = remaining.slice(closeMatch.index + closeMatch[0].length);
        } else {
          // Check for partial closing tag at the end
          const partialCloseIdx = findPartialCloseTag(remaining);
          if (partialCloseIdx !== -1) {
            // Emit reasoning content up to the partial tag
            const reasoningChunk = remaining.slice(0, partialCloseIdx);
            if (reasoningChunk) {
              callbacks.onReasoningContent(reasoningChunk);
            }
            state.processedLength += newText.length - remaining.length + partialCloseIdx;
            return visibleDelta;
          }
          // No closing tag — entire remaining text is reasoning
          if (remaining) {
            callbacks.onReasoningContent(remaining);
          }
          remaining = "";
        }
      }
    }

    state.processedLength = fullText.length;
    return visibleDelta;
  }

  return { process, state };
}

/**
 * Check if the end of `text` contains a partial opening reasoning tag.
 * Returns the index where the partial tag starts, or -1 if none found.
 */
function findPartialOpenTag(text: string): number {
  const candidates = ["<think>", "<reasoning>", "<Think>", "<Thinking>", "<THINK>", "<REASONING>"];
  for (const tag of candidates) {
    // Check suffixes of text against prefixes of tag
    for (let len = 1; len < tag.length; len++) {
      const suffix = text.slice(-len);
      const prefix = tag.slice(0, len);
      if (suffix.toLowerCase() === prefix.toLowerCase() && text.length >= len) {
        return text.length - len;
      }
    }
  }
  return -1;
}

/**
 * Check if the end of `text` contains a partial closing reasoning tag.
 * Returns the index where the partial tag starts, or -1 if none found.
 */
function findPartialCloseTag(text: string): number {
  const candidates = ["</think>", "</reasoning>", "</Think>", "</Thinking>", "</THINK>", "</REASONING>"];
  for (const tag of candidates) {
    for (let len = 1; len < tag.length; len++) {
      const suffix = text.slice(-len);
      const prefix = tag.slice(0, len);
      if (suffix.toLowerCase() === prefix.toLowerCase() && text.length >= len) {
        return text.length - len;
      }
    }
  }
  return -1;
}

/**
 * Strip reasoning tags from finalized text (for non-streaming paths).
 * Removes `<think>...</think>` and `<reasoning>...</reasoning>` blocks entirely.
 */
function stripReasoningTags(text: string): string {
  return text
    .replace(/<(think|reasoning)>[\s\S]*?<\/\1>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract reasoning content from finalized text (for non-streaming paths).
 * Returns an array of reasoning block contents.
 */
function extractReasoningBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /<(think|reasoning)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match[2].trim()) {
      blocks.push(match[2].trim());
    }
  }
  return blocks;
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

// ── Slash command system ──────────────────────────────────────────────────

import { validateThemeConfig, THEME_PRESET_NAMES, SKIN_NAMES } from "@jarble/component-manifest";

const SKIN_DESCRIPTIONS: Record<string, string> = {
  terminal: "monospace font, CRT scanlines, command-line prompts",
  retro: "8-bit pixel font, NES-style borders, classic gaming aesthetic",
  handdrawn: "hand-drawn sketchy borders, wobbly elements, cursive font",
  neobrutalist: "bold 3px borders, chunky offset shadows, playful rotations",
  glass: "frosted glassmorphism with blur effects and subtle glow",
  minimal: "clean and spacious — hidden avatars, borderless messages",
  win98: "classic Windows 98 — silver gray, 3D beveled borders, blue title bar",
};

/** Helper: send a quick text response via SSE and close. */
function sendQuickResponse(res: any, runId: string, threadId: string, text: string, extra?: () => void) {
  sendEvent(res, { type: "RUN_STARTED", runId, threadId });
  const mid = nanoid();
  sendEvent(res, { type: "TEXT_MESSAGE_START", messageId: mid, role: "assistant" });
  sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId: mid, delta: text });
  sendEvent(res, { type: "TEXT_MESSAGE_END", messageId: mid });
  if (extra) extra();
  sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
  res.end();
}

/**
 * Handle slash commands. Only triggers when message starts with "/".
 * Returns true if the command was handled (response already sent).
 *
 * Supported commands:
 *   /theme <preset> [skin]  — Change color preset and/or skin
 *   /color-preset <preset>  — Alias for /theme
 *   /skin <skin>            — Change chat skin only
 *   /commands, /help        — List available commands
 *   /clear                  — Signal frontend to clear chat
 *   /reset                  — Reset theme to default
 */
async function tryHandleSlashCommand(
  userText: string,
  deploymentId: string,
  deployment: any,
  res: any,
  runId: string,
  threadId: string,
): Promise<boolean> {
  const trimmed = userText.trim();
  if (!trimmed.startsWith("/")) return false;

  // Parse command and args
  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).map(a => a.toLowerCase());

  // ── /commands or /help ───────────────────────────────────────────────────
  if (command === "/commands" || command === "/help") {
    const presets = THEME_PRESET_NAMES.join(", ");
    const skins = (SKIN_NAMES as readonly string[]).join(", ");
    const text = `## Available Commands

| Command | Description |
|---------|------------|
| \`/theme <preset>\` | Change color preset (${presets}) |
| \`/skin <skin>\` | Change chat skin (${skins}) |
| \`/color-preset <preset>\` | Alias for /theme |
| \`/reset\` | Reset theme & skin to default |
| \`/clear\` | Clear chat history |
| \`/commands\` | Show this help |

**Presets:** ${presets}
**Skins:** ${skins}

*Skin descriptions:*
${Object.entries(SKIN_DESCRIPTIONS).map(([k, v]) => `- **${k}**: ${v}`).join("\n")}`;

    sendQuickResponse(res, runId, threadId, text);
    return true;
  }

  // ── /clear ───────────────────────────────────────────────────────────────
  if (command === "/clear") {
    sendEvent(res, { type: "RUN_STARTED", runId, threadId });
    const mid = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId: mid, role: "assistant" });
    sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId: mid, delta: "Chat cleared." });
    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId: mid });
    sendEvent(res, { type: CUSTOM, name: "jarble.clear_chat", value: {} });
    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();
    return true;
  }

  // ── /reset ───────────────────────────────────────────────────────────────
  if (command === "/reset") {
    await db.update(tables.deployments)
      .set({ themeConfig: null } as any)
      .where(eq(tables.deployments.id, deploymentId));

    sendQuickResponse(res, runId, threadId, "Theme reset to default. Clean slate!", () => {
      sendEvent(res, { type: CUSTOM, name: "jarble.theme.updated", value: null });
    });
    log.info({ deploymentId }, "Slash: theme reset via /reset");
    return true;
  }

  // ── /theme or /color-preset ──────────────────────────────────────────────
  if (command === "/theme" || command === "/color-preset") {
    if (args.length === 0) {
      const presets = THEME_PRESET_NAMES.join(", ");
      sendQuickResponse(res, runId, threadId,
        `Usage: \`${command} <preset> [skin]\`\n\n**Presets:** ${presets}\n\nType \`/commands\` for full list.`);
      return true;
    }
    return handleThemeChange(args, deploymentId, deployment, res, runId, threadId);
  }

  // ── /skin ────────────────────────────────────────────────────────────────
  if (command === "/skin") {
    if (args.length === 0) {
      const skins = (SKIN_NAMES as readonly string[]).join(", ");
      sendQuickResponse(res, runId, threadId,
        `Usage: \`/skin <name>\`\n\n**Skins:** ${skins}\n\nType \`/commands\` for descriptions.`);
      return true;
    }
    return handleThemeChange(args, deploymentId, deployment, res, runId, threadId, true);
  }

  // Unknown slash command — let the pod handle it
  return false;
}

/** Apply a theme/skin change from slash command args. */
async function handleThemeChange(
  args: string[],
  deploymentId: string,
  deployment: any,
  res: any,
  runId: string,
  threadId: string,
  skinOnly = false,
): Promise<boolean> {
  let preset: string | undefined;
  let skin: string | undefined;

  for (const arg of args) {
    if (!skinOnly && THEME_PRESET_NAMES.includes(arg as any)) preset = arg;
    if ((SKIN_NAMES as readonly string[]).includes(arg)) skin = arg;
  }

  if (!preset && !skin) {
    const available = skinOnly
      ? `**Skins:** ${(SKIN_NAMES as readonly string[]).join(", ")}`
      : `**Presets:** ${THEME_PRESET_NAMES.join(", ")}\n**Skins:** ${(SKIN_NAMES as readonly string[]).join(", ")}`;
    sendQuickResponse(res, runId, threadId,
      `Unknown ${skinOnly ? "skin" : "preset"}. ${available}`);
    return true;
  }

  // Build theme config
  const currentConfig = deployment.themeConfig
    ? (() => { try { return JSON.parse(deployment.themeConfig); } catch { return {}; } })()
    : {};

  const newConfig = { ...currentConfig };
  if (preset) newConfig.preset = preset;
  if (skin) newConfig.skin = skin;

  // Validate
  const error = validateThemeConfig(newConfig);
  if (error) {
    sendQuickResponse(res, runId, threadId, `Couldn't set that theme: ${error}`);
    return true;
  }

  // Persist to DB
  await db.update(tables.deployments)
    .set({ themeConfig: JSON.stringify(newConfig) } as any)
    .where(eq(tables.deployments.id, deploymentId));

  // Build response
  const parts: string[] = [];
  if (preset) parts.push(`**Color preset**: ${preset}`);
  if (skin) parts.push(`**Skin**: ${skin}`);
  if (skin && skin !== "default" && SKIN_DESCRIPTIONS[skin]) {
    parts.push(`\n*${SKIN_DESCRIPTIONS[skin]}*`);
  }

  sendQuickResponse(res, runId, threadId, `Theme updated!\n\n${parts.join("\n")}`, () => {
    sendEvent(res, { type: CUSTOM, name: "jarble.theme.updated", value: newConfig });
  });

  log.info({ deploymentId, preset, skin }, "Slash: theme changed via command");
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

  // ── Slash command interception — handle /theme, /commands, etc. directly ──
  // Must run BEFORE RUN_STARTED to avoid double-emit (command handler sends its own).
  if (lastUserText.trim()) {
    const commandResult = await tryHandleSlashCommand(lastUserText, deploymentId, deployment, res, runId, threadId);
    if (commandResult) return;
  }

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

  // Register with session manager so WS control channel can abort this run
  sessionManager.registerRun(deploymentId, runId, abortController);

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

  // Wrap res.end to always clean up timers and unregister from session manager
  const originalEnd = res.end.bind(res);
  res.end = ((...args: any[]) => {
    cleanupTimers();
    sessionManager.unregisterRun(deploymentId);
    markDeploymentIdle(deploymentId);
    return originalEnd(...args);
  }) as typeof res.end;

  req.on("close", () => {
    log.debug({ deploymentId, threadId }, "Chat client disconnected");
    cleanupTimers();
    abortController.abort();
    sessionManager.unregisterRun(deploymentId);
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

  // ── Agent call event listeners ─────────────────────────────────────────────
  // When the MCP server inside the pod calls /api/agent-hub/call, the agent-hub
  // route emits events. We forward them to the SSE stream so the frontend
  // can show an inline "Delegating to X Agent..." indicator.
  const onAgentCallStart = (evt: AgentCallStartEvent) => {
    if (evt.deploymentId !== deploymentId) return;
    sendEvent(res, {
      type: CUSTOM,
      name: CUSTOM_AGENT_CALL_START,
      value: { serviceId: evt.serviceId, skillName: evt.skillName, agentName: evt.agentName },
    });
  };
  const onAgentCallEnd = (evt: AgentCallEndEvent) => {
    if (evt.deploymentId !== deploymentId) return;
    sendEvent(res, {
      type: CUSTOM,
      name: CUSTOM_AGENT_CALL_END,
      value: { serviceId: evt.serviceId, skillName: evt.skillName, agentName: evt.agentName, creditsCharged: evt.creditsCharged, success: evt.success },
    });
  };
  agentCallEvents.on("start", onAgentCallStart);
  agentCallEvents.on("end", onAgentCallEnd);

  // Clean up agent call listeners when the SSE stream closes
  const cleanupAgentListeners = () => {
    agentCallEvents.off("start", onAgentCallStart);
    agentCallEvents.off("end", onAgentCallEnd);
  };
  res.on("close", cleanupAgentListeners);

  // Track the last delta text to compute incremental deltas for SSE
  let lastDeltaText = "";
  const convId = body.conversationId || "";
  const sessionKey = `jarble-web-${authenticatedUserId || "anon"}${convId ? `-${convId}` : ""}`;

  // ── External reasoning (GPT-4o-mini) ──────────────────────────────────────
  // Fire immediately — resolves in ~1-2s while bot call takes 5-60s.
  // Emits REASONING_START/CONTENT/END events before or alongside bot text.
  // Skip for Claude models with native extended thinking — they emit real thinking blocks.
  const hasNativeThinking = deployment.llmProvider === "anthropic" && (
    (deployment.llmModel || "").includes("sonnet-4") || (deployment.llmModel || "").includes("opus-4")
  );
  const reasoningMsgId = nanoid();
  let externalReasoningEmitted = hasNativeThinking; // pre-mark as emitted to skip
  const reasoningPromise = hasNativeThinking ? Promise.resolve("") : generateReasoning(lastUserText);

  /** Emit external reasoning events (once). Resolves when reasoning is sent. */
  const emitExternalReasoning = async () => {
    if (externalReasoningEmitted) return;
    try {
      const reasoning = await reasoningPromise;
      if (reasoning && !externalReasoningEmitted) {
        externalReasoningEmitted = true;
        sendEvent(res, { type: REASONING_START, messageId: reasoningMsgId });
        sendEvent(res, { type: REASONING_CONTENT, messageId: reasoningMsgId, delta: reasoning });
        sendEvent(res, { type: REASONING_END, messageId: reasoningMsgId });
      }
    } catch {
      // Non-fatal — skip reasoning
    }
  };

  // Reasoning tag tracker — still parses <think>/<reasoning> tags from bot text
  // as a fallback. If external reasoning was already emitted, tag-based reasoning
  // is suppressed to avoid duplicates.
  const reasoningTracker = createReasoningTracker();

  /** Process a streaming text delta through the reasoning tracker and emit appropriate events. */
  const emitStreamingDelta = (fullTextSoFar: string) => {
    const visibleDelta = reasoningTracker.process(fullTextSoFar, {
      onReasoningStart: () => {
        if (!externalReasoningEmitted) {
          sendEvent(res, { type: REASONING_START, messageId: reasoningMsgId });
        }
      },
      onReasoningContent: (delta) => {
        if (!externalReasoningEmitted) {
          sendEvent(res, { type: REASONING_CONTENT, messageId: reasoningMsgId, delta });
        }
      },
      onReasoningEnd: () => {
        if (!externalReasoningEmitted) {
          sendEvent(res, { type: REASONING_END, messageId: reasoningMsgId });
        }
      },
    });
    if (visibleDelta) {
      // Strip jarble_suggestions blocks from streaming text so they don't render
      // as code blocks in chat. The suggestions are extracted separately on the
      // final response and emitted as CUSTOM_SUGGESTIONS events.
      const cleaned = visibleDelta
        .replace(/```jarble_suggestions\s*\n[\s\S]*?```/g, "")
        .replace(/\n{3,}/g, "\n\n");
      if (cleaned.trim()) {
        sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: cleaned });
      }
    }
    lastDeltaText = fullTextSoFar;
  };

  // In local dev (USE_SQLITE), pod IPs are unreachable from the host — skip
  // the WS gateway entirely and go straight to exec through the K8s API.
  const useExecOnly = process.env.USE_SQLITE === "true" || process.env.USE_SQLITE === "1";

  // Helper: send a gateway result as SSE events
  const emitGatewayResult = async (gatewayResult: GatewayResponse) => {
    // Process any remaining text through reasoning tracker (handles final deltas)
    if (gatewayResult.rawText.length > lastDeltaText.length) {
      emitStreamingDelta(gatewayResult.rawText);
    }

    // If reasoning was still open when the response ended, close it
    if (reasoningTracker.state.inReasoning && reasoningTracker.state.started && !externalReasoningEmitted) {
      sendEvent(res, { type: REASONING_END, messageId: reasoningMsgId });
    }

    // For non-streaming paths (exec), reasoning tags may still be in rawText.
    // Skip if external reasoning was already emitted (avoids duplicates).
    if (!externalReasoningEmitted) {
      const reasoningBlocks = extractReasoningBlocks(gatewayResult.rawText);
      if (reasoningBlocks.length > 0 && !reasoningTracker.state.started) {
        for (const block of reasoningBlocks) {
          sendEvent(res, { type: REASONING_START, messageId: reasoningMsgId });
          sendEvent(res, { type: REASONING_CONTENT, messageId: reasoningMsgId, delta: block });
          sendEvent(res, { type: REASONING_END, messageId: reasoningMsgId });
        }
      }
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
      // Emit tool status for frontend indicator
      const toolStatus = getToolStatus(block.component);
      sendEvent(res, {
        type: CUSTOM,
        name: CUSTOM_TOOL_STATUS,
        value: { status: toolStatus, component: block.component, toolCallId },
      });
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

    // Emit design context if the bot updated it this turn
    if (gatewayResult.designContext) {
      sendEvent(res, {
        type: CUSTOM,
        name: CUSTOM_DESIGN_CONTEXT,
        value: gatewayResult.designContext,
      });
      log.debug({ deploymentId }, "Chat: emitted design context update");
    }

    // Emit suggestions — use bot's own suggestions if present, otherwise generate via secondary model
    if (gatewayResult.suggestions && gatewayResult.suggestions.length > 0) {
      sendEvent(res, {
        type: CUSTOM,
        name: CUSTOM_SUGGESTIONS,
        value: { suggestions: gatewayResult.suggestions.map(s => ({ prompt: s })) },
      });
      log.debug({ deploymentId, count: gatewayResult.suggestions.length, source: "bot" }, "Chat: emitted suggestions");
    } else {
      // Secondary model call — cheap GPT-4o-mini generates contextual follow-ups
      try {
        const generated = await generateSuggestions(lastUserText, gatewayResult.text);
        if (generated.length > 0) {
          sendEvent(res, {
            type: CUSTOM,
            name: CUSTOM_SUGGESTIONS,
            value: { suggestions: generated.map(s => ({ prompt: s })) },
          });
          log.debug({ deploymentId, count: generated.length, source: "secondary" }, "Chat: emitted suggestions");
        }
      } catch {
        // Non-fatal — skip suggestions for this turn
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
          emitStreamingDelta(fullTextSoFar);
        }
      },
    );
  };

  // ── Exec-only path (local dev) ──────────────────────────────────────────────
  if (useExecOnly) {
    try {
      log.debug({ deploymentId }, "Local dev: using exec-only path (skipping WS gateway)");
      // Emit reasoning while bot processes (reasoning ~1-2s, bot ~5-60s)
      await emitExternalReasoning();
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

      // Emit reasoning before streaming starts (reasoning ~1-2s, gateway connects ~0.5s)
      await emitExternalReasoning();

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
            emitStreamingDelta(fullTextSoFar);
          }
        },
        abortController.signal,
        // Emit UI blocks as soon as they're detected during streaming (before response finishes)
        async (block) => {
          try {
            const resolved = await resolveUIBlocks([block], deploymentId, managedBy);
            for (const b of resolved) {
              // Emit tool status for frontend indicator
              const toolStatus = getToolStatus(b.component);
              sendEvent(res, {
                type: CUSTOM,
                name: CUSTOM_TOOL_STATUS,
                value: { status: toolStatus, component: b.component, toolCallId: b.id },
              });
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

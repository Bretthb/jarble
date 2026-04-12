/**
 * Chat Endpoint - Pod proxy for direct OpenClaw conversation.
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
import { db, tables, dbDate } from "../db/index.js";
import { markDeploymentActive, markDeploymentIdle } from "../services/configSync.js";
import { env } from "../utils/env.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("chat");

// ── Parallel delegation concurrency ─────────────────────────────────────────
// Controls how many specialist delegations fan out concurrently within a
// single chat turn.  Env-configurable so operators can tune for pod capacity.
const MAX_CONCURRENT_DELEGATIONS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_DELEGATIONS ?? "5", 10) || 5,
);

// Per-session exec lock is now shared with flowChat.ts via the utils helper.
// See src/utils/sessionLock.ts for the implementation + Cycle 15 tests.
import { withSessionLock } from "../utils/sessionLock.js";

import { verifyToken, getUserFromToken } from "../services/auth.js";
import { getPodAddress, findPodForDeployment } from "../k8s/index.js";
import type { ManagedBy } from "../k8s/constants.js";
import { getContainerName } from "../k8s/constants.js";
import { chatViaGateway, chatViaHTTP, chatViaExec, type GatewayResponse } from "../services/openclawGateway.js";
import { extractUIBlocks, type JarbleUIBlock, type JarbleComponentDef } from "../utils/uiBlockParser.js";
import { readComponentFromPvc, writeComponentToPvc } from "../k8s/index.js";
import {
  isBuiltinComponent,
  resolveCustomComponent,
  type ComponentDefinition,
} from "../utils/componentResolver.js";
import { classifyError } from "../utils/chatErrors.js";
import { getOpenRouterCreditStatus } from "../utils/openrouter.js";
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
import { collectLlmCompletion } from "../services/llmProxy.js";
import {
  buildDelegationTools,
  buildFlowSystemPrompt,
  parseDelegationCalls,
  executeDelegation,
  type DelegationTool,
} from "../services/flowDelegation.js";
import type { FlowDefinition, FlowNode, FlowEdge } from "../services/flowEngine.js";
import { normalizeFlowDefinition } from "../services/flowEngine.js";

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
  compose_dashboard: "Generating dashboard components in parallel...",
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
    // Flush immediately so SSE events reach the client per-token
    // (without this, Node.js/compression middleware buffers writes)
    if (typeof res.flush === "function") res.flush();
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
      // Connection is doomed - nothing more we can do
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
   * Reset tracker state. JAR-63: called when the chat transport falls
   * back (HTTP → WS → exec) so partial state from an aborted stream
   * does not corrupt the next attempt's offset tracking.
   */
  function reset(): void {
    state.inReasoning = false;
    state.processedLength = 0;
    state.started = false;
  }

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
          // No - we matched it, so it's complete
          callbacks.onReasoningStart();
          state.started = true;
        } else {
          // Check if there's a potential partial opening tag at the end
          // e.g., the text ends with "<thi" which might become "<think>"
          const partialTagIdx = findPartialOpenTag(remaining);
          if (partialTagIdx !== -1) {
            // Emit everything before the potential partial tag
            visibleDelta += remaining.slice(0, partialTagIdx);
            // Don't advance processedLength past the partial tag - we'll
            // re-process it on the next delta when more text arrives.
            state.processedLength += newText.length - remaining.length + partialTagIdx;
            return visibleDelta;
          }
          // No tag found - all visible text
          visibleDelta += remaining;
          remaining = "";
        }
      } else {
        // Inside reasoning - look for closing tag
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
          // No closing tag - entire remaining text is reasoning
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

  return { process, reset, state };
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
    // Well-formed pairs: <think>...</think> or <reasoning>...</reasoning>
    .replace(/<(think|reasoning)>[\s\S]*?<\/\1>/gi, "")
    // Malformed/partial tags: <think without closing >, bare </think>, etc.
    // Catches cases where the model starts <think but switches context mid-token.
    .replace(/<\/?(?:think|reasoning)\b[^>]*>?/gi, "")
    // ```jarble_delegate``` fenced blocks are dispatch instructions from the
    // bot (parsed into real delegation calls upstream). They must never survive
    // into persisted chat history — otherwise the raw JSON leaks into future
    // renders of the conversation.
    .replace(/```jarble_delegate\s*\n[\s\S]*?```/g, "")
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
  minimal: "clean and spacious - hidden avatars, borderless messages",
  win98: "classic Windows 98 - silver gray, 3D beveled borders, blue title bar",
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
 *   /theme <preset> [skin]  - Change color preset and/or skin
 *   /color-preset <preset>  - Alias for /theme
 *   /skin <skin>            - Change chat skin only
 *   /commands, /help        - List available commands
 *   /clear                  - Signal frontend to clear chat
 *   /reset                  - Reset theme to default
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

  // Unknown slash command - let the pod handle it
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
    // When called from /theme: match presets first, only match skin if it's NOT also a preset name
    // When called from /skin: only match skins (skinOnly=true)
    if (!skinOnly && THEME_PRESET_NAMES.includes(arg as any)) {
      preset = arg;
    } else if ((SKIN_NAMES as readonly string[]).includes(arg)) {
      skin = arg;
    }
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
    // Custom component - try to resolve from PVC
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
      // Secret auth is service-to-service - require userId in body for ownership check
      if (req.body.userId) {
        authenticatedUserId = req.body.userId;
      }
    } else {
      // No secret configured and no JWT - always reject (even in dev mode)
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

  // Track active chat session so auto-sync doesn't restart the gateway mid-conversation
  // Placed AFTER ownership check to avoid leaking active state on auth failures.
  markDeploymentActive(deploymentId);

  const managedBy = ((deployment as any).managedBy ?? "legacy") as ManagedBy;
  const requestStartMs = Date.now();
  const agMessages = body.messages || [];
  const canvasImage: string | undefined = body.canvasImage; // base64 JPEG from frontend canvas screenshot

  // Extract last user message
  const lastUserMsg = [...agMessages].reverse().find((m: any) => m.role === "user");
  const lastUserText = lastUserMsg
    ? (typeof lastUserMsg.content === "string"
      ? lastUserMsg.content
      : Array.isArray(lastUserMsg.content)
        ? lastUserMsg.content.map((c: any) => c.text || "").join("")
        : "")
    : "";

  // ── Input validation ────────────────────────────────────────────────
  // Cap message length to prevent oversized kubectl exec arguments.
  // SSE headers are already sent, so we send the error as an SSE event.
  const MAX_DIRECT_CHAT_MESSAGE_LENGTH = 10_000;
  if (lastUserText.length > MAX_DIRECT_CHAT_MESSAGE_LENGTH) {
    sendEvent(res, { type: "RUN_STARTED", runId, threadId });
    const errMsgId = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId: errMsgId, role: "assistant" });
    sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId: errMsgId, delta: `Message too long (${lastUserText.length} chars). Maximum is ${MAX_DIRECT_CHAT_MESSAGE_LENGTH} characters. Please shorten your message.` });
    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId: errMsgId });
    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();
    return;
  }

  // Strip user-injected control tags that are reserved for server-side
  // injection. Prevents prompt injection where a user prepends their own
  // [DELEGATION_CONTEXT] or [CANVAS_STATE] to manipulate bot behavior.
  let sanitizedText = lastUserText
    .replace(/\[DELEGATION_CONTEXT\][\s\S]*?\[\/DELEGATION_CONTEXT\]/gi, "")
    .replace(/\[CANVAS_STATE\][\s\S]*?\[\/CANVAS_STATE\]/gi, "")
    .replace(/\[FLOW CONTEXT\][\s\S]*?\[\/FLOW CONTEXT\]/gi, "")
    .replace(/\[FLOW SYSTEM INSTRUCTIONS[^\]]*\][\s\S]*?\[\/FLOW SYSTEM INSTRUCTIONS\]/gi, "")
    .trim();

  // If canvas image is provided, append a vision context note to the message
  // so the bot knows it can see the canvas
  let messageWithVision = sanitizedText;
  if (canvasImage) {
    messageWithVision += "\n\n[CANVAS_SCREENSHOT attached - you can see the current canvas layout, rendered components, and any drawings the user made. Describe what you see if relevant to the request.]";
    log.info({ deploymentId, imageSize: Math.round(canvasImage.length / 1024) + "KB" }, "Chat: canvas image attached");
  }

  log.info({ deploymentId, messageLength: lastUserText.length, hasCanvasImage: !!canvasImage }, "Chat: request started");

  // ── JAR-50: record the ROOT agent_calls row for this chat turn ──
  // This anchors the trace tree. Every delegation hop spawned by this chat
  // turn will pass `rootAgentCall.callId` as `parentCallId` so the whole
  // cascade stitches back to this single root.
  // Fire-and-forget: the writer catches its own errors — audit failures
  // must never break the chat path.
  const { startAgentCall: startRootAgentCall, finishAgentCall: finishRootAgentCall } =
    await import("../services/agentCallsWriter.js");
  const rootAgentCall = await startRootAgentCall({
    kind: "chat_turn",
    skillName: "__chat_turn__",
    callerDeploymentId: null, // user is the caller, not a deployment
    calleeDeploymentId: deploymentId,
    parentCallId: null,
    parentSpanId: null,
    traceId: null, // will be generated by the writer
    depth: 0,
    userId: authenticatedUserId,
    orgId: deployment.orgId,
    sessionId: threadId,
    spanName: "jarble.chat.turn",
    requestBody: sanitizedText,
    attributes: {
      runId,
      threadId,
      hasCanvasImage: !!canvasImage,
      messageLength: sanitizedText.length,
    },
  });
  let rootCallFinished = false;
  const finishRoot = async (
    status: "completed" | "failed",
    extra?: { errorMessage?: string; attributes?: Record<string, unknown> },
  ) => {
    if (rootCallFinished) return;
    rootCallFinished = true;
    await finishRootAgentCall({
      call: rootAgentCall,
      status,
      errorMessage: extra?.errorMessage,
      attributes: extra?.attributes,
    });
  };

  // ── Slash command interception - handle /theme, /commands, etc. directly ──
  // Must run BEFORE RUN_STARTED to avoid double-emit (command handler sends its own).
  // Strip canvas state/design context prefixes to find the actual user text for slash detection.
  const slashText = sanitizedText
    .replace(/\[DESIGN_CONTEXT\][\s\S]*?\[\/DESIGN_CONTEXT\]\n?/g, "")
    .replace(/\[EDITING [^\]]*\][\s\S]*?\[\/EDITING\]\n?/g, "")
    .trim();
  if (slashText) {
    const commandResult = await tryHandleSlashCommand(slashText, deploymentId, deployment, res, runId, threadId);
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

  // Master timeout: 5 minutes - prevents indefinitely hanging connections
  // if the gateway WebSocket or exec hangs without triggering its own timeout.
  // Initialized as null and armed after messageId is defined (avoids TDZ reference).
  const MASTER_TIMEOUT_MS = 5 * 60 * 1000;
  let masterTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Clear all timers and abort. Called on disconnect or successful completion. */
  const cleanupTimers = () => {
    clearInterval(keepAliveInterval);
    if (masterTimeout) clearTimeout(masterTimeout);
  };

  // Guard against double-cleanup (res.end fires, then req.close fires)
  let chatCleaned = false;
  const cleanupChat = () => {
    if (chatCleaned) return;
    chatCleaned = true;
    cleanupTimers();
    sessionManager.unregisterRun(deploymentId);
    markDeploymentIdle(deploymentId);
    // JAR-50: Close the root agent_calls row. If finishRoot was already
    // called with an explicit status, this is a no-op. Otherwise we mark
    // it completed — the stream ended cleanly.
    void finishRoot("completed");
  };

  // Wrap res.end to always clean up timers and unregister from session manager
  const originalEnd = res.end.bind(res);
  res.end = ((...args: any[]) => {
    cleanupChat();
    return originalEnd(...args);
  }) as typeof res.end;

  // Track client disconnect - when client navigates away, we stop sending SSE
  // events but let the bot finish so we can persist the response to DB.
  let clientDisconnected = false;

  req.on("close", () => {
    log.debug({ deploymentId, threadId }, "Chat client disconnected");
    clientDisconnected = true;
    cleanupChat();
    // DON'T abort - let the bot finish so we can save the response.
    // Only abort if the request has been running for more than 5 minutes (orphan safety).
    setTimeout(() => {
      if (!abortController.signal.aborted) {
        log.info({ deploymentId }, "Orphaned chat request timed out after 5 min");
        abortController.abort();
      }
    }, 5 * 60 * 1000);
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

  // ── Safe SSE write - skip writes when client has disconnected ──────────────
  /** Wrapper around sendEvent that silently drops writes when the client is gone. */
  const safeSendEvent = (r: any, data: Record<string, unknown>) => {
    if (!clientDisconnected && !r.writableEnded) {
      sendEvent(r, data);
    }
  };

  // ── Pod Proxy - WebSocket to OpenClaw gateway (streaming) ───────────────────

  // Empty messages (e.g. Tambo init probes or StrictMode double-mounts) -
  // return a no-op success instead of exec'ing with an empty --message flag.
  if (!sanitizedText.trim()) {
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

  // Preflight managed-credits check. For "included" deployments, we look up
  // the OpenRouter key's current usage and fail fast with a structured error
  // if the monthly cap is exhausted — otherwise the request would hit the
  // pod, round-trip to OpenRouter, and return an opaque 402.
  if (deployment.llmMode === "included") {
    let keyIdForCredits = deployment.llmApiKeyId;
    const sourceDeploymentId = deployment.llmApiKeySourceDeploymentId;
    if (sourceDeploymentId) {
      const owner = await db.query.deployments.findFirst({
        where: eq(tables.deployments.id, sourceDeploymentId),
      });
      keyIdForCredits = owner?.llmApiKeyId || keyIdForCredits;
    }

    if (keyIdForCredits) {
      try {
        const creditStatus = await getOpenRouterCreditStatus(keyIdForCredits);
        if (creditStatus && creditStatus.level === "exhausted") {
          const classified = classifyError("insufficient credits", {});
          const messageId = nanoid();
          sendEvent(res, { type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
          sendEvent(res, {
            type: "TEXT_MESSAGE_CONTENT",
            messageId,
            delta: "Your managed credits are exhausted for this billing cycle. Add credits or upgrade your plan to keep chatting.",
          });
          sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
          sendEvent(res, {
            type: CUSTOM,
            name: CUSTOM_CHAT_ERROR,
            value: { error: classified, creditStatus },
          });
          sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
          res.end();
          return;
        }
      } catch (err) {
        // Non-fatal: if the Management API is flaky we'd rather let the
        // chat proceed and surface any 402 downstream than block the user.
        log.warn({ err, deploymentId }, "Chat: credit preflight check failed, continuing");
      }
    }
  }

  const messageId = nanoid();
  safeSendEvent(res, { type: "TEXT_MESSAGE_START", messageId, role: "assistant" });

  // Arm the master timeout now that messageId is defined
  masterTimeout = setTimeout(() => {
    if (clientDisconnected || res.writableEnded) return;
    log.warn({ deploymentId, threadId }, "Chat SSE master timeout (5 min) - closing connection");
    safeSendEvent(res, {
      type: "TEXT_MESSAGE_CONTENT",
      messageId,
      delta: "\n\nSorry, the request timed out. The bot may be processing a complex task - please try again.",
    });
    safeSendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
    safeSendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    if (!clientDisconnected) res.end();
    abortController.abort();
  }, MASTER_TIMEOUT_MS);

  // ── Agent call event listeners ─────────────────────────────────────────────
  // When the MCP server inside the pod calls /api/agent-hub/call, the agent-hub
  // route emits events. We forward them to the SSE stream so the frontend
  // can show an inline "Delegating to X Agent..." indicator.
  const onAgentCallStart = (evt: AgentCallStartEvent) => {
    if (evt.deploymentId !== deploymentId) return;
    safeSendEvent(res, {
      type: CUSTOM,
      name: CUSTOM_AGENT_CALL_START,
      value: { serviceId: evt.serviceId, skillName: evt.skillName, agentName: evt.agentName },
    });
  };
  const onAgentCallEnd = (evt: AgentCallEndEvent) => {
    if (evt.deploymentId !== deploymentId) return;
    safeSendEvent(res, {
      type: CUSTOM,
      name: CUSTOM_AGENT_CALL_END,
      value: { serviceId: evt.serviceId, skillName: evt.skillName, agentName: evt.agentName, creditsCharged: evt.creditsCharged, success: evt.success },
    });
  };
  agentCallEvents.on("start", onAgentCallStart);
  agentCallEvents.on("end", onAgentCallEnd);

  // Fractal Piece 4 wiring: forward orchestration step events to the
  // frontend so the OrchestrationSteps tree can render nested
  // delegations with parentId set. The backend emits these via
  // emitOrchestrationStart/End from flowDelegation.ts on every
  // delegation hop (including recursive sub-delegations), and the
  // events already carry parentStepId + depth.
  const onOrchestrationStart = (evt: import("../utils/agentCallEvents.js").OrchestrationStepEvent) => {
    if (evt.deploymentId !== deploymentId) return;
    safeSendEvent(res, {
      type: CUSTOM,
      name: "jarble.orchestration.step.start",
      value: {
        stepId: evt.stepId,
        agentType: evt.agentType,
        agentName: evt.agentName,
        toolName: evt.toolName,
        task: evt.task,
        targetDeploymentId: evt.targetDeploymentId,
        parentStepId: evt.parentStepId,
        depth: evt.depth,
      },
    });
  };
  const onOrchestrationEnd = (evt: import("../utils/agentCallEvents.js").OrchestrationStepEndEvent) => {
    if (evt.deploymentId !== deploymentId) return;
    safeSendEvent(res, {
      type: CUSTOM,
      name: "jarble.orchestration.step.end",
      value: {
        stepId: evt.stepId,
        success: evt.success,
        durationMs: evt.durationMs,
        error: evt.error,
        resultPreview: evt.resultPreview,
      },
    });
  };
  agentCallEvents.on("orchestration:step:start", onOrchestrationStart);
  agentCallEvents.on("orchestration:step:end", onOrchestrationEnd);

  // Clean up agent call listeners when the SSE stream closes
  const cleanupAgentListeners = () => {
    agentCallEvents.off("start", onAgentCallStart);
    agentCallEvents.off("end", onAgentCallEnd);
    agentCallEvents.off("orchestration:step:start", onOrchestrationStart);
    agentCallEvents.off("orchestration:step:end", onOrchestrationEnd);
  };
  res.on("close", cleanupAgentListeners);

  // Track the last delta text to compute incremental deltas for SSE
  let lastDeltaText = "";
  const convId = body.conversationId || "";
  const sessionKey = `jarble-web-${authenticatedUserId || "anon"}${convId ? `-${convId}` : ""}`;

  // ── Persist user message to DB immediately ──────────────────────────────────
  // Fire-and-forget: save the user message before starting the bot request so
  // it survives client disconnects. Session must exist before message insert (FK).
  {
    const now = dbDate();
    (async () => {
      try {
        // Upsert chat session - must complete before message insert (FK constraint)
        const existing = await db.query.chatSessions.findFirst({
          where: eq(tables.chatSessions.id, convId),
        });
        if (existing) {
          await db.update(tables.chatSessions)
            .set({ updatedAt: now } as any)
            .where(eq(tables.chatSessions.id, convId));
        } else {
          await db.insert(tables.chatSessions).values({
            id: convId,
            deploymentId,
            title: sanitizedText.slice(0, 50),
            createdAt: now,
            updatedAt: now,
          } as any);
        }

        // Now safe to insert message (session exists)
        // sanitizedText already has control tags stripped; just use it directly
        const cleanUserText = sanitizedText;
        await db.insert(tables.chatMessages).values({
          id: nanoid(),
          sessionId: convId,
          role: "user",
          content: cleanUserText,
          createdAt: now,
        } as any);
      } catch (err: unknown) {
        log.warn({ err: err instanceof Error ? err.message : String(err), sessionKey }, "Failed to persist user message");
      }
    })();
  }

  // ── Team delegation context ──────────────────────────────────────────────
  // Check if this deployment is part of any bot team (flow) and build
  // delegation tools so the bot can delegate to team members.
  let teamDelegationTools: DelegationTool[] = [];
  let teamFlowNode: FlowNode | null = null;
  let teamFlowDefinition: FlowDefinition | null = null;
  // JAR-51: Flow id the team delegation belongs to. Passed into
  // `executeDelegation` so recursive sub-delegation stays within the same
  // flow membership (prevents cross-tenant recursion via the IDOR guard).
  let teamFlowId: string | null = null;

  try {
    const fdm = (tables as any).flowDeploymentMemberships;
    if (fdm) {
      // Find all flows this deployment belongs to
      const memberships = await db
        .select({ flowId: fdm.flowId, nodeId: fdm.nodeId })
        .from(fdm)
        .where(eq(fdm.deploymentId, deploymentId))
        .limit(10);

      if (memberships.length > 0) {
        // Use the active flow if set, otherwise fall back to the first membership
        const activeFlowId = (deployment as any).activeFlowId;
        const membership = (activeFlowId
          ? memberships.find((m: any) => m.flowId === activeFlowId)
          : null) || memberships[0];

        const flowRows = await db
          .select({
            id: tables.orchestrationFlows.id,
            definition: tables.orchestrationFlows.definition,
            name: tables.orchestrationFlows.name,
          })
          .from(tables.orchestrationFlows)
          .where(eq(tables.orchestrationFlows.id, membership.flowId))
          .limit(1);

        if (flowRows.length > 0) {
          const rawDef: FlowDefinition =
            typeof flowRows[0].definition === "string"
              ? JSON.parse(flowRows[0].definition)
              : (flowRows[0].definition as FlowDefinition);
          // Normalize so orchestration fields (role/goal/canDelegate/contextScope)
          // stored under `config` by the UI are readable at the top level.
          const def = normalizeFlowDefinition(rawDef as any) as FlowDefinition;

          if (def.nodes && def.edges) {
            const thisNode = def.nodes.find((n) => n.id === membership.nodeId);
            if (thisNode) {
              teamFlowNode = thisNode;
              teamFlowDefinition = def;
              teamFlowId = (membership.flowId ?? (flowRows as any)[0]?.id) ?? null;
              teamDelegationTools = buildDelegationTools(thisNode, def.nodes, def.edges);

              if (teamDelegationTools.length > 0) {
                // Augment the message with team context (same pattern as flowChat.ts)
                const basePrompt = (deployment as any).systemPrompt || "";
                const augmentedPrompt = buildFlowSystemPrompt(thisNode, teamDelegationTools, basePrompt);
                messageWithVision = `[TEAM CONTEXT]\n${augmentedPrompt}\n[/TEAM CONTEXT]\n\n${messageWithVision}`;

                log.info(
                  {
                    deploymentId,
                    flowId: flowRows[0].id,
                    flowName: flowRows[0].name,
                    nodeId: thisNode.id,
                    delegationToolCount: teamDelegationTools.length,
                  },
                  "Chat: injected team delegation context",
                );
              }
            }
          }
        }
      }
    }
  } catch (err) {
    // Non-fatal - bot works without team context
    log.debug({ deploymentId, err: err instanceof Error ? err.message : String(err) }, "Failed to load team context");
  }

  // ── Reasoning / Thinking ──────────────────────────────────────────────────
  // 3-tier strategy ensures every response gets a visible "thinking" block:
  //   1. Native thinking - extracted from OpenClaw's LLM response (highest quality)
  //   2. <think> tags - parsed from bot text by the reasoning tracker
  //   3. External reasoning - GPT-4o-mini generates a brief thinking summary (fallback)
  //
  // External reasoning fires immediately (resolves in ~1-2s) so it's ready
  // as a fallback by the time the bot response arrives (5-60s). We never skip
  // it - it's cheap ($0.00005/call) and acts as the safety net.
  const reasoningMsgId = nanoid();
  let reasoningEmitted = false; // true once ANY reasoning source has been emitted
  const reasoningPromise = generateReasoning(sanitizedText);

  /** Emit reasoning events from a given source (once). */
  const emitReasoningBlock = (content: string, source: string) => {
    if (reasoningEmitted || !content) return;
    reasoningEmitted = true;
    log.debug({ deploymentId, source, length: content.length }, "Chat: emitting reasoning");
    safeSendEvent(res, { type: REASONING_START, messageId: reasoningMsgId });
    safeSendEvent(res, { type: REASONING_CONTENT, messageId: reasoningMsgId, delta: content });
    safeSendEvent(res, { type: REASONING_END, messageId: reasoningMsgId });
  };

  /** Emit external reasoning as fallback (once). */
  const emitExternalReasoning = async () => {
    if (reasoningEmitted) return;
    try {
      const reasoning = await reasoningPromise;
      if (reasoning) emitReasoningBlock(reasoning, "external");
    } catch {
      // Non-fatal - skip reasoning
    }
  };

  // Reasoning tag tracker - parses <think>/<reasoning> tags from bot text.
  // If reasoning was already emitted from another source, tag-based reasoning
  // is suppressed to avoid duplicates.
  const reasoningTracker = createReasoningTracker();

  /** Process a streaming text delta through the reasoning tracker and emit appropriate events.
   *  Also suppresses jarble_ui/jarble_suggestions fenced blocks from the text stream -
   *  UI blocks are emitted separately as TOOL_CALL events via onBlockDetected. */
  let inFencedBlock = false; // tracks whether we're mid-way through a ```jarble_* fence
  let fenceBuffer = ""; // accumulates text when we might be entering a fence
  const emitStreamingDelta = (fullTextSoFar: string) => {
    const visibleDelta = reasoningTracker.process(fullTextSoFar, {
      onReasoningStart: () => {
        if (!reasoningEmitted) {
          reasoningEmitted = true;
          safeSendEvent(res, { type: REASONING_START, messageId: reasoningMsgId });
        }
      },
      onReasoningContent: (delta) => {
        if (reasoningEmitted && reasoningTracker.state.started) {
          safeSendEvent(res, { type: REASONING_CONTENT, messageId: reasoningMsgId, delta });
        }
      },
      onReasoningEnd: () => {
        if (reasoningTracker.state.started) {
          safeSendEvent(res, { type: REASONING_END, messageId: reasoningMsgId });
        }
      },
    });
    if (visibleDelta) {
      // Suppress text inside ```jarble_ui/jarble_suggestions/jarble_ui_update/jarble_ui_define fences.
      // These are extracted separately as TOOL_CALL events and must not leak into chat.
      let textToSend = "";
      const combined = fenceBuffer + visibleDelta;
      fenceBuffer = "";

      if (inFencedBlock) {
        // We're inside a fence - look for the closing ``` on its own line
        // (avoids matching backticks inside code_block/sandbox content)
        const closeMatch = combined.match(/\n```\s*(?:\n|$)/);
        if (closeMatch && closeMatch.index !== undefined) {
          inFencedBlock = false;
          // Continue processing text after the closing fence
          const afterFence = combined.slice(closeMatch.index + closeMatch[0].length);
          textToSend = afterFence;
        }
        // else: still inside fence, suppress everything
      } else {
        // Look for opening fence markers. `jarble_delegate` is included so
        // delegation tool-call blocks never leak to the user's chat stream
        // (they're parsed out of rawText separately and routed through
        // jarble.flow.delegation.start events). Without this suppression,
        // any path that falls through to direct text streaming — including
        // `canDelegate=false` nodes that the LLM ignores — would emit the
        // raw ```jarble_delegate\n{...}``` block into the bubble.
        const fenceMatch = combined.match(/```jarble_(?:ui|ui_update|ui_define|suggestions|design_context|delegate)\s*\n/);
        if (fenceMatch && fenceMatch.index !== undefined) {
          // Send text before the fence
          textToSend = combined.slice(0, fenceMatch.index);
          const afterOpen = combined.slice(fenceMatch.index + fenceMatch[0].length);
          // Check if closing ``` is in the same delta
          const closeIdx = afterOpen.indexOf("```");
          if (closeIdx !== -1) {
            textToSend += afterOpen.slice(closeIdx + 3);
          } else {
            inFencedBlock = true;
          }
        } else {
          // Check for partial fence at the end (e.g. text ends with "```jarble" but no \n yet)
          const partialMatch = combined.match(/```jarble[_a-z]*$/);
          if (partialMatch && partialMatch.index !== undefined) {
            textToSend = combined.slice(0, partialMatch.index);
            fenceBuffer = partialMatch[0]; // buffer until next delta completes the match
          } else {
            textToSend = combined;
          }
        }
      }

      const cleaned = textToSend.replace(/\n{3,}/g, "\n\n");
      if (cleaned.trim()) {
        safeSendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: cleaned });
      }
    }
    lastDeltaText = fullTextSoFar;
  };

  // Chat transport selection. The primary path (HTTP /v1/chat/completions)
  // gives true per-token streaming. The exec fallback (npx openclaw agent)
  // works everywhere but is batch-only. In local dev, pod IPs are
  // unreachable from the host, so exec is the only option.
  //
  // Previously this was `NODE_ENV === "development"` which also forced
  // exec on dev.jarble.ai (running with NODE_ENV=development) — making
  // the HTTP/WS paths dead code in that environment. Decoupled to a
  // dedicated env var so ops can enable the HTTP path without flipping
  // NODE_ENV (which requires STRIPE_WEBHOOK_SECRET, AUTH0_M2M_SECRET).
  //
  // JARBLE_CHAT_TRANSPORT=exec → always exec (local dev default)
  // JARBLE_CHAT_TRANSPORT=http → always try HTTP first, then WS, then exec
  // unset/auto → HTTP in production, exec in development
  const transportEnv = (process.env.JARBLE_CHAT_TRANSPORT || "").toLowerCase();
  const useExecOnly =
    transportEnv === "exec" ? true :
    transportEnv === "http" ? false :
    process.env.NODE_ENV === "development";

  // Helper: send a gateway result as SSE events
  const emitGatewayResult = async (gatewayResult: GatewayResponse) => {
    // Process any remaining text through reasoning tracker (handles final deltas)
    if (gatewayResult.rawText.length > lastDeltaText.length) {
      emitStreamingDelta(gatewayResult.rawText);
    }

    // If reasoning was still open when the response ended, close it
    if (reasoningTracker.state.inReasoning && reasoningTracker.state.started) {
      safeSendEvent(res, { type: REASONING_END, messageId: reasoningMsgId });
    }

    // ── Reasoning fallback chain ──
    // Priority 1: Native thinking from OpenClaw (highest quality - the LLM's own thinking)
    if (!reasoningEmitted && gatewayResult.nativeThinking) {
      emitReasoningBlock(gatewayResult.nativeThinking, "native");
    }

    // Priority 2: <think> tags parsed from bot text (already handled by tracker above)
    if (!reasoningEmitted) {
      const reasoningBlocks = extractReasoningBlocks(gatewayResult.rawText);
      if (reasoningBlocks.length > 0 && !reasoningTracker.state.started) {
        emitReasoningBlock(reasoningBlocks.join("\n"), "think-tags");
      }
    }

    // Priority 3: External reasoning from secondary model (GPT-4o-mini / Haiku)
    if (!reasoningEmitted) {
      await emitExternalReasoning();
    }

    // Notify the user if the response was truncated by a timeout
    if (gatewayResult.timedOut) {
      safeSendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "\n\n---\n*Response was cut short due to a timeout. The bot may have been processing a complex request - try breaking it into smaller parts.*" });
      log.warn({ deploymentId, textLength: gatewayResult.rawText.length }, "Chat: response truncated by gateway timeout");
    }

    // ── Team delegation round-trips ──────────────────────────────────────────
    // If this bot has delegation tools (is part of a team), check if the
    // response contains delegation calls and execute them.
    if (teamDelegationTools.length > 0 && teamFlowDefinition) {
      try {
        const delegationCalls = parseDelegationCalls(gatewayResult.rawText);

        if (delegationCalls.length === 0) {
          // Fix #6 — surface silent delegation failure.
          // See docs/audits/qa-bot-teams-2026-04-07.md for root cause.
          // When a deployment is part of a team, tools were built successfully, but
          // the bot didn't emit a valid ```json tool_call block, flag it explicitly
          // instead of falling through to "direct answer" mode without a trace.
          const hasDelegationMention = /\b(delegat(e|ing|ed)|ask(ed|ing)?\s+the\s+(specialist|researcher|team|expert|coordinator)|pass(ed|ing)?\s+(this|it)\s+to|hand(ing|ed)?\s+off\s+to)\b/i.test(
            gatewayResult.rawText ?? "",
          );
          const skipReason = hasDelegationMention
            ? ("mentioned_but_not_emitted" as const)
            : ("tool_call_not_emitted" as const);
          if (hasDelegationMention) {
            log.warn(
              {
                deploymentId,
                availableTools: teamDelegationTools.map((t) => t.name),
                rawTextPreview: gatewayResult.rawText.slice(0, 500),
              },
              "Bot mentioned delegation but did not emit a valid tool_call JSON block — silent delegation failure (tamboAgent path)",
            );
          }
          safeSendEvent(res, {
            type: CUSTOM,
            name: "jarble.flow.delegation.skipped",
            value: {
              reason: skipReason,
              availableToolCount: teamDelegationTools.length,
              availableTools: teamDelegationTools.map((t) => t.name),
            },
          });
        } else if (delegationCalls.length > 0) {
          log.info(
            { deploymentId, delegationCount: delegationCalls.length },
            "Chat: processing delegation calls from bot response",
          );

          // ── Phase 1: Pre-resolve all delegation jobs ────────────────────
          // Build the full list of { call, tool, roleName } upfront so we
          // can emit all start events before any I/O begins.
          interface DelegationJob {
            call: typeof delegationCalls[number];
            tool: DelegationTool;
            roleName: string;
            index: number;
          }

          const jobs: DelegationJob[] = [];
          for (let i = 0; i < delegationCalls.length; i++) {
            const call = delegationCalls[i];
            const tool = teamDelegationTools.find((t) => t.name === call.toolName);
            if (!tool) {
              log.warn({ deploymentId, toolName: call.toolName }, "Chat: delegation tool not found");
              continue;
            }
            const targetNode = teamFlowDefinition!.nodes.find(
              (n) => n.id === tool.targetNodeId,
            );
            const roleName = targetNode?.role || targetNode?.label || "Team member";
            jobs.push({ call, tool, roleName, index: i });
          }

          // ── Phase 2: Emit all delegation.start events upfront ───────────
          // The frontend can show all specialists as "in progress"
          // simultaneously, giving a responsive multi-agent feel.
          for (const job of jobs) {
            safeSendEvent(res, {
              type: CUSTOM,
              name: "jarble.flow.delegation.start",
              value: {
                toolName: job.call.toolName,
                targetNodeId: job.tool.targetNodeId,
                targetDeploymentId: job.tool.targetDeploymentId,
                targetRole: job.roleName,
                task: job.call.task.slice(0, 200),
              },
            });
          }

          // ── Phase 3: Fan out with Promise.allSettled in chunks ──────────
          // Each chunk of MAX_CONCURRENT_DELEGATIONS runs in parallel.
          // Chunks execute sequentially to cap overall concurrency.
          type SettledDelegation =
            | { status: "fulfilled"; result: Awaited<ReturnType<typeof executeDelegation>>; job: DelegationJob }
            | { status: "rejected"; reason: string; job: DelegationJob };

          const settled: SettledDelegation[] = [];

          for (let chunkStart = 0; chunkStart < jobs.length; chunkStart += MAX_CONCURRENT_DELEGATIONS) {
            const chunk = jobs.slice(chunkStart, chunkStart + MAX_CONCURRENT_DELEGATIONS);

            const chunkResults = await Promise.allSettled(
              chunk.map((job) =>
                executeDelegation({
                  targetDeploymentId: job.tool.targetDeploymentId,
                  targetNodeId: job.tool.targetNodeId,
                  task: job.call.task,
                  context: job.call.context,
                  contextScope: job.tool.contextScope,
                  conversationHistory: [{ role: "user", content: sanitizedText }],
                  // Session continuity: same conversation + same specialist = same session.
                  // The specialist remembers earlier delegations in this conversation.
                  // Different conversations get different sessions (convId changes on "New Chat").
                  sessionId: `team-${deploymentId}-${authenticatedUserId}-${job.tool.targetNodeId}-${convId || nanoid(6)}`,
                  depth: 1,
                  sourceDeploymentId: deploymentId,
                  toolName: job.call.toolName,
                  userId: authenticatedUserId ?? undefined,
                  // ── JAR-50 + JAR-51: stitch this delegation into the
                  // root chat-turn span and seed the recursion ancestor
                  // chain so a downstream attempt to route back to this
                  // entry bot is refused by DelegationCycleError.
                  parentCallId: rootAgentCall.callId,
                  parentSpanId: rootAgentCall.spanId,
                  traceId: rootAgentCall.traceId,
                  ancestorDeploymentIds: [deploymentId],
                  flowId: teamFlowId ?? undefined,
                }),
              ),
            );

            // Pair settled results with their jobs
            for (let j = 0; j < chunkResults.length; j++) {
              const r = chunkResults[j];
              if (r.status === "fulfilled") {
                settled.push({ status: "fulfilled", result: r.value, job: chunk[j] });
              } else {
                const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
                settled.push({ status: "rejected", reason: errMsg, job: chunk[j] });
              }
            }
          }

          // ── Phase 4: Emit results in original delegation order ──────────
          // Sort by original index so SSE events are deterministic
          // regardless of which specialist finished first.
          settled.sort((a, b) => a.job.index - b.job.index);

          for (const entry of settled) {
            const { job } = entry;

            if (entry.status === "fulfilled") {
              const delegationResult = entry.result;

              // Emit delegation end event
              safeSendEvent(res, {
                type: CUSTOM,
                name: "jarble.flow.delegation.end",
                value: {
                  toolName: job.call.toolName,
                  targetNodeId: job.tool.targetNodeId,
                  targetDeploymentId: job.tool.targetDeploymentId,
                  success: true,
                  durationMs: delegationResult.durationMs,
                  creditsUsed: delegationResult.creditsUsed,
                },
              });

              // Stream the delegation result as additional text
              if (delegationResult.response) {
                safeSendEvent(res, {
                  type: "TEXT_MESSAGE_CONTENT",
                  messageId,
                  delta: `\n\n**${job.roleName}:** ${delegationResult.response}`,
                });
              } else if (delegationResult.uiBlocks?.length) {
                // Specialist rendered a component but had no text response
                safeSendEvent(res, {
                  type: "TEXT_MESSAGE_CONTENT",
                  messageId,
                  delta: `\n\n**${job.roleName}** rendered ${delegationResult.uiBlocks.length} component${delegationResult.uiBlocks.length > 1 ? "s" : ""}.`,
                });
              }

              // Forward UI blocks produced by the delegated specialist to
              // the caller's canvas so charts/tables/components rendered
              // by specialists reach the user. Event name matches the one
              // flowChat.ts already uses (jarble.flow.delegation.uiblock)
              // so the frontend can share the handler.
              if (delegationResult.uiBlocks?.length) {
                for (const block of delegationResult.uiBlocks) {
                  safeSendEvent(res, {
                    type: CUSTOM,
                    name: "jarble.flow.delegation.uiblock",
                    value: {
                      delegationToolName: job.call.toolName,
                      sourceDeploymentId: job.tool.targetDeploymentId,
                      sourceRole: job.roleName,
                      block,
                    },
                  });
                }
              }
            } else {
              // Rejected delegation
              log.error(
                { deploymentId, targetNodeId: job.tool.targetNodeId, error: entry.reason },
                "Chat: delegation failed",
              );

              safeSendEvent(res, {
                type: CUSTOM,
                name: "jarble.flow.delegation.end",
                value: {
                  toolName: job.call.toolName,
                  targetNodeId: job.tool.targetNodeId,
                  targetDeploymentId: job.tool.targetDeploymentId,
                  success: false,
                  error: entry.reason,
                },
              });

              safeSendEvent(res, {
                type: "TEXT_MESSAGE_CONTENT",
                messageId,
                delta: `\n\n*Delegation to ${job.roleName} was unsuccessful. The team member may be busy or temporarily unavailable.*`,
              });
            }
          }
        }
      } catch (err) {
        // Non-fatal - don't break the chat if delegation parsing/execution fails
        log.warn(
          { deploymentId, err: err instanceof Error ? err.message : String(err) },
          "Chat: delegation round-trip failed (non-fatal)",
        );
      }
    }

    // ── Subagent delegation round-trips ─────────────────────────────────────
    // If the bot emitted jarble_delegate blocks targeting custom subagents
    // (not team members), intercept and route to the agent LLM endpoint.
    // This bridges the gap: OpenClaw can't call MCP tools at agent-turn time,
    // so subagent calls go through the same fenced-block pattern as Bot Teams.
    // Runs regardless of team membership — subagent calls that didn't match
    // a team member tool are handled here as a fallback.
    {
      try {
        const subagentCalls = parseDelegationCalls(gatewayResult.rawText);
        // Filter out calls already handled by team delegation
        const teamToolNames = new Set(teamDelegationTools.map((t) => t.name));
        const unmatchedCalls = subagentCalls.filter((c) => !teamToolNames.has(c.toolName));

        if (unmatchedCalls.length > 0) {
          // Look up this deployment's subagents from DB
          const deploymentSubagents = (tables as any).deploymentSubagents;
          let dbSubagents: any[] = [];
          if (deploymentSubagents) {
            try {
              dbSubagents = await db.query.deploymentSubagents?.findMany?.({
                where: eq(deploymentSubagents.deploymentId, deploymentId),
              }) ?? [];
            } catch { /* non-fatal */ }
          }

          if (dbSubagents.length > 0) {
            const subagentJobs: Array<{ slug: string; name: string; systemPrompt: string; model: string | null; task: string; context: string; index: number }> = [];
            for (let i = 0; i < unmatchedCalls.length; i++) {
              const call = unmatchedCalls[i];
              // 1. Try exact slug match (jarble_delegate "to" field)
              let match = dbSubagents.find((a: any) =>
                a.slug === call.toolName || `agent_${a.slug}` === call.toolName
              );
              // 2. Fuzzy match: bot may have used a team member slug instead of a
              //    subagent slug. Match task keywords against subagent descriptions.
              if (!match) {
                const taskLower = (call.task || "").toLowerCase();
                let bestMatch: any = null;
                let bestScore = 0;
                for (const a of dbSubagents) {
                  if (!a.enabled || !a.systemPrompt) continue;
                  const descWords = (a.description || a.name || "").toLowerCase().split(/[\s,\-—]+/);
                  const score = descWords.filter((w: string) => w.length > 3 && taskLower.includes(w)).length;
                  if (score > bestScore) {
                    bestScore = score;
                    bestMatch = a;
                  }
                }
                if (bestMatch) {
                  match = bestMatch;
                  log.info(
                    { deploymentId, originalTo: call.toolName, resolvedTo: bestMatch.slug, score: bestScore },
                    "Chat: fuzzy-matched delegation to subagent (bot used wrong slug)",
                  );
                } else if (dbSubagents.filter((a: any) => a.enabled && a.systemPrompt).length > 0) {
                  // 3. Last resort: use the first enabled subagent
                  match = dbSubagents.find((a: any) => a.enabled && a.systemPrompt);
                  log.info(
                    { deploymentId, originalTo: call.toolName, resolvedTo: match?.slug },
                    "Chat: fallback delegation to first subagent (no slug or keyword match)",
                  );
                }
              }
              if (match && match.enabled && match.systemPrompt) {
                subagentJobs.push({
                  slug: match.slug,
                  name: match.name,
                  systemPrompt: match.systemPrompt,
                  model: match.model,
                  task: call.task,
                  context: call.context || "",
                  index: i,
                });
              }
            }

            if (subagentJobs.length > 0) {
              log.info(
                { deploymentId, subagentCount: subagentJobs.length, slugs: subagentJobs.map(j => j.slug) },
                "Chat: processing subagent delegation calls",
              );

              // Emit start events
              for (const job of subagentJobs) {
                safeSendEvent(res, {
                  type: CUSTOM,
                  name: "jarble.flow.delegation.start",
                  value: {
                    toolName: job.slug,
                    targetNodeId: job.slug,
                    targetDeploymentId: deploymentId,
                    targetRole: job.name,
                    task: job.task.slice(0, 200),
                  },
                });
              }

              // Execute subagent calls in parallel
              const provider = env.AGENT_LLM_PROVIDER ?? "openrouter";
              const apiKey = env.AGENT_LLM_API_KEY ?? env.OPENROUTER_API_KEY;

              const subagentResults = await Promise.allSettled(
                subagentJobs.map(async (job) => {
                  const model = job.model || env.AGENT_LLM_MODEL || "anthropic/claude-sonnet-4-20250514";
                  const userMessage = `Task: ${job.task}${job.context ? `\n\nContext: ${job.context}` : ""}`;

                  const result = await collectLlmCompletion({
                    provider: provider as any,
                    model,
                    apiKey: apiKey || "",
                    messages: [
                      { role: "system" as const, content: job.systemPrompt },
                      { role: "user" as const, content: userMessage },
                    ],
                  });
                  return result;
                }),
              );

              // Emit results
              for (let j = 0; j < subagentResults.length; j++) {
                const job = subagentJobs[j];
                const result = subagentResults[j];

                if (result.status === "fulfilled") {
                  safeSendEvent(res, {
                    type: CUSTOM,
                    name: "jarble.flow.delegation.end",
                    value: {
                      toolName: job.slug,
                      targetNodeId: job.slug,
                      targetDeploymentId: deploymentId,
                      success: true,
                    },
                  });

                  const responseText = result.value?.text || JSON.stringify(result.value);
                  safeSendEvent(res, {
                    type: "TEXT_MESSAGE_CONTENT",
                    messageId,
                    delta: `\n\n**${job.name}:** ${responseText}`,
                  });
                } else {
                  const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
                  log.error({ deploymentId, slug: job.slug, error: errMsg }, "Chat: subagent delegation failed");

                  safeSendEvent(res, {
                    type: CUSTOM,
                    name: "jarble.flow.delegation.end",
                    value: {
                      toolName: job.slug,
                      targetNodeId: job.slug,
                      targetDeploymentId: deploymentId,
                      success: false,
                      error: errMsg,
                    },
                  });

                  safeSendEvent(res, {
                    type: "TEXT_MESSAGE_CONTENT",
                    messageId,
                    delta: `\n\n*Delegation to ${job.name} was unsuccessful.*`,
                  });
                }
              }
            }
          }
        }
      } catch (err) {
        log.warn(
          { deploymentId, err: err instanceof Error ? err.message : String(err) },
          "Chat: subagent delegation failed (non-fatal)",
        );
      }
    }

    safeSendEvent(res, { type: "TEXT_MESSAGE_END", messageId });

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
      // Emit orchestration steps so the frontend shows what's being rendered
      safeSendEvent(res, {
        type: CUSTOM,
        name: "jarble.orchestration.steps",
        value: {
          tool: "render_components",
          steps: resolvedBlocks.map((b, i) => ({
            id: `render-${b.id}`,
            label: (b.props.title as string) || b.component.replace(/_/g, " "),
            status: "pending",
            agent: b.component === "sandbox" ? "component" : "tool",
          })),
        },
      });
    }

    for (const block of resolvedBlocks) {
      // AG-UI standard: component rendering = tool call
      const toolCallId = block.id;
      // Emit tool status for frontend indicator
      const toolStatus = getToolStatus(block.component);
      safeSendEvent(res, {
        type: CUSTOM,
        name: CUSTOM_TOOL_STATUS,
        value: { status: toolStatus, component: block.component, toolCallId },
      });
      safeSendEvent(res, {
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
      safeSendEvent(res, {
        type: TOOL_CALL_ARGS,
        toolCallId,
        delta: JSON.stringify(block.props),
      });
      safeSendEvent(res, { type: TOOL_CALL_END, toolCallId });
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
      safeSendEvent(res, {
        type: CUSTOM,
        name: CUSTOM_DASHBOARD_CREATED,
        value: { dashboardId, title: group.title, cardIds: group.cardIds },
      });
    }

    // Emit card updates as AG-UI CUSTOM events
    if (gatewayResult.uiUpdates) {
      for (const update of gatewayResult.uiUpdates) {
        safeSendEvent(res, {
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
        safeSendEvent(res, {
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

    // Handle component definitions - save to PVC and notify frontend
    if (gatewayResult.componentDefs && gatewayResult.componentDefs.length > 0) {
      for (const def of gatewayResult.componentDefs) {
        // Save to PVC in the background (fire-and-forget)
        writeComponentToPvc(deploymentId, def.name, def as unknown as Record<string, unknown>, managedBy).catch((err: unknown) => {
          log.warn({ deploymentId, name: def.name, error: err instanceof Error ? err.message : String(err) }, "Failed to save component definition to PVC");
        });

        safeSendEvent(res, {
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
      safeSendEvent(res, {
        type: CUSTOM,
        name: CUSTOM_DESIGN_CONTEXT,
        value: gatewayResult.designContext,
      });
      log.debug({ deploymentId }, "Chat: emitted design context update");
    }

    // Emit suggestions - use bot's own suggestions if present, otherwise generate via secondary model
    if (gatewayResult.suggestions && gatewayResult.suggestions.length > 0) {
      safeSendEvent(res, {
        type: CUSTOM,
        name: CUSTOM_SUGGESTIONS,
        value: { suggestions: gatewayResult.suggestions.map(s => ({ prompt: s })) },
      });
      log.debug({ deploymentId, count: gatewayResult.suggestions.length, source: "bot" }, "Chat: emitted suggestions");
    } else {
      // Secondary model call - cheap GPT-4o-mini generates contextual follow-ups
      try {
        const generated = await generateSuggestions(sanitizedText, gatewayResult.text);
        if (generated.length > 0) {
          safeSendEvent(res, {
            type: CUSTOM,
            name: CUSTOM_SUGGESTIONS,
            value: { suggestions: generated.map(s => ({ prompt: s })) },
          });
          log.debug({ deploymentId, count: generated.length, source: "secondary" }, "Chat: emitted suggestions");
        }
      } catch {
        // Non-fatal - skip suggestions for this turn
      }
    }

    const durationMs = Date.now() - requestStartMs;
    const eventCount = resolvedBlocks.length + (gatewayResult.uiUpdates?.length ?? 0);
    log.info(
      { deploymentId, durationMs, blockCount: resolvedBlocks.length, updateCount: gatewayResult.uiUpdates?.length ?? 0, rawTextLength: gatewayResult.rawText.length },
      "Chat: request completed"
    );

    // ── Persist assistant message to DB ──────────────────────────────────────
    // Fire-and-forget: save the complete bot response so it survives client disconnects.
    const cleanResponse = stripReasoningTags(gatewayResult.rawText || gatewayResult.text || "");
    if (cleanResponse && convId) {
      const now = dbDate();
      (async () => {
        try {
          // Ensure session exists (may already from user message save)
          const existing = await db.query.chatSessions.findFirst({
            where: eq(tables.chatSessions.id, convId),
          });
          if (!existing) {
            await db.insert(tables.chatSessions).values({
              id: convId,
              deploymentId,
              title: sanitizedText.slice(0, 50),
              createdAt: now,
              updatedAt: now,
            } as any);
          } else {
            await db.update(tables.chatSessions)
              .set({ updatedAt: now } as any)
              .where(eq(tables.chatSessions.id, convId));
          }

          await db.insert(tables.chatMessages).values({
            id: nanoid(),
            sessionId: convId,
            role: "assistant",
            content: cleanResponse,
            thinkingText: gatewayResult.nativeThinking || null,
            createdAt: now,
          } as any);
        } catch (err: unknown) {
          log.warn({ err: err instanceof Error ? err.message : String(err), convId }, "Failed to persist assistant message");
        }
      })();
    }

    safeSendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    if (!clientDisconnected) res.end();
  };

  // Helper: run chat via exec (kubectl exec into pod)
  const tryExec = async (): Promise<GatewayResponse> => {
    const podName = await findPodForDeployment(deploymentId, { requireReady: false, managedBy });
    if (!podName) throw new Error("No pod found for this deployment");
    return chatViaExec(
      podName,
      sessionKey,
      messageWithVision,
      (fullTextSoFar) => {
        if (fullTextSoFar.length > lastDeltaText.length) {
          emitStreamingDelta(fullTextSoFar);
        }
      },
      canvasImage,
      abortController.signal,
    );
  };

  // ── Exec-only path (local dev) ──────────────────────────────────────────────
  // Uses a per-session lock to prevent concurrent `npx openclaw agent` calls
  // from corrupting OpenClaw's session history. Second message waits for first.
  if (useExecOnly) {
    await withSessionLock(sessionKey, async () => {
      try {
        log.debug({ deploymentId }, "Local dev: using exec-only path (skipping WS gateway)");
        await emitExternalReasoning();
        const result = await tryExec();
        await emitGatewayResult(result);
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (e.name === "AbortError" || abortController.signal.aborted) return;
        log.error({ deploymentId, error: e.message }, "Exec-only chat failed");
        const classified = classifyError(e.message, { deploymentStatus: deployment.status });
        safeSendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: `Sorry, I couldn't reach the bot. ${classified.suggestion}` });
        safeSendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
        safeSendEvent(res, { type: CUSTOM, name: CUSTOM_CHAT_ERROR, value: { error: classified } });
        safeSendEvent(res, { type: "RUN_FINISHED", runId, threadId });
        if (!clientDisconnected) res.end();
      }
    });
    return;
  }

  // ── Standard path: WS gateway with exec fallback ────────────────────────────
  const MAX_ATTEMPTS = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const podAddr = await getPodAddress(deploymentId, managedBy);

      if (!podAddr) {
        const classified = classifyError("No pod found", { deploymentStatus: deployment.status });
        safeSendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "No running pod found for this deployment. Try restarting the bot." });
        safeSendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
        safeSendEvent(res, { type: CUSTOM, name: CUSTOM_CHAT_ERROR, value: { error: classified } });
        safeSendEvent(res, { type: "RUN_FINISHED", runId, threadId });
        if (!clientDisconnected) res.end();
        return;
      }

      // Don't emit external reasoning upfront - the bot's native thinking or
      // <think> tags may arrive during streaming, and those are higher quality.
      // emitGatewayResult() handles the fallback chain:
      // native thinking > <think> tags > external reasoning.
      // The external reasoning promise is already resolving in the background.

      // Shared onBlockDetected callback for both HTTP and WS paths
      const onBlockDetected = async (block: JarbleUIBlock) => {
        try {
          const resolved = await resolveUIBlocks([block], deploymentId, managedBy);
          for (const b of resolved) {
            // Emit tool status for frontend indicator
            const toolStatus = getToolStatus(b.component);
            safeSendEvent(res, {
              type: CUSTOM,
              name: CUSTOM_TOOL_STATUS,
              value: { status: toolStatus, component: b.component, toolCallId: b.id },
            });
            // AG-UI TOOL_CALL events
            const toolCallId = b.id;
            safeSendEvent(res, {
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
            safeSendEvent(res, {
              type: TOOL_CALL_ARGS,
              toolCallId,
              delta: JSON.stringify(b.props),
            });
            safeSendEvent(res, { type: TOOL_CALL_END, toolCallId });
          }
        } catch (err: unknown) {
          log.warn({ deploymentId, blockId: block.id, error: err instanceof Error ? err.message : String(err) }, "Chat: failed to emit streamed UI block");
        }
      };

      const onDelta = (fullTextSoFar: string) => {
        if (fullTextSoFar.length > lastDeltaText.length) {
          emitStreamingDelta(fullTextSoFar);
        }
      };

      // Primary path: HTTP chat completions - true per-token streaming via
      // OpenClaw's OpenAI-compatible /v1/chat/completions endpoint.
      // Falls back to WS gateway if HTTP fails (e.g. endpoint not available
      // on older OpenClaw versions).
      let gatewayResult: GatewayResponse;
      try {
        gatewayResult = await chatViaHTTP(
          {
            ip: podAddr.ip,
            port: podAddr.port,
            gatewayToken: podAddr.gatewayToken,
            sessionKey,
          },
          messageWithVision,
          sessionKey,
          onDelta,
          abortController.signal,
          onBlockDetected,
        );
      } catch (httpErr: unknown) {
        const httpE = httpErr instanceof Error ? httpErr : new Error(String(httpErr));
        if (httpE.name === "AbortError" || abortController.signal.aborted) throw httpE;
        log.warn({ deploymentId, error: httpE.message }, "chatViaHTTP failed, falling back to WS gateway");
        // Reset delta + reasoning tracking for fallback path.
        // JAR-63: the reasoning tracker must be reset too — otherwise its
        // processedLength offset carries over from the aborted HTTP run
        // and the WS retry will mis-slice reasoning deltas.
        lastDeltaText = "";
        inFencedBlock = false;
        fenceBuffer = "";
        reasoningTracker.reset();
        gatewayResult = await chatViaGateway(
          {
            ip: podAddr.ip,
            port: podAddr.port,
            gatewayToken: podAddr.gatewayToken,
            sessionKey,
          },
          messageWithVision,
          onDelta,
          abortController.signal,
          onBlockDetected,
        );
      }

      await emitGatewayResult(gatewayResult);
      return;

    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (e.name === "AbortError" || abortController.signal.aborted) return;
      lastError = e;

      // On connection-level errors, fall back to exec through K8s API
      const isConnectionError = /ETIMEDOUT|ECONNREFUSED|ECONNRESET|handshake|closed before auth|auth failed|origin not allowed/i.test(e.message);
      if (isConnectionError && attempt < MAX_ATTEMPTS - 1) {
        log.warn({ deploymentId, attempt, error: e.message }, "HTTP+WS gateway failed, falling back to exec (npx openclaw agent)");
        // JAR-63: reset reasoning tracker state here too so the exec
        // retry parses its full response from a clean slate.
        lastDeltaText = "";
        inFencedBlock = false;
        fenceBuffer = "";
        reasoningTracker.reset();

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
  safeSendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: `Sorry, I couldn't reach the bot. ${classified.suggestion}` });
  safeSendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
  safeSendEvent(res, { type: CUSTOM, name: CUSTOM_CHAT_ERROR, value: { error: classified } });
  safeSendEvent(res, { type: "RUN_FINISHED", runId, threadId });
  if (!clientDisconnected) res.end();
});

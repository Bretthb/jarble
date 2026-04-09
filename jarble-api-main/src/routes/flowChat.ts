/**
 * Flow Chat Route
 *
 * POST /api/flows/:flowId/chat - Send a message to the flow's entry bot.
 *
 * The entry bot can delegate to connected bots by emitting a single canonical
 * `jarble_delegate` fenced code block. There is NO per-member tool exposed
 * to the LLM (e.g. no `delegate_to_<name>`); the one tool the bot uses is the
 * `jarble_delegate` fence, and the `to` field of its JSON body picks the
 * target by bare slug. Delegation happens transparently: the user talks to
 * one bot, and the bot team coordinates behind the scenes.
 *
 * The internal `DelegationTool.name` (e.g. `delegate_to_t1`) is kept purely
 * as a routing key inside the parser — it never reaches the LLM and is no
 * longer surfaced on user-facing diagnostics. The skipped/banner SSE events
 * ship bare slugs to match the `jarble_delegate` contract.
 *
 * Response streams via SSE using the same AG-UI event protocol as tamboAgent.ts.
 * Additional flow-specific events:
 *   - jarble.flow.delegation.start  - delegation to a team member began
 *   - jarble.flow.delegation.end    - delegation finished (includes result summary)
 *   - jarble.flow.chat.trace        - full delegation trace at end of response
 *   - jarble.flow.delegation.skipped - diagnostic when no delegation happened
 *
 * Auth: Bearer JWT (same as tamboAgent.ts and flowExecution.ts)
 */

import { Router } from "express";
import { nanoid } from "nanoid";
import { eq, and, or, inArray } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { findPodForDeployment } from "../k8s/index.js";
import { chatViaExec, type GatewayResponse } from "../services/openclawGateway.js";
import {
  buildDelegationTools,
  buildFlowSystemPrompt,
  parseDelegationCalls,
  executeDelegation,
  type DelegationTool,
  type DelegationResult,
} from "../services/flowDelegation.js";
import { getDeploymentCapabilitiesBatch } from "../services/deploymentCapabilities.js";
import type { FlowDefinition, FlowNode, FlowEdge } from "../services/flowEngine.js";
import {
  CUSTOM,
  RUN_STARTED,
  RUN_FINISHED,
  TEXT_MESSAGE_START,
  TEXT_MESSAGE_CONTENT,
  TEXT_MESSAGE_END,
} from "../utils/eventTypes.js";
import { agentCallEvents } from "../utils/agentCallEvents.js";

const log = createModuleLogger("flow-chat");

export const flowChatRouter = Router();

// ── Per-session exec lock ────────────────────────────────────────────────────
// Prevents concurrent chatViaExec calls on the same entry bot session,
// which corrupts OpenClaw's session history. Same pattern as tamboAgent.ts.
const sessionExecLocks = new Map<string, Promise<void>>();

function withSessionLock(sessionKey: string, fn: () => Promise<void>): Promise<void> {
  const prev = sessionExecLocks.get(sessionKey) || Promise.resolve();
  const next = prev.then(fn, fn);
  sessionExecLocks.set(sessionKey, next);
  next.finally(() => {
    if (sessionExecLocks.get(sessionKey) === next) {
      sessionExecLocks.delete(sessionKey);
    }
  });
  return next;
}

// ── Per-user SSE connection limiting ─────────────────────────────────────────

const MAX_FLOW_CHAT_SSE_PER_USER = 3;
const activeConnections = new Map<string, number>();

function acquireConnection(userId: string): boolean {
  const count = activeConnections.get(userId) ?? 0;
  if (count >= MAX_FLOW_CHAT_SSE_PER_USER) return false;
  activeConnections.set(userId, count + 1);
  return true;
}

function releaseConnection(userId: string): void {
  const count = activeConnections.get(userId) ?? 0;
  if (count <= 1) {
    activeConnections.delete(userId);
  } else {
    activeConnections.set(userId, count - 1);
  }
}

// ── Auth helper (mirrors flowExecution.ts) ───────────────────────────────────

async function authenticateRequest(req: any) {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  const queryToken = req.query.token as string | undefined;
  const token = headerToken || queryToken;

  if (!token) return null;

  try {
    const payload = await verifyToken(token);
    return await getUserFromToken(payload);
  } catch (err) {
    log.warn(
      { err, authMethod: headerToken ? "header" : "query" },
      "authenticateRequest: JWT verification failed",
    );
    return null;
  }
}

// ── SSE helpers ──────────────────────────────────────────────────────────────

function sendEvent(res: any, event: Record<string, unknown>): void {
  if (res.writableEnded) return;
  try {
    const json = JSON.stringify(event);
    res.write(`data: ${json}\n\n`);
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err) },
      "Failed to stringify SSE event",
    );
  }
}

function setupSSEHeaders(res: any): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
}

/** Send an error as a text message and close the SSE stream. */
function sendErrorResponse(
  res: any,
  runId: string,
  threadId: string,
  message: string,
): void {
  const messageId = nanoid();
  sendEvent(res, { type: TEXT_MESSAGE_START, messageId, role: "assistant" });
  sendEvent(res, { type: TEXT_MESSAGE_CONTENT, messageId, delta: message });
  sendEvent(res, { type: TEXT_MESSAGE_END, messageId });
  sendEvent(res, { type: RUN_FINISHED, runId, threadId });
  res.end();
}

// ── Delegation trace entry ───────────────────────────────────────────────────

interface DelegationTraceEntry {
  toolName: string;
  targetNodeId: string;
  targetDeploymentId: string;
  task: string;
  /** First 300 chars — wire-format preview shipped on the SSE trace event. */
  responsePreview: string;
  /**
   * The COMPLETE specialist reply. Kept server-side only and used to feed the
   * coordinator's wrap-up synthesis turn so it sees the full text instead of
   * the truncated preview (preview-only caused "result was truncated"
   * hallucinations — qa-bot-teams 2026-04-07 P3 #2).
   */
  fullResponse: string;
  durationMs: number;
  creditsUsed: number;
  success: boolean;
  error?: string;
  /** Number of UI blocks produced by this delegation (for compose detection) */
  uiBlockCount: number;
}

// ── POST /:flowId/chat ──────────────────────────────────────────────────────

flowChatRouter.post("/:flowId/chat", async (req, res) => {
  let user: Awaited<ReturnType<typeof authenticateRequest>> = null;

  try {
    // 1. Authenticate
    user = await authenticateRequest(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const flowId = req.params.flowId;
    const body = req.body ?? {};
    const userMessage = (body.message as string || "").trim();
    const threadId = body.threadId || nanoid();
    const runId = body.runId || nanoid();
    const conversationId = body.conversationId || "";

    if (!userMessage) {
      res.status(400).json({ error: "Missing message in request body" });
      return;
    }

    const MAX_MESSAGE_LENGTH = 10_000;
    if (userMessage.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({
        error: `Message too long (${userMessage.length} chars). Maximum is ${MAX_MESSAGE_LENGTH} characters.`,
      });
      return;
    }

    // 2. Load flow from DB (must be owned by user)
    const dbFlow = await db
      .select({
        id: tables.orchestrationFlows.id,
        definition: tables.orchestrationFlows.definition,
        userId: tables.orchestrationFlows.userId,
        name: tables.orchestrationFlows.name,
      })
      .from(tables.orchestrationFlows)
      .where(
        and(
          eq(tables.orchestrationFlows.id, flowId),
          eq(tables.orchestrationFlows.userId, user.id),
        ),
      )
      .limit(1);

    if (dbFlow.length === 0) {
      res.status(404).json({ error: "Flow not found" });
      return;
    }

    let definition: FlowDefinition;
    try {
      definition =
        typeof dbFlow[0].definition === "string"
          ? JSON.parse(dbFlow[0].definition)
          : (dbFlow[0].definition as FlowDefinition);
    } catch {
      res.status(500).json({ error: "Stored flow definition is invalid" });
      return;
    }

    if (
      !Array.isArray(definition.nodes) ||
      !Array.isArray(definition.edges) ||
      definition.nodes.length === 0
    ) {
      res.status(400).json({
        error: "Flow has no nodes. Add bots to your flow before chatting.",
      });
      return;
    }

    // 3. Find the entry node (check both top-level and config.isEntryPoint)
    const entryNode =
      definition.nodes.find((n) => n.isEntryPoint || (n.config as any)?.isEntryPoint) || definition.nodes[0];

    if (!entryNode.deploymentId) {
      res.status(400).json({
        error:
          "The entry bot has no deployment assigned. Configure it in the flow editor.",
      });
      return;
    }

    // Verify the entry deployment exists, is running, and belongs to this user
    // (check both personal ownership and org membership)
    const memberships = await db.query.orgMembers.findMany({
      where: eq(tables.orgMembers.userId, user.id),
      columns: { orgId: true },
    });
    const orgIds = memberships.map((m: any) => m.orgId);

    const ownershipFilter = orgIds.length > 0
      ? or(eq(tables.deployments.userId, user.id), inArray(tables.deployments.orgId, orgIds))
      : eq(tables.deployments.userId, user.id);

    const entryDeployment = await db.query.deployments.findFirst({
      where: and(
        eq(tables.deployments.id, entryNode.deploymentId),
        ownershipFilter,
      ),
    });

    if (!entryDeployment) {
      res.status(404).json({
        error: "Entry bot deployment not found or not owned by you.",
      });
      return;
    }

    if (entryDeployment.status !== "running") {
      res.status(400).json({
        error: `Entry bot "${entryDeployment.name}" is not running (status: ${entryDeployment.status}). Start it first.`,
      });
      return;
    }

    // Enforce per-user connection limit
    if (!acquireConnection(user.id)) {
      res.status(429).json({ error: "Too many concurrent flow chat connections" });
      return;
    }

    // 4. Set up SSE stream
    setupSSEHeaders(res);

    const abortController = new AbortController();
    let cleaned = false;

    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": keepalive\n\n");
      }
    }, 25_000);

    // Master timeout: 3 minutes for the entire flow chat (includes delegations)
    const MASTER_TIMEOUT_MS = 3 * 60 * 1000;
    const masterTimeout = setTimeout(() => {
      if (!res.writableEnded) {
        log.warn({ flowId, threadId }, "Flow chat master timeout (3min)");
        abortController.abort();
      }
    }, MASTER_TIMEOUT_MS);

    // Fractal Piece 4 wiring: forward orchestration step events to
    // the frontend so the OrchestrationSteps tree can render nested
    // delegations with parentId set. Mirror of the handler in
    // tamboAgent.ts — the backend emits these via
    // emitOrchestrationStart/End from flowDelegation.ts on every
    // delegation hop with parentStepId + depth pre-filled.
    const onOrchestrationStart = (evt: import("../utils/agentCallEvents.js").OrchestrationStepEvent) => {
      // Filter by entry deployment id — we receive events from every
      // deployment currently mutating its call tree, but this SSE stream
      // only cares about its own flow.
      if (evt.deploymentId !== entryDeployment.id && evt.deploymentId !== entryNode.deploymentId) return;
      sendEvent(res, {
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
      if (evt.deploymentId !== entryDeployment.id && evt.deploymentId !== entryNode.deploymentId) return;
      sendEvent(res, {
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

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(keepAlive);
      clearTimeout(masterTimeout);
      agentCallEvents.off("orchestration:step:start", onOrchestrationStart);
      agentCallEvents.off("orchestration:step:end", onOrchestrationEnd);
      releaseConnection(user!.id);
    };

    req.on("close", () => {
      log.debug({ flowId, threadId }, "Flow chat client disconnected");
      cleanup();
      abortController.abort();
    });

    req.on("error", (err: Error) => {
      log.warn({ err, flowId, threadId }, "Flow chat SSE request error");
      cleanup();
      abortController.abort();
    });

    res.on("error", (err: Error) => {
      log.warn({ err, flowId, threadId }, "Flow chat SSE response error");
      cleanup();
      abortController.abort();
    });

    // Wrap res.end to always clean up
    const originalEnd = res.end.bind(res);
    res.end = ((...args: any[]) => {
      cleanup();
      return originalEnd(...args);
    }) as typeof res.end;

    // 5. Send RUN_STARTED
    sendEvent(res, { type: RUN_STARTED, runId, threadId });

    // 6. Load capabilities for all deployments in the flow and build delegation tools
    const deploymentIds = definition.nodes
      .map((n) => n.deploymentId)
      .filter((id): id is string => !!id);
    const capabilitiesMap = await getDeploymentCapabilitiesBatch(deploymentIds);

    const delegationTools = buildDelegationTools(
      entryNode,
      definition.nodes,
      definition.edges,
      capabilitiesMap,
    );

    log.info(
      {
        flowId,
        flowName: dbFlow[0].name,
        entryNodeId: entryNode.id,
        entryDeploymentId: entryNode.deploymentId,
        delegationToolCount: delegationTools.length,
        nodeCount: definition.nodes.length,
      },
      "Flow chat started",
    );

    // 7. Build augmented system prompt
    const basePrompt = (entryDeployment as any).systemPrompt || "";
    const augmentedPrompt = buildFlowSystemPrompt(
      entryNode,
      delegationTools,
      basePrompt,
    );

    // Build the message to send to the entry bot.
    // chatViaExec has no system-prompt channel today (see follow-up Phase B1b),
    // so we inject the augmented prompt into the user turn with an authoritative
    // header that frames it as system-level instructions the model must follow.
    // The strong header tag is a band-aid until chatViaExec gains a real system
    // prompt channel — without it the bot tends to treat the prompt as
    // conversational context and ignore the delegation contract.
    const entryMessage =
      delegationTools.length > 0
        ? `[FLOW SYSTEM INSTRUCTIONS — AUTHORITATIVE]\n${augmentedPrompt}\n[/FLOW SYSTEM INSTRUCTIONS]\n\nUser message:\n${userMessage}`
        : userMessage;

    // 8. Send message to entry bot
    const sessionKey = `flow-${flowId}-${user.id}${conversationId ? `-${conversationId}` : ""}`;

    const messageId = nanoid();
    // Generate a trace ID for the entire flow chat turn so budget checks
    // and OTel spans can stitch all delegation hops into one trace.
    const flowTraceId = nanoid(32);
    sendEvent(res, { type: TEXT_MESSAGE_START, messageId, role: "assistant" });

    const entryPodName = await findPodForDeployment(entryNode.deploymentId);
    if (!entryPodName) {
      sendEvent(res, {
        type: TEXT_MESSAGE_CONTENT,
        messageId,
        delta: "Could not find a running pod for the entry bot. Try restarting it.",
      });
      sendEvent(res, { type: TEXT_MESSAGE_END, messageId });
      sendEvent(res, { type: RUN_FINISHED, runId, threadId });
      res.end();
      return;
    }

    let entryResult: GatewayResponse;
    try {
      entryResult = await chatViaExec(
        entryPodName,
        sessionKey,
        entryMessage,
        (fullTextSoFar) => {
          // Stream text deltas to the user in real-time
          // (delegation tool calls will be stripped and handled separately)
        },
        undefined,
        abortController.signal,
      );
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : String(err);
      if (abortController.signal.aborted) {
        sendEvent(res, {
          type: TEXT_MESSAGE_CONTENT,
          messageId,
          delta: "The request was cancelled.",
        });
      } else {
        log.error({ flowId, err: errMsg }, "Entry bot chat failed");
        sendEvent(res, {
          type: TEXT_MESSAGE_CONTENT,
          messageId,
          delta: `Sorry, I couldn't reach the entry bot. Error: ${errMsg}`,
        });
      }
      sendEvent(res, { type: TEXT_MESSAGE_END, messageId });
      sendEvent(res, { type: RUN_FINISHED, runId, threadId });
      res.end();
      return;
    }

    // 9. Check if the entry bot wants to delegate
    const delegationCalls = parseDelegationCalls(entryResult.rawText);
    const delegationTrace: DelegationTraceEntry[] = [];

    if (delegationCalls.length > 0 && delegationTools.length > 0) {
      // Strip delegation tool-call blocks from the visible text so the user
      // doesn't see the raw fenced block. Strip BOTH the new jarble_delegate
      // format AND the legacy json format (during the rollout window).
      let visibleText = entryResult.text
        .replace(/```jarble_delegate\s*\n[\s\S]*?```/g, "")
        .replace(/```json\s*\n\s*\{[^}]*"tool"\s*:\s*"delegate_to_[^}]*\}\s*```/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      // Send the entry bot's text (before delegation) if any
      if (visibleText) {
        sendEvent(res, {
          type: TEXT_MESSAGE_CONTENT,
          messageId,
          delta: visibleText + "\n\n",
        });
      }

      // Execute each delegation
      for (const call of delegationCalls) {
        // Find the matching tool
        const tool = delegationTools.find((t) => t.name === call.toolName);
        if (!tool) {
          log.warn(
            { flowId, toolName: call.toolName },
            "Delegation tool not found in available tools",
          );
          continue;
        }

        // Emit delegation start event
        const targetNode = definition.nodes.find(
          (n) => n.id === tool.targetNodeId,
        );
        sendEvent(res, {
          type: CUSTOM,
          name: "jarble.flow.delegation.start",
          value: {
            toolName: call.toolName,
            targetNodeId: tool.targetNodeId,
            targetDeploymentId: tool.targetDeploymentId,
            targetRole: targetNode?.role || targetNode?.label || "Unknown",
            task: call.task.slice(0, 200),
          },
        });

        // Execute the delegation (with heartbeat during long-running calls)
        let delegationResult: DelegationResult | null = null;
        let delegationError: string | null = null;
        const delegationStartMs = Date.now();

        const heartbeat = setInterval(() => {
          if (!res.writableEnded) {
            sendEvent(res, {
              type: CUSTOM,
              name: "jarble.flow.delegation.heartbeat",
              value: {
                toolName: call.toolName,
                targetDeploymentId: tool.targetDeploymentId,
                elapsedMs: Date.now() - delegationStartMs,
              },
            });
          }
        }, 5_000);

        try {
          delegationResult = await executeDelegation({
            targetDeploymentId: tool.targetDeploymentId,
            targetNodeId: tool.targetNodeId,
            task: call.task,
            context: call.context,
            contextScope: tool.contextScope,
            conversationHistory: [{ role: "user", content: userMessage }],
            // Fresh session per delegation call — prevents stale context from
            // previous delegations in the same conversation causing issues like
            // "I'm on webchat without dashboard capabilities" refusals.
            sessionId: `flow-${flowId}-${tool.targetNodeId}-${user.id}-${nanoid(6)}`,
            depth: 1,
            userId: user.id,
            // ── N-level delegation wiring ──────────────────────────────
            // The entry bot is depth 0 and has no `agent_calls` row of
            // its own, so this first hop has `parentCallId: null`. The
            // ancestor chain begins with the entry deployment so any
            // nested sub-delegation that tries to route back to it is
            // rejected by `DelegationCycleError`.
            sourceDeploymentId: entryNode.deploymentId,
            toolName: call.toolName,
            parentCallId: null,
            ancestorDeploymentIds: [entryNode.deploymentId],
            flowId,
            // flowTraceId ties all delegation hops in this chat turn
            // into one trace for budget checks + OTel stitching
            traceId: flowTraceId,
          });
        } catch (err) {
          delegationError =
            err instanceof Error ? err.message : String(err);
          log.error(
            {
              flowId,
              targetNodeId: tool.targetNodeId,
              error: delegationError,
            },
            "Delegation failed",
          );
        } finally {
          clearInterval(heartbeat);
        }

        // Emit delegation end event
        sendEvent(res, {
          type: CUSTOM,
          name: "jarble.flow.delegation.end",
          value: {
            toolName: call.toolName,
            targetNodeId: tool.targetNodeId,
            targetDeploymentId: tool.targetDeploymentId,
            success: !!delegationResult,
            durationMs: delegationResult?.durationMs ?? 0,
            creditsUsed: delegationResult?.creditsUsed ?? 0,
            error: delegationError,
            responsePreview: delegationResult?.response?.slice(0, 300) ?? "",
            uiBlockCount: delegationResult?.uiBlocks?.length ?? 0,
          },
        });

        // Record in trace. responsePreview is the wire-format slice (300 chars)
        // shipped on the SSE event; fullResponse is kept server-side and fed
        // into the coordinator's synthesis turn so it sees the full reply.
        delegationTrace.push({
          toolName: call.toolName,
          targetNodeId: tool.targetNodeId,
          targetDeploymentId: tool.targetDeploymentId,
          task: call.task,
          responsePreview: delegationResult?.response?.slice(0, 300) ?? "",
          fullResponse: delegationResult?.response ?? "",
          durationMs: delegationResult?.durationMs ?? 0,
          creditsUsed: delegationResult?.creditsUsed ?? 0,
          success: !!delegationResult,
          error: delegationError ?? undefined,
          uiBlockCount: delegationResult?.uiBlocks?.length ?? 0,
        });

        // Stream the delegation result into the chat
        if (delegationResult?.response) {
          const roleName = targetNode?.role || targetNode?.label || "Team member";
          sendEvent(res, {
            type: TEXT_MESSAGE_CONTENT,
            messageId,
            delta: `**${roleName}:** ${delegationResult.response}\n\n`,
          });

          // Forward UI blocks from delegated bot to the frontend
          if (delegationResult.uiBlocks?.length) {
            for (const block of delegationResult.uiBlocks) {
              sendEvent(res, {
                type: CUSTOM,
                name: "jarble.flow.delegation.uiblock",
                value: {
                  delegationToolName: call.toolName,
                  sourceDeploymentId: tool.targetDeploymentId,
                  sourceRole: targetNode?.role || targetNode?.label || "Team member",
                  block,
                },
              });
            }
          }
        } else if (delegationError) {
          sendEvent(res, {
            type: TEXT_MESSAGE_CONTENT,
            messageId,
            delta: `*Delegation to ${targetNode?.role || call.toolName} failed: ${delegationError}*\n\n`,
          });
        }
      }

      // 9b. Compose step — if multiple specialists produced UI components,
      // tell the coordinator it can merge them into a unified dashboard.
      // This is the "logic gate" pattern: each specialist produces a
      // component output, the compose step wires them together.
      const delegationsWithBlocks = delegationTrace.filter((d) => d.success && d.uiBlockCount > 0);
      const hasComposableBlocks = delegationsWithBlocks.length >= 2;
      if (hasComposableBlocks) {
        sendEvent(res, {
          type: CUSTOM,
          name: "jarble.flow.compose.available",
          value: {
            delegationCount: delegationsWithBlocks.length,
            sources: delegationsWithBlocks.map((d) => d.toolName.replace(/^delegate_to_/, "")),
          },
        });
      }

      // 10. Send delegation results back to entry bot for synthesis.
      // The coordinator gets the FULL specialist replies (not the 300-char
      // wire-format previews) wrapped in explicit BEGIN/END markers so it
      // cannot mistake them for previews. Previously this used responsePreview
      // and the coordinator routinely hallucinated "the result was truncated"
      // because the preview cut off mid-sentence — see qa-bot-teams
      // 2026-04-07 P3 finding #2.
      if (delegationTrace.length > 0 && !abortController.signal.aborted) {
        const synthesisPrompt = delegationTrace
          .filter((d) => d.success)
          .map((d) => {
            const slug = d.toolName.replace(/^delegate_to_/, "");
            return `[BEGIN ${slug} FULL REPLY]\n${d.fullResponse}\n[END ${slug} FULL REPLY]`;
          })
          .join("\n\n");

        if (synthesisPrompt) {
          sendEvent(res, {
            type: CUSTOM,
            name: "jarble.flow.synthesis.start",
            value: { delegationCount: delegationTrace.length },
          });

          const synthMessageId = nanoid();
          sendEvent(res, { type: TEXT_MESSAGE_START, messageId: synthMessageId, role: "assistant" });

          try {
            // Build compose instruction if multiple specialists produced components
            let composeInstruction = "";
            if (hasComposableBlocks) {
              const blockSpecs = delegationsWithBlocks
                .map((d) => {
                  const slug = d.toolName.replace(/^delegate_to_/, "");
                  return `  - From ${slug}: ${d.uiBlockCount} UI component(s)`;
                })
                .join("\n");
              composeInstruction =
                `\n\nCOMPOSE OPPORTUNITY: Multiple team members produced UI components:\n${blockSpecs}\n` +
                `You MAY render a single unified sandbox that combines all their results into one ` +
                `cohesive dashboard view. Use render_ui with a "sandbox" component containing HTML/CSS/JS ` +
                `that inlines the data from each member's reply. This is optional — only compose if the ` +
                `user would benefit from seeing everything in one place.`;
            }

            const synthResult = await chatViaExec(
              entryPodName,
              sessionKey,
              `[DELEGATION RESULTS]\n${synthesisPrompt}\n[/DELEGATION RESULTS]\n\n` +
                `Each block above contains the COMPLETE, untruncated reply from one team member, ` +
                `bounded by [BEGIN ... FULL REPLY] / [END ... FULL REPLY] markers. The full reply ` +
                `is everything between those markers — there is no hidden continuation. Do NOT ` +
                `claim any reply was "truncated", "cut off", "shortened", "incomplete", or that ` +
                `you "only saw a preview". If a reply ends mid-thought it is because the team ` +
                `member chose to stop there, not because it was truncated by the system.\n\n` +
                `Briefly weave these replies into a cohesive response for the user. Be concise — ` +
                `the raw replies were already streamed to the user above, so your job is just to ` +
                `add a short framing summary, not to repeat the contents.` +
                composeInstruction,
              undefined,
              undefined,
              abortController.signal,
            );

            const synthText = synthResult.text
              .replace(/<(think|reasoning)>[\s\S]*?<\/\1>/gi, "")
              .replace(/\n{3,}/g, "\n\n")
              .trim();

            if (synthText) {
              sendEvent(res, {
                type: TEXT_MESSAGE_CONTENT,
                messageId: synthMessageId,
                delta: `\n\n---\n**Summary:** ${synthText}`,
              });
            }

            // Forward composed UI blocks from the synthesis response.
            // When the coordinator renders a unified dashboard from the
            // specialists' outputs, these blocks carry the merged result.
            if (synthResult.uiBlocks?.length) {
              for (const block of synthResult.uiBlocks) {
                sendEvent(res, {
                  type: CUSTOM,
                  name: "jarble.flow.delegation.uiblock",
                  value: {
                    delegationToolName: "compose",
                    sourceDeploymentId: entryNode.deploymentId,
                    sourceRole: "Coordinator (composed)",
                    block,
                  },
                });
              }
            }
          } catch (err) {
            log.warn({ flowId, err: err instanceof Error ? err.message : err }, "Synthesis call failed (non-fatal)");
            // Prevent empty message bubble — send minimal content on failure
            sendEvent(res, { type: TEXT_MESSAGE_CONTENT, messageId: synthMessageId, delta: "\n\n---\n*Team results shown above.*" });
          }

          sendEvent(res, { type: TEXT_MESSAGE_END, messageId: synthMessageId });

          sendEvent(res, {
            type: CUSTOM,
            name: "jarble.flow.synthesis.end",
            value: { delegationCount: delegationTrace.length },
          });
        }
      }

    } else {
      // Delegation was not performed. One of three cases:
      //   1. no_tools_available       — entry bot has no outgoing "delegates" edges (normal)
      //   2. tool_call_not_emitted    — tools were available, bot just answered directly
      //   3. mentioned_but_not_emitted — bot said "I delegated to X" in natural language
      //                                  but did not emit the ```json tool call block the
      //                                  parser requires. This is a SILENT FAILURE MODE
      //                                  that leaves users waiting for an answer that
      //                                  never comes. See docs/audits/qa-bot-teams-2026-04-07.md
      // Emit a diagnostic event so the frontend (and logs) can surface WHY no delegation
      // happened instead of falling through silently to the bot's natural-language text.
      const hasDelegationMention = /\b(delegat(e|ing|ed)|ask(ed|ing)?\s+the\s+(specialist|researcher|team|expert|coordinator)|pass(ed|ing)?\s+(this|it)\s+to|hand(ing|ed)?\s+off\s+to)\b/i.test(
        entryResult.text ?? "",
      );
      let skipReason: "no_tools_available" | "tool_call_not_emitted" | "mentioned_but_not_emitted";
      if (delegationTools.length === 0) {
        skipReason = "no_tools_available";
      } else if (hasDelegationMention) {
        skipReason = "mentioned_but_not_emitted";
        log.warn(
          {
            flowId,
            entryNodeId: entryNode.id,
            availableTools: delegationTools.map((t) => t.name),
            rawTextPreview: entryResult.rawText.slice(0, 500),
          },
          "Bot mentioned delegation in natural language but did not emit a valid tool_call JSON block — silent delegation failure",
        );
      } else {
        skipReason = "tool_call_not_emitted";
        if (delegationTools.length > 0) {
          log.info(
            {
              flowId,
              entryNodeId: entryNode.id,
              availableToolCount: delegationTools.length,
            },
            "Delegation tools available but entry bot answered directly without delegating",
          );
        }
      }

      // Surface the bare slugs (e.g. "t1", "researcher") instead of the
      // internal `delegate_to_<slug>` tool names. The user-facing contract
      // exposed in the system prompt teaches bots to emit
      // `jarble_delegate { "to": "<bare-slug>" }`, so the banner copy and
      // skipped-diagnostic should match that vocabulary. The internal
      // DelegationTool.name field stays as `delegate_to_<slug>` purely as a
      // routing key for the parser — see qa-bot-teams 2026-04-07 P3 #3.
      sendEvent(res, {
        type: CUSTOM,
        name: "jarble.flow.delegation.skipped",
        value: {
          reason: skipReason,
          availableToolCount: delegationTools.length,
          availableTools: delegationTools.map((t) =>
            t.name.replace(/^delegate_to_/, ""),
          ),
        },
      });

      // Stream the entry bot's response directly
      // Strip reasoning tags for clean display
      const cleanText = entryResult.text
        .replace(/<(think|reasoning)>[\s\S]*?<\/\1>/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      if (cleanText) {
        sendEvent(res, {
          type: TEXT_MESSAGE_CONTENT,
          messageId,
          delta: cleanText,
        });
      }
    }

    // End the text message
    sendEvent(res, { type: TEXT_MESSAGE_END, messageId });

    // Emit delegation trace if any delegations occurred
    if (delegationTrace.length > 0) {
      const totalCredits = delegationTrace.reduce(
        (sum, d) => sum + d.creditsUsed,
        0,
      );
      sendEvent(res, {
        type: CUSTOM,
        name: "jarble.flow.chat.trace",
        value: {
          flowId,
          flowName: dbFlow[0].name,
          entryNodeId: entryNode.id,
          delegations: delegationTrace,
          totalCredits: totalCredits + 1, // +1 for entry bot call
          totalDelegations: delegationTrace.length,
        },
      });
    }

    // Persist team chat messages to database (fire-and-forget)
    void (async () => {
      try {
        const { nanoid: genId } = await import("nanoid");
        const convId = conversationId || threadId;

        // Ensure session exists (upsert pattern)
        const existingSession = await db.query.flowChatSessions.findFirst({
          where: and(
            eq(tables.flowChatSessions.flowId, flowId),
            eq(tables.flowChatSessions.userId, user!.id),
            eq(tables.flowChatSessions.id, convId),
          ),
        });

        if (!existingSession) {
          await db.insert(tables.flowChatSessions).values({
            id: convId,
            flowId,
            userId: user!.id,
            title: `Team Chat`,
          });
        }

        // Save user message
        await db.insert(tables.flowChatMessages).values({
          id: genId(),
          sessionId: convId,
          role: "user",
          content: userMessage,
        });

        // Save assistant (entry bot) response
        // Collect the full assistant text from the entry result
        const fullAssistantText = entryResult.text
          .replace(/<(think|reasoning)>[\s\S]*?<\/\1>/gi, "")
          .replace(/```json\s*\n\s*\{[^}]*"tool"\s*:\s*"delegate_to_[^}]*\}\s*```/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        if (fullAssistantText) {
          await db.insert(tables.flowChatMessages).values({
            id: genId(),
            sessionId: convId,
            role: "assistant",
            content: fullAssistantText,
            sourceNodeId: entryNode.id,
            sourceDeploymentId: entryNode.deploymentId,
          });
        }

        // Save delegation results
        for (const d of delegationTrace) {
          if (d.success && d.responsePreview) {
            await db.insert(tables.flowChatMessages).values({
              id: genId(),
              sessionId: convId,
              role: "delegation_result",
              content: d.responsePreview,
              sourceNodeId: d.targetNodeId,
              sourceDeploymentId: d.targetDeploymentId,
              delegationToolName: d.toolName,
            });
          }
        }
      } catch (err) {
        log.warn({ flowId, err: err instanceof Error ? err.message : err }, "Failed to persist flow chat messages (non-fatal)");
      }
    })();

    // Finish
    sendEvent(res, { type: RUN_FINISHED, runId, threadId });
    res.end();

    log.info(
      {
        flowId,
        threadId,
        delegationCount: delegationTrace.length,
        totalCredits:
          delegationTrace.reduce((s, d) => s + d.creditsUsed, 0) + 1,
      },
      "Flow chat completed",
    );
  } catch (err) {
    log.error({ err }, "Flow chat route error");
    if (user) releaseConnection(user.id);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    } else if (!res.writableEnded) {
      // Stream was already open - try to send an error event
      try {
        sendEvent(res, {
          type: CUSTOM,
          name: "jarble.flow.error",
          value: {
            error:
              err instanceof Error ? err.message : "Internal server error",
          },
        });
      } catch {
        // Connection is doomed
      }
      res.end();
    }
  }
});

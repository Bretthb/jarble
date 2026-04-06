/**
 * Flow Chat Route
 *
 * POST /api/flows/:flowId/chat - Send a message to the flow's entry bot.
 *
 * The entry bot can delegate to connected bots via auto-generated delegation
 * tools. Delegation happens transparently: the user talks to one bot, and the
 * bot team coordinates behind the scenes.
 *
 * Response streams via SSE using the same AG-UI event protocol as tamboAgent.ts.
 * Additional flow-specific events:
 *   - jarble.flow.delegation.start  - delegation to a team member began
 *   - jarble.flow.delegation.end    - delegation finished (includes result summary)
 *   - jarble.flow.chat.trace        - full delegation trace at end of response
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
import type { FlowDefinition, FlowNode, FlowEdge } from "../services/flowEngine.js";
import {
  CUSTOM,
  RUN_STARTED,
  RUN_FINISHED,
  TEXT_MESSAGE_START,
  TEXT_MESSAGE_CONTENT,
  TEXT_MESSAGE_END,
} from "../utils/eventTypes.js";

const log = createModuleLogger("flow-chat");

export const flowChatRouter = Router();

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
  responsePreview: string;
  durationMs: number;
  creditsUsed: number;
  success: boolean;
  error?: string;
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

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(keepAlive);
      clearTimeout(masterTimeout);
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

    // 6. Build delegation tools for the entry bot
    const delegationTools = buildDelegationTools(
      entryNode,
      definition.nodes,
      definition.edges,
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
    // We prefix with the augmented system context as a "system" instruction,
    // since chatViaExec sends a single message string to the pod.
    const entryMessage =
      delegationTools.length > 0
        ? `[FLOW CONTEXT]\n${augmentedPrompt}\n[/FLOW CONTEXT]\n\n${userMessage}`
        : userMessage;

    // 8. Send message to entry bot
    const sessionKey = `flow-${flowId}-${user.id}${conversationId ? `-${conversationId}` : ""}`;

    const messageId = nanoid();
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
      // Strip delegation JSON blocks from the visible text
      let visibleText = entryResult.text
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

        // Execute the delegation
        let delegationResult: DelegationResult | null = null;
        let delegationError: string | null = null;

        try {
          delegationResult = await executeDelegation({
            targetDeploymentId: tool.targetDeploymentId,
            targetNodeId: tool.targetNodeId,
            task: call.task,
            context: call.context,
            contextScope: tool.contextScope,
            conversationHistory: [{ role: "user", content: userMessage }],
            sessionId: `flow-delegation-${flowId}-${tool.targetNodeId}-${Date.now()}`,
            depth: 1,
            userId: user.id,
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
          },
        });

        // Record in trace
        delegationTrace.push({
          toolName: call.toolName,
          targetNodeId: tool.targetNodeId,
          targetDeploymentId: tool.targetDeploymentId,
          task: call.task,
          responsePreview: delegationResult?.response?.slice(0, 300) ?? "",
          durationMs: delegationResult?.durationMs ?? 0,
          creditsUsed: delegationResult?.creditsUsed ?? 0,
          success: !!delegationResult,
          error: delegationError ?? undefined,
        });

        // Stream the delegation result into the chat
        if (delegationResult?.response) {
          const roleName = targetNode?.role || targetNode?.label || "Team member";
          sendEvent(res, {
            type: TEXT_MESSAGE_CONTENT,
            messageId,
            delta: `**${roleName}:** ${delegationResult.response}\n\n`,
          });
        } else if (delegationError) {
          sendEvent(res, {
            type: TEXT_MESSAGE_CONTENT,
            messageId,
            delta: `*Delegation to ${targetNode?.role || call.toolName} failed: ${delegationError}*\n\n`,
          });
        }
      }

      // 10. Optionally, send the delegation results back to the entry bot
      //     for it to synthesize a unified response.
      //     For now, we present delegation results directly to the user.
      //     A follow-up iteration can add a second entry-bot call for synthesis.

    } else {
      // No delegation - stream the entry bot's response directly
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

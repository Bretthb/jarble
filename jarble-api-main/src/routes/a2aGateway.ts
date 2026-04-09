/**
 * A2A Gateway — per-deployment Agent-to-Agent protocol endpoints.
 *
 * Allows each Jarble bot to be called as an A2A-compatible agent by
 * external systems or by other Jarble bots via the mesh.
 *
 * Endpoints:
 *   POST /api/a2a/:deploymentId/tasks/send      — Send a task, get response
 *   GET  /api/a2a/:deploymentId/agent.json       — Agent card (capabilities)
 *
 * Auth: Bearer JWT (same as chat endpoints) or API key with a2a:invoke scope.
 *
 * Response format follows the Google A2A protocol Task/Message schema:
 * https://google.github.io/A2A/specification/
 */
import { Router, Request, Response } from "express";
import { eq, and, or, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, tables } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";
import { env } from "../utils/env.js";
import { getUserFromRequest } from "../helpers/auth.js";

const log = createModuleLogger("a2a-gateway");

export const a2aGatewayRouter = Router();

// ── Auth helper ─────────────────────────────────────────────────────────
// Uses the shared JWT verification from helpers/auth.ts (jose + JWKS).

async function resolveAuth(req: Request): Promise<{ userId: string } | null> {
  const user = await getUserFromRequest(req);
  return user ? { userId: user.id } : null;
}

// ── Agent Card ──────────────────────────────────────────────────────────
// GET /api/a2a/:deploymentId/agent.json
// Returns the A2A agent card describing this bot's capabilities.

a2aGatewayRouter.get("/:deploymentId/agent.json", async (req: Request, res: Response) => {
  const { deploymentId } = req.params;

  try {
    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, deploymentId),
      columns: {
        id: true,
        userId: true,
        orgId: true,
        name: true,
        systemPrompt: true,
        status: true,
        runtime: true,
        isPublic: true,
      },
    });

    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    // Only expose agent card for public deployments or with verified ownership
    if (!deployment.isPublic) {
      const auth = await resolveAuth(req);
      if (!auth) {
        res.status(401).json({ error: "Authentication required for private deployments" });
        return;
      }
      // Verify ownership (personal or org membership)
      const memberships = await db.query.orgMembers.findMany({
        where: eq(tables.orgMembers.userId, auth.userId),
        columns: { orgId: true },
      });
      const orgIds = memberships.map((m: any) => m.orgId);
      const isOwner = (deployment as any).userId === auth.userId;
      const isOrgMember = (deployment as any).orgId && orgIds.includes((deployment as any).orgId);
      if (!isOwner && !isOrgMember) {
        res.status(404).json({ error: "Deployment not found" });
        return;
      }
    }

    const baseUrl = env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;

    res.json({
      name: deployment.name,
      description: deployment.systemPrompt?.slice(0, 200) || "A Jarble AI agent",
      url: `${baseUrl}/api/a2a/${deploymentId}`,
      version: "1.0.0",
      protocol: "a2a/v1",
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: false,
      },
      skills: [
        {
          id: "chat",
          name: "Chat",
          description: "Send a message and receive a response",
          inputModes: ["text"],
          outputModes: ["text"],
        },
      ],
      authentication: {
        schemes: ["bearer"],
      },
      status: deployment.status === "running" ? "available" : "unavailable",
    });
  } catch (err) {
    log.error({ deploymentId, err }, "A2A: agent card failed");
    res.status(500).json({ error: "Failed to fetch agent card" });
  }
});

// ── Send Task ───────────────────────────────────────────────────────────
// POST /api/a2a/:deploymentId/tasks/send
// Sends a task to the bot and returns the response synchronously.
// Body: { message: string, sessionId?: string, context?: object }

a2aGatewayRouter.post("/:deploymentId/tasks/send", async (req: Request, res: Response) => {
  const { deploymentId } = req.params;

  // Auth required
  const auth = await resolveAuth(req);
  if (!auth) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Authentication required" },
    });
    return;
  }

  const { message, sessionId, context } = req.body || {};
  if (!message || typeof message !== "string") {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32602, message: "Missing required 'message' field" },
    });
    return;
  }

  if (message.length > 10_000) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32602, message: "Message too long (max 10,000 chars)" },
    });
    return;
  }

  // Validate sessionId if provided (defense-in-depth: used as env var + CLI arg)
  if (sessionId && (typeof sessionId !== "string" || !/^[\w\-]{1,128}$/.test(sessionId))) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32602, message: "Invalid sessionId (alphanumeric/dash/underscore, max 128 chars)" },
    });
    return;
  }

  // Limit context object size to prevent inflating the message beyond the 10k cap
  if (context && typeof context === "object") {
    const contextStr = JSON.stringify(context);
    if (contextStr.length > 5_000) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32602, message: "Context too large (max 5,000 chars when serialized)" },
      });
      return;
    }
  }

  try {
    // Verify deployment exists and user has access
    const memberships = await db.query.orgMembers.findMany({
      where: eq(tables.orgMembers.userId, auth.userId),
      columns: { orgId: true },
    });
    const orgIds = memberships.map((m: any) => m.orgId);

    const ownershipFilter = orgIds.length > 0
      ? or(
          eq(tables.deployments.userId, auth.userId),
          inArray(tables.deployments.orgId, orgIds),
          eq(tables.deployments.isPublic, true),
        )
      : or(
          eq(tables.deployments.userId, auth.userId),
          eq(tables.deployments.isPublic, true),
        );

    const deployment = await db.query.deployments.findFirst({
      where: and(eq(tables.deployments.id, deploymentId), ownershipFilter!),
    });

    if (!deployment) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32004, message: "Deployment not found or access denied" },
      });
      return;
    }

    if (deployment.status !== "running") {
      res.status(409).json({
        jsonrpc: "2.0",
        error: { code: -32005, message: `Bot is not running (status: ${deployment.status})` },
      });
      return;
    }

    // Find the pod and exec chat
    const { chatViaExec } = await import("../services/openclawGateway.js");
    const { findPodForDeployment } = await import("../k8s/index.js");

    const podName = await findPodForDeployment(deploymentId);
    if (!podName) {
      res.status(503).json({
        jsonrpc: "2.0",
        error: { code: -32006, message: "No running pod found for this deployment" },
      });
      return;
    }

    const session = sessionId || `a2a-${auth.userId}-${nanoid(8)}`;
    const taskId = nanoid(12);

    log.info({ deploymentId, userId: auth.userId, taskId, messageLen: message.length }, "A2A: task received");

    // Prepend context if provided
    let fullMessage = message;
    if (context && typeof context === "object") {
      fullMessage = `[A2A Context]\n${JSON.stringify(context, null, 2)}\n[/A2A Context]\n${message}`;
    }

    // Timeout: abort after 120s to prevent hanging connections
    const a2aAbort = new AbortController();
    const a2aTimeout = setTimeout(() => a2aAbort.abort(), 120_000);

    const startMs = Date.now();
    let response;
    try {
      response = await chatViaExec(podName, session, fullMessage, undefined, undefined, a2aAbort.signal);
    } finally {
      clearTimeout(a2aTimeout);
    }
    const durationMs = Date.now() - startMs;

    log.info({
      deploymentId,
      taskId,
      durationMs,
      textLen: response.text.length,
      blockCount: response.uiBlocks?.length ?? 0,
    }, "A2A: task completed");

    // Return A2A-compatible response
    res.json({
      jsonrpc: "2.0",
      result: {
        id: taskId,
        sessionId: session,
        status: {
          state: "completed",
          timestamp: new Date().toISOString(),
        },
        artifacts: [
          {
            parts: [
              {
                type: "text",
                text: response.text,
              },
              // Include UI blocks as structured data
              ...(response.uiBlocks || []).map((block: any) => ({
                type: "data",
                data: {
                  component: block.component,
                  props: block.props,
                },
                metadata: {
                  mimeType: "application/vnd.jarble.ui-block+json",
                },
              })),
            ],
          },
        ],
        metadata: {
          durationMs,
          deploymentId,
          deploymentName: deployment.name,
          tokenUsage: response.tokenUsage || null,
        },
      },
    });
  } catch (err: any) {
    log.error({ deploymentId, err: err.message, stack: err.stack }, "A2A: task failed");
    // Don't leak internal error details to external callers
    res.status(500).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Internal error during task execution",
      },
    });
  }
});

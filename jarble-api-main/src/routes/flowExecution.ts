/**
 * SSE endpoint for streaming flow execution progress.
 *
 * POST /api/flows/:flowId/execute - starts execution, returns SSE stream
 * GET  /api/flows/:flowId/executions/:execId/stream - reconnect to running execution
 * POST /api/flows/:flowId/executions/:execId/resume - resume a paused execution
 */

import { Router } from "express";
import crypto from "crypto";
import { createModuleLogger } from "../utils/logger.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import {
  FlowExecutionEngine,
  type FlowDefinition,
  type FlowExecutionState,
} from "../services/flowEngine.js";
import { db, tables } from "../db/index.js";
import { eq, and } from "drizzle-orm";

const log = createModuleLogger("flow-execution");

export const flowExecutionRouter = Router();

// ── Per-user SSE connection limiting (mirrors sse.ts pattern) ────────────

const MAX_FLOW_SSE_PER_USER = 5;
const activeFlowConnections = new Map<string, number>();

function acquireConnection(userId: string): boolean {
  const count = activeFlowConnections.get(userId) ?? 0;
  if (count >= MAX_FLOW_SSE_PER_USER) return false;
  activeFlowConnections.set(userId, count + 1);
  return true;
}

function releaseConnection(userId: string): void {
  const count = activeFlowConnections.get(userId) ?? 0;
  if (count <= 1) {
    activeFlowConnections.delete(userId);
  } else {
    activeFlowConnections.set(userId, count - 1);
  }
}

// ── In-memory registry of running executions (for reconnection) ─────────

const runningExecutions = new Map<
  string,
  { engine: FlowExecutionEngine; userId: string }
>();

// Prune completed executions after 5 minutes
function scheduleExecutionCleanup(execId: string): void {
  setTimeout(() => {
    runningExecutions.delete(execId);
  }, 5 * 60 * 1000);
}

// ── Auth helper (same pattern as sse.ts) ────────────────────────────────

async function authenticateSSE(req: any) {
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
      "authenticateSSE: JWT verification failed"
    );
    return null;
  }
}

// ── SSE helpers ─────────────────────────────────────────────────────────

function writeSSE(
  res: any,
  type: string,
  payload: Record<string, unknown>
): void {
  if (res.writableEnded) return;
  const data = JSON.stringify({ type, ...payload });
  res.write(`data: ${data}\n\n`);
}

function setupSSEHeaders(res: any): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(": connected\n\n");
}

// ── POST /:flowId/execute - Start execution and stream progress ─────────

flowExecutionRouter.post("/:flowId/execute", async (req, res) => {
  let user: Awaited<ReturnType<typeof authenticateSSE>> = null;

  try {
    user = await authenticateSSE(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const flowId = req.params.flowId;
    const body = req.body ?? {};

    // ── Look up flow from DB (trusted source) ────────────────────────
    let definition: FlowDefinition | null = null;

    const dbFlow = await db
      .select({
        id: tables.orchestrationFlows.id,
        definition: tables.orchestrationFlows.definition,
        userId: tables.orchestrationFlows.userId,
      })
      .from(tables.orchestrationFlows)
      .where(
        and(
          eq(tables.orchestrationFlows.id, flowId),
          eq(tables.orchestrationFlows.userId, user.id)
        )
      )
      .limit(1);

    if (dbFlow.length > 0) {
      // Use the stored definition - don't trust client-provided definition
      try {
        definition = typeof dbFlow[0].definition === "string"
          ? JSON.parse(dbFlow[0].definition)
          : dbFlow[0].definition;
      } catch {
        res.status(500).json({ error: "Stored flow definition is invalid" });
        return;
      }
    } else if (body.definition) {
      // Fall back to body definition for ad-hoc execution (flow not saved to DB)
      definition = body.definition as FlowDefinition;
    }

    if (!definition) {
      res.status(400).json({ error: "Missing flow definition in request body" });
      return;
    }

    if (
      !Array.isArray(definition.nodes) ||
      !Array.isArray(definition.edges)
    ) {
      res.status(400).json({
        error: "Invalid flow definition: nodes and edges must be arrays",
      });
      return;
    }

    if (definition.nodes.length > 50) {
      res.status(400).json({
        error: "Flow too large: maximum 50 nodes",
      });
      return;
    }

    // ── Validate callerDeploymentId ownership ────────────────────────
    let callerDeploymentId: string | undefined = (body.callerDeploymentId as string) || undefined;

    if (callerDeploymentId) {
      const ownedDeployment = await db
        .select({ id: tables.deployments.id })
        .from(tables.deployments)
        .where(
          and(
            eq(tables.deployments.id, callerDeploymentId),
            eq(tables.deployments.userId, user.id)
          )
        )
        .limit(1);

      if (ownedDeployment.length === 0) {
        // Silently ignore unowned callerDeploymentId rather than rejecting
        log.warn(
          { callerDeploymentId, userId: user.id },
          "callerDeploymentId not owned by user - ignoring"
        );
        callerDeploymentId = undefined;
      }
    }

    // Enforce per-user connection limit
    if (!acquireConnection(user.id)) {
      res.status(429).json({ error: "Too many concurrent flow executions" });
      return;
    }

    const executionId = `fex_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

    // Create the engine
    const engine = new FlowExecutionEngine(
      flowId,
      executionId,
      definition,
      user.id,
      callerDeploymentId
    );

    // Register for reconnection and SSE streaming
    runningExecutions.set(executionId, { engine, userId: user.id });

    // Return JSON with executionId - client connects to GET endpoint for SSE
    releaseConnection(user.id); // POST doesn't hold connection; GET will acquire
    res.json({ executionId, flowId, totalSteps: definition.nodes.length });

    // Start execution in background (events buffered for SSE consumers)
    const executionTimeout = setTimeout(() => {
      log.warn({ executionId }, "Flow execution timeout (10min)");
      engine.cancel();
    }, 10 * 60 * 1000);

    // Max pause duration: 30 minutes. If not resumed, clean up.
    const MAX_PAUSE_DURATION = 30 * 60 * 1000;

    engine
      .execute()
      .then((state) => {
        clearTimeout(executionTimeout);
        if ((state.status as string) === "paused") {
          // Keep execution alive for resume, but schedule cleanup if never resumed
          log.info({ executionId }, "Flow paused - waiting for resume (max 30min)");
          setTimeout(() => {
            const entry = runningExecutions.get(executionId);
            if (entry && (entry.engine.executionState.status as string) === "paused") {
              log.warn({ executionId }, "Paused flow expired (30min) - cleaning up");
              entry.engine.cancel();
              runningExecutions.delete(executionId);
            }
          }, MAX_PAUSE_DURATION);
          return;
        }
        scheduleExecutionCleanup(executionId);
      })
      .catch((err) => {
        log.error({ executionId, err }, "Flow execution unexpected error");
        clearTimeout(executionTimeout);
        scheduleExecutionCleanup(executionId);
      });
  } catch (err) {
    log.error({ err }, "Flow execution route error");
    if (user) releaseConnection(user.id);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    } else {
      res.end();
    }
  }
});

// ── POST /:flowId/executions/:execId/resume - Resume a paused execution ─

flowExecutionRouter.post(
  "/:flowId/executions/:execId/resume",
  async (req, res) => {
    try {
      const user = await authenticateSSE(req);
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { execId } = req.params;
      const entry = runningExecutions.get(execId);

      if (!entry) {
        res.status(404).json({ error: "Execution not found or already completed" });
        return;
      }

      // Verify ownership
      if (entry.userId !== user.id) {
        res.status(403).json({ error: "Not authorized for this execution" });
        return;
      }

      const engine = entry.engine;
      const state = engine.executionState;

      if (state.status !== "paused") {
        res.status(400).json({
          error: `Execution is not paused (current status: "${state.status}")`,
        });
        return;
      }

      const body = req.body ?? {};
      const { nodeId, input } = body;

      if (!nodeId || typeof nodeId !== "string") {
        res.status(400).json({ error: "Missing or invalid nodeId in request body" });
        return;
      }

      try {
        // Resume the engine - this completes the waitForInput node and
        // continues execution. resume() returns the final state (or paused
        // again if another waitForInput is hit).
        // Run in background so we can respond immediately.
        res.json({
          executionId: execId,
          status: "resumed",
          nodeId,
        });

        engine
          .resume(nodeId, input)
          .then((finalState) => {
            if (finalState.status !== "paused") {
              scheduleExecutionCleanup(execId);
            }
          })
          .catch((err) => {
            log.error({ execId, err }, "Flow resume execution error");
            scheduleExecutionCleanup(execId);
          });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    } catch (err) {
      log.error({ err }, "Flow resume route error");
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// ── GET /:flowId/executions/:execId/stream - Reconnect to running ───────

flowExecutionRouter.get(
  "/:flowId/executions/:execId/stream",
  async (req, res) => {
    try {
      const user = await authenticateSSE(req);
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { execId } = req.params;
      const entry = runningExecutions.get(execId);

      if (!entry) {
        res.status(404).json({ error: "Execution not found or already completed" });
        return;
      }

      // Verify ownership
      if (entry.userId !== user.id) {
        res.status(403).json({ error: "Not authorized for this execution" });
        return;
      }

      if (!acquireConnection(user.id)) {
        res.status(429).json({ error: "Too many concurrent flow connections" });
        return;
      }

      const engine = entry.engine;
      const state = engine.executionState;

      // Set up SSE stream
      setupSSEHeaders(res);

      // Send current state snapshot so client can catch up
      const stepResultsSnapshot: Record<string, unknown> = {};
      for (const [nodeId, stepResult] of state.stepResults) {
        stepResultsSnapshot[nodeId] = stepResult;
      }

      writeSSE(res, "jarble.flow.snapshot", {
        executionId: execId,
        flowId: req.params.flowId,
        status: state.status,
        totalSteps: state.stepResults.size,
        completedSteps: [...state.stepResults.values()].filter(
          (r) =>
            r.status === "completed" ||
            r.status === "failed" ||
            r.status === "skipped"
        ).length,
        totalCredits: state.totalCredits,
        stepResults: stepResultsSnapshot,
        pausedAtNodeId: state.pausedAtNodeId,
      });

      // If already finished, end immediately
      if (
        state.status === "completed" ||
        state.status === "failed" ||
        state.status === "cancelled"
      ) {
        res.end();
        releaseConnection(user.id);
        return;
      }

      // Wire up live events
      const detach = attachEngineToSSE(engine, res);

      const keepAlive = setInterval(() => {
        if (!res.writableEnded) {
          res.write(": ping\n\n");
        }
      }, 15_000);

      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(keepAlive);
        detach();
        releaseConnection(user!.id);
      };

      // When engine finishes, close this reconnected stream too
      const onFlowCompleted = () => {
        if (!res.writableEnded) {
          res.end();
        }
        cleanup();
      };
      engine.on("flow:completed", onFlowCompleted);

      req.on("close", () => {
        log.debug({ execId }, "Flow reconnect SSE client disconnected");
        engine.removeListener("flow:completed", onFlowCompleted);
        cleanup();
      });

      req.on("error", (err: Error) => {
        log.warn({ err, execId }, "Flow reconnect SSE request error");
        engine.removeListener("flow:completed", onFlowCompleted);
        cleanup();
      });

      res.on("error", (err: Error) => {
        log.warn({ err, execId }, "Flow reconnect SSE response error");
        engine.removeListener("flow:completed", onFlowCompleted);
        cleanup();
      });
    } catch (err) {
      log.error({ err }, "Flow reconnect route error");
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// ── Attach engine events to an SSE response ─────────────────────────────

function attachEngineToSSE(
  engine: FlowExecutionEngine,
  res: any
): () => void {
  const onStepStarted = (event: any) => {
    writeSSE(res, "jarble.flow.step.started", {
      nodeId: event.nodeId,
      label: event.label,
      index: event.index,
      total: event.total,
    });
  };

  const onStepFinished = (event: any) => {
    writeSSE(res, "jarble.flow.step.finished", {
      nodeId: event.nodeId,
      label: event.label,
      status: event.status,
      result: event.result,
      error: event.error,
      durationMs: event.durationMs,
      credits: event.credits,
      index: event.index,
      total: event.total,
    });
  };

  const onStepIteration = (event: any) => {
    writeSSE(res, "jarble.flow.step.iteration", {
      nodeId: event.nodeId,
      iteration: event.iteration,
      maxIterations: event.maxIterations,
    });
  };

  const onFlowState = (event: any) => {
    writeSSE(res, "jarble.flow.state", {
      status: event.status,
      completedSteps: event.completedSteps,
      totalSteps: event.totalSteps,
      totalCredits: event.totalCredits,
    });
  };

  const onFlowPaused = (event: any) => {
    writeSSE(res, "jarble.flow.paused", {
      nodeId: event.nodeId,
      label: event.label,
      inputSchema: event.inputSchema,
    });
  };

  const onFlowError = (event: any) => {
    writeSSE(res, "jarble.flow.error", {
      error: event.error,
    });
  };

  const onSubstepStarted = (event: any) => {
    writeSSE(res, "jarble.flow.substep.started", {
      parentNodeId: event.parentNodeId,
      nodeId: event.nodeId,
      label: event.label,
      index: event.index,
      total: event.total,
    });
  };

  const onSubstepFinished = (event: any) => {
    writeSSE(res, "jarble.flow.substep.finished", {
      parentNodeId: event.parentNodeId,
      nodeId: event.nodeId,
      label: event.label,
      status: event.status,
      result: event.result,
      error: event.error,
      durationMs: event.durationMs,
      credits: event.credits,
      index: event.index,
      total: event.total,
    });
  };

  engine.on("step:started", onStepStarted);
  engine.on("step:finished", onStepFinished);
  engine.on("step:iteration", onStepIteration);
  engine.on("flow:state", onFlowState);
  engine.on("flow:paused", onFlowPaused);
  engine.on("flow:error", onFlowError);
  engine.on("substep:started", onSubstepStarted);
  engine.on("substep:finished", onSubstepFinished);

  // Return a detach function
  return () => {
    engine.removeListener("step:started", onStepStarted);
    engine.removeListener("step:finished", onStepFinished);
    engine.removeListener("step:iteration", onStepIteration);
    engine.removeListener("flow:state", onFlowState);
    engine.removeListener("flow:paused", onFlowPaused);
    engine.removeListener("flow:error", onFlowError);
    engine.removeListener("substep:started", onSubstepStarted);
    engine.removeListener("substep:finished", onSubstepFinished);
  };
}

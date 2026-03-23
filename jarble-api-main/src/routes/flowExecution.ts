/**
 * SSE endpoint for streaming flow execution progress.
 *
 * POST /api/flows/:flowId/execute — starts execution, returns SSE stream
 * GET  /api/flows/:flowId/executions/:execId/stream — reconnect to running execution
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

// ── POST /:flowId/execute — Start execution and stream progress ─────────

flowExecutionRouter.post("/:flowId/execute", async (req, res) => {
  let user: Awaited<ReturnType<typeof authenticateSSE>> = null;

  try {
    user = await authenticateSSE(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const flowId = req.params.flowId;
    const body = req.body;

    // Validate the flow definition
    if (!body || !body.definition) {
      res.status(400).json({ error: "Missing flow definition in request body" });
      return;
    }

    const definition = body.definition as FlowDefinition;
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

    // Enforce per-user connection limit
    if (!acquireConnection(user.id)) {
      res.status(429).json({ error: "Too many concurrent flow executions" });
      return;
    }

    const executionId = `fex_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const callerDeploymentId = (body.callerDeploymentId as string) || undefined;

    // Create the engine
    const engine = new FlowExecutionEngine(
      flowId,
      executionId,
      definition,
      user.id,
      callerDeploymentId
    );

    // Register for reconnection
    runningExecutions.set(executionId, { engine, userId: user.id });

    // Set up SSE stream
    setupSSEHeaders(res);

    // Send execution ID so client can reconnect
    writeSSE(res, "jarble.flow.execution.created", {
      executionId,
      flowId,
      totalSteps: definition.nodes.length,
    });

    // Wire engine events to SSE
    const detach = attachEngineToSSE(engine, res);

    // Keep-alive ping every 15s
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": ping\n\n");
      }
    }, 15_000);

    // Maximum execution time: 10 minutes
    const executionTimeout = setTimeout(() => {
      if (!res.writableEnded) {
        log.warn({ executionId }, "Flow execution timeout (10min)");
        engine.cancel();
        writeSSE(res, "jarble.flow.state", {
          status: "cancelled",
          completedSteps: 0,
          totalSteps: definition.nodes.length,
          totalCredits: 0,
          reason: "timeout",
        });
        res.end();
      }
    }, 10 * 60 * 1000);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(keepAlive);
      clearTimeout(executionTimeout);
      detach();
      releaseConnection(user!.id);
      scheduleExecutionCleanup(executionId);
    };

    // Client disconnect — cancel execution if still running
    req.on("close", () => {
      log.debug({ executionId }, "Flow SSE client disconnected");
      const state = engine.executionState;
      if (state.status === "running") {
        engine.cancel();
      }
      cleanup();
    });

    req.on("error", (err: Error) => {
      log.warn({ err, executionId }, "Flow SSE request error");
      cleanup();
    });

    res.on("error", (err: Error) => {
      log.warn({ err, executionId }, "Flow SSE response error");
      cleanup();
    });

    // Start execution (runs asynchronously, events stream via SSE)
    engine
      .execute()
      .then(() => {
        if (!res.writableEnded) {
          res.end();
        }
        cleanup();
      })
      .catch((err) => {
        log.error({ executionId, err }, "Flow execution unexpected error");
        if (!res.writableEnded) {
          writeSSE(res, "jarble.flow.error", {
            error: err.message || "Internal error",
          });
          res.end();
        }
        cleanup();
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

// ── GET /:flowId/executions/:execId/stream — Reconnect to running ───────

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

  const onFlowState = (event: any) => {
    writeSSE(res, "jarble.flow.state", {
      status: event.status,
      completedSteps: event.completedSteps,
      totalSteps: event.totalSteps,
      totalCredits: event.totalCredits,
    });
  };

  const onFlowError = (event: any) => {
    writeSSE(res, "jarble.flow.error", {
      error: event.error,
    });
  };

  engine.on("step:started", onStepStarted);
  engine.on("step:finished", onStepFinished);
  engine.on("flow:state", onFlowState);
  engine.on("flow:error", onFlowError);

  // Return a detach function
  return () => {
    engine.removeListener("step:started", onStepStarted);
    engine.removeListener("step:finished", onStepFinished);
    engine.removeListener("flow:state", onFlowState);
    engine.removeListener("flow:error", onFlowError);
  };
}

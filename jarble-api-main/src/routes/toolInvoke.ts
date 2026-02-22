/**
 * Direct Tool Invocation Endpoint — Executes MCP tools without LLM.
 *
 * POST /api/tools/invoke
 * Body: { deploymentId, tool: "get_deployment_info", params: {} }
 * Auth: Bearer JWT (same as tambo-agent)
 * Response: SSE stream (same format as tambo-agent)
 */
import { Router } from "express";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { mcpRegistry } from "../mcp/tools/index.js";
import type { ToolContext } from "../mcp/toolRegistry.js";

export const toolInvokeRouter = Router();

function sendEvent(res: any, event: Record<string, unknown>) {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

toolInvokeRouter.post("/invoke", async (req, res) => {
  // 1. Authenticate: Bearer JWT
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!bearerToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let authenticatedUserId: string;
  try {
    const payload = await verifyToken(bearerToken);
    const user = await getUserFromToken(payload);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    authenticatedUserId = user.id;
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  // 2. Parse request
  const { deploymentId, tool: toolName, params = {} } = req.body;
  const threadId = nanoid();
  const runId = nanoid();

  if (!deploymentId || !toolName) {
    res.status(400).json({ error: "deploymentId and tool are required" });
    return;
  }

  // 3. Look up tool
  const tool = mcpRegistry.get(toolName);
  if (!tool) {
    res.status(400).json({ error: `Unknown tool: ${toolName}` });
    return;
  }

  // 4. Load deployment + verify ownership
  const deployment = await db.query.deployments.findFirst({
    where: eq(tables.deployments.id, deploymentId),
  });

  if (!deployment) {
    res.status(404).json({ error: "Deployment not found" });
    return;
  }

  if ((deployment as any).userId !== authenticatedUserId) {
    res.status(403).json({ error: "You don't have access to this deployment" });
    return;
  }

  // 5. SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  sendEvent(res, { type: "RUN_STARTED", runId, threadId });

  // 6. Execute tool
  const toolContext: ToolContext = {
    userId: authenticatedUserId,
    deploymentId,
    deployment: deployment as any,
  };

  try {
    const toolResult = await tool.execute(params, toolContext);

    // Emit tool component render event if tool has one
    if (tool.rendersComponent) {
      let renderArgs: Record<string, unknown>;

      // Canvas tools (render_ui, list_components) return resolved component data
      // that should be passed directly as render args.
      if (
        toolResult.data &&
        typeof toolResult.data === "object" &&
        "component" in (toolResult.data as any) &&
        "props" in (toolResult.data as any)
      ) {
        renderArgs = toolResult.data as Record<string, unknown>;
      } else {
        renderArgs = { deploymentId, ...params };
        // For lifecycle tools, include the action from tool result data
        if (toolResult.data && typeof toolResult.data === "object" && "action" in (toolResult.data as any)) {
          renderArgs.action = (toolResult.data as any).action;
        }
      }

      const tcId = `render-${nanoid(8)}`;
      const argsStr = JSON.stringify(renderArgs);
      sendEvent(res, { type: "TOOL_CALL_START", toolCallId: tcId, toolCallName: tool.rendersComponent });
      sendEvent(res, { type: "TOOL_CALL_ARGS", toolCallId: tcId, delta: argsStr });
      sendEvent(res, { type: "TOOL_CALL_END", toolCallId: tcId });
    }

    // Emit text summary from tool result
    if (toolResult.message) {
      const messageId = nanoid();
      sendEvent(res, { type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
      sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: toolResult.message });
      sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
    }
  } catch (err: any) {
    logger.error({ deploymentId, tool: toolName, err: err.message }, "Tool invoke error");
    const messageId = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
    sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId, delta: `Tool error: ${err.message}` });
    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId });
  }

  sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
  res.end();
});

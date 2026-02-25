/**
 * Canvas Files — MCP proxy endpoint
 *
 * Routes MCP tool calls from the frontend to the bot's jarble-ui MCP server
 * running inside the pod. Our API is just a dumb pipe — it doesn't touch the data.
 *
 * POST /api/deployments/:id/mcp/invoke
 *   body: { tool: string, args: Record<string, unknown> }
 *   → execs `mcporter call jarble-ui.{tool} --args '{JSON}'` in the pod
 *   → returns the MCP tool result as JSON
 */

import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { findPodForDeployment, execInPod } from "../k8s/index.js";
import { logger } from "../utils/logger.js";
import { writeFileTool } from "../mcp/tools/writeFile.js";

export const canvasFilesRouter = Router();

/** Allowed jarble-ui tool names — whitelist to prevent arbitrary command injection */
const ALLOWED_TOOLS = new Set([
  "save_canvas_file",
  "load_canvas_file",
  "list_canvas_files",
  "delete_canvas_file",
  "render_ui",
  "define_component",
  "list_components",
  "delete_component",
  "write_file",
]);

canvasFilesRouter.post("/:id/mcp/invoke", async (req, res) => {
  try {
    // 1. Authenticate
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!bearerToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    let user;
    try {
      const payload = await verifyToken(bearerToken);
      user = await getUserFromToken(payload);
    } catch {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // 2. Validate request body
    const { tool, args } = req.body;
    if (!tool || typeof tool !== "string") {
      res.status(400).json({ error: "Missing or invalid 'tool' field" });
      return;
    }

    if (!ALLOWED_TOOLS.has(tool)) {
      res.status(400).json({ error: `Unknown tool: ${tool}` });
      return;
    }

    // 3. Verify deployment ownership
    const deploymentId = req.params.id;
    const deployment = await db.query.deployments.findFirst({
      where: and(
        eq(tables.deployments.id, deploymentId),
        eq(tables.deployments.userId, user.id),
      ),
    });

    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    if ((deployment as any).status !== "running") {
      res.status(400).json({ error: "Deployment is not running" });
      return;
    }

    // 4. Handle write_file directly via MCP tool (writes to pod PVC)
    if (tool === "write_file") {
      const ctx = { userId: user.id, deploymentId, deployment };
      const result = await writeFileTool.execute(args || {}, ctx);
      res.json({ result });
      return;
    }

    // 5. Find pod for jarble-ui proxy tools
    const podName = await findPodForDeployment(deploymentId);
    if (!podName) {
      res.status(400).json({ error: "No running pod found" });
      return;
    }

    // 6. Call the jarble-ui MCP server directly via node
    // The server script exports an executeTool function and also handles JSON-RPC.
    // We invoke it with a one-liner that requires the script and calls executeTool.
    const argsJson = JSON.stringify(args || {});
    const nodeScript = `
      const s = require('/data/config/mcp/jarble-ui-server.js');
      const r = typeof s.executeTool === 'function'
        ? s.executeTool(${JSON.stringify(tool)}, ${argsJson})
        : null;
      if (r) { console.log(JSON.stringify(r)); }
      else { console.log(JSON.stringify({isError:true,text:'Tool not found'})); }
    `.replace(/\n/g, " ");
    const command = ["node", "-e", nodeScript];

    logger.debug({ deploymentId, tool, podName }, "MCP proxy: invoking tool in pod");

    const output = await execInPod(podName, command);

    // 7. Try to parse as JSON, otherwise return as text
    try {
      const parsed = JSON.parse(output);
      res.json({ result: parsed });
    } catch {
      res.json({ result: { text: output } });
    }
  } catch (err: any) {
    logger.error({ err: err.message }, "MCP proxy error");
    res.status(500).json({ error: "Failed to invoke MCP tool" });
  }
});

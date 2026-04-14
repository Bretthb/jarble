/**
 * Unified MCP proxy router.
 *
 * One entrypoint — `POST /api/deployments/:id/mcp/invoke` — routes
 * invocations to the correct server based on the `server` field in the
 * body:
 *
 *   { server: "local",    tool, args }  → kubectl exec into the pod
 *   { server: "platform", tool, args }  → in-process platform-server tool
 *   { server: "web",      tool, args }  → in-process web-server tool
 *
 * If `server` is missing or unknown the middleware calls `next()` so the
 * existing `canvasFilesRouter` (mounted immediately after) handles the
 * request with its legacy whitelist. This keeps the refactor strictly
 * additive — nothing breaks before tools are migrated.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db, tables } from "../../db/index.js";
import { verifyToken, getUserFromToken } from "../../services/auth.js";
import { findPodForDeployment, execInPod } from "../../k8s/index.js";
import { createModuleLogger } from "../../utils/logger.js";
import { invokePlatformTool } from "../servers/platform/index.js";
import { invokeWebTool } from "../servers/web/index.js";
import type { ToolContext, McpServerScope } from "../shared/types.js";

const log = createModuleLogger("mcp:proxy");

function isKnownScope(v: unknown): v is McpServerScope {
  return v === "local" || v === "platform" || v === "web";
}

export function createMcpProxyRouter(): Router {
  const router = Router();

  router.post(
    "/:id/mcp/invoke",
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const { server, tool, args } = (req.body ?? {}) as {
        server?: unknown;
        tool?: unknown;
        args?: unknown;
      };

      // Fall through to legacy canvasFiles handler for requests without a
      // `server` field or for unknown scopes. This is the additive safety net.
      if (!isKnownScope(server)) {
        next();
        return;
      }
      if (typeof tool !== "string" || !tool) {
        res.status(400).json({ error: "Missing or invalid 'tool' field" });
        return;
      }

      // Auth: Bearer JWT + deployment ownership. Matches canvasFiles.ts.
      const authHeader = req.headers.authorization;
      const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!bearerToken) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      let userId: string | null = null;
      try {
        const payload = await verifyToken(bearerToken);
        const user = await getUserFromToken(payload);
        if (!user) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
        userId = user.id;
      } catch (err) {
        log.warn({ err, deploymentId: req.params.id }, "mcp-proxy: JWT verification failed");
        res.status(401).json({ error: "Invalid token" });
        return;
      }

      const deploymentId = req.params.id;
      const deployment = await db.query.deployments.findFirst({
        where: and(
          eq(tables.deployments.id, deploymentId),
          eq(tables.deployments.userId, userId),
        ),
      });
      if (!deployment) {
        res.status(404).json({ error: "Deployment not found" });
        return;
      }

      const ctx: ToolContext = {
        deploymentId,
        userId,
        deployment: deployment as unknown as ToolContext["deployment"],
        db,
        log: log.child({ tool, server, deploymentId }),
      };

      try {
        if (server === "platform") {
          const result = await invokePlatformTool(tool, args ?? {}, ctx);
          res.json({ result });
          return;
        }
        if (server === "web") {
          const result = await invokeWebTool(tool, args ?? {}, ctx);
          res.json({ result });
          return;
        }

        // server === "local": delegate to the pod via kubectl exec.
        // Mirrors the existing canvasFiles pattern until the local stdio
        // binary replaces jarble-ui-server.js on the PVC.
        if (deployment.status !== "running") {
          res.status(400).json({ error: "Deployment is not running" });
          return;
        }
        const podName = await findPodForDeployment(deploymentId);
        if (!podName) {
          res.status(400).json({ error: "No running pod found" });
          return;
        }

        const argsJson = JSON.stringify(args ?? {});
        const nodeScript = `
          (async () => {
            const s = require('/data/config/mcp/jarble-ui-server.js');
            const r = typeof s.executeTool === 'function'
              ? await s.executeTool(${JSON.stringify(tool)}, ${argsJson})
              : null;
            if (r) { console.log(JSON.stringify(r)); }
            else { console.log(JSON.stringify({isError:true,text:'Tool not found'})); }
            process.exit(0);
          })().catch(e => {
            console.log(JSON.stringify({isError:true,text:'Error: ' + e.message}));
            process.exit(1);
          });
        `.replace(/\n/g, " ");
        const output = await execInPod(podName, ["node", "-e", nodeScript]);
        try {
          res.json({ result: JSON.parse(output) });
        } catch {
          res.json({ result: { text: output } });
        }
      } catch (err) {
        log.error(
          { err: err instanceof Error ? err.message : String(err), server, tool },
          "mcp-proxy: invocation failed",
        );
        res.status(500).json({ error: "Failed to invoke MCP tool" });
      }
    },
  );

  return router;
}

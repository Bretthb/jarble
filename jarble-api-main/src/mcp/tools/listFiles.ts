import { findPodForDeployment, execInPod } from "../../k8s/index.js";
import type { ManagedBy } from "../../k8s/constants.js";
import { getPvcMountPath, getContainerName } from "../../k8s/constants.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const listFilesTool: McpTool = {
  name: "list_files",
  description:
    "List files and directories on the deployment PVC. Use when the user wants to browse the bot's filesystem.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory path to list (default: PVC root)",
      },
    },
  },
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const managedBy = (ctx.deployment?.managedBy ?? "legacy") as ManagedBy;
    const pvcMount = getPvcMountPath(managedBy);
    const containerName = getContainerName(managedBy);
    const blockedDirs = [`${pvcMount}/runtime/node_modules`, `${pvcMount}/.npm`];

    const path = (params.path as string) || `${pvcMount}/`;

    // Validate path is under PVC mount
    if (!path.startsWith(`${pvcMount}/`) && path !== pvcMount) {
      return { success: false, message: `Path must be under ${pvcMount}/.` };
    }

    // Reject path traversal
    if (path.includes("..")) {
      return { success: false, message: "Path traversal (..) is not allowed." };
    }

    // Block sensitive directories
    for (const blocked of blockedDirs) {
      if (path === blocked || path.startsWith(blocked + "/")) {
        return { success: false, message: `Access to ${blocked} is not allowed.` };
      }
    }

    const podName = await findPodForDeployment(ctx.deploymentId, { requireReady: false, managedBy });
    if (!podName) {
      return {
        success: false,
        message: "No running pod found. The bot may not be deployed or is still starting.",
      };
    }

    try {
      const output = await execInPod(podName, ["ls", "-la", "--time-style=iso", path], containerName);

      return {
        success: true,
        message: `File listing for ${path}:\n${output}`,
        data: { path, listing: output },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ deploymentId: ctx.deploymentId, err: msg }, "MCP: list_files failed");
      return {
        success: false,
        message: `Could not list files at ${path}: ${msg}`,
      };
    }
  },
};

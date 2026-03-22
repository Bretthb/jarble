import { findPodForDeployment, execInPod } from "../../k8s/index.js";
import type { ManagedBy } from "../../k8s/constants.js";
import { getPvcMountPath, getContainerName } from "../../k8s/constants.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

const MAX_FILE_SIZE = 1_048_576; // 1 MB

export const readFileTool: McpTool = {
  name: "read_file",
  description:
    "Read the contents of a file on the deployment PVC. Use when the user wants to view a config file, log, or other file from the bot's filesystem.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute path to the file to read (must be under the PVC mount)",
      },
    },
    required: ["path"],
  },
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const path = params.path as string;
    if (!path) {
      return { success: false, message: "No path provided." };
    }

    const managedBy = (ctx.deployment?.managedBy ?? "legacy") as ManagedBy;
    const pvcMount = getPvcMountPath(managedBy);
    const containerName = getContainerName(managedBy);

    // Validate path is under PVC mount
    if (!path.startsWith(`${pvcMount}/`) && path !== pvcMount) {
      return { success: false, message: `Path must be under ${pvcMount}/.` };
    }

    // Reject path traversal
    if (path.includes("..")) {
      return { success: false, message: "Path traversal (..) is not allowed." };
    }

    const podName = await findPodForDeployment(ctx.deploymentId, { requireReady: false, managedBy });
    if (!podName) {
      return {
        success: false,
        message: "No running pod found. The bot may not be deployed or is still starting.",
      };
    }

    try {
      // Check file size first
      const sizeOutput = await execInPod(podName, ["stat", "-c", "%s", path], containerName);
      const fileSize = parseInt(sizeOutput.trim(), 10);

      if (isNaN(fileSize)) {
        return { success: false, message: `Could not determine file size for ${path}.` };
      }

      if (fileSize > MAX_FILE_SIZE) {
        return {
          success: false,
          message: `File is too large (${fileSize} bytes). Maximum allowed size is ${MAX_FILE_SIZE} bytes (1 MB).`,
        };
      }

      // Read file content
      const content = await execInPod(podName, ["cat", path], containerName);

      return {
        success: true,
        message: `Contents of ${path} (${fileSize} bytes):\n${content}`,
        data: { path, content, size: fileSize },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ deploymentId: ctx.deploymentId, err: msg }, "MCP: read_file failed");
      return {
        success: false,
        message: `Could not read file at ${path}: ${msg}`,
      };
    }
  },
};

import { findPodForDeployment, execInPodWithStdin } from "../../k8s/index.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

const MAX_CONTENT_SIZE = 1_048_576; // 1 MB
const BLOCKED_PATHS = ["/data/.initialized", "/data/runtime", "/data/.npm"];

export const writeFileTool: McpTool = {
  name: "write_file",
  description:
    "Write content to a file on the deployment PVC. Use when the user wants to create or update a config file or other file on the bot's filesystem.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute path to write to (must be under /data/)",
      },
      content: {
        type: "string",
        description: "Content to write to the file",
      },
    },
    required: ["path", "content"],
  },
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const path = params.path as string;
    const content = params.content as string;

    if (!path) {
      return { success: false, message: "No path provided." };
    }
    if (content === undefined || content === null) {
      return { success: false, message: "No content provided." };
    }

    // Validate path is under /data/
    if (!path.startsWith("/data/") && path !== "/data") {
      return { success: false, message: "Path must be under /data/." };
    }

    // Reject path traversal
    if (path.includes("..")) {
      return { success: false, message: "Path traversal (..) is not allowed." };
    }

    // Block protected paths
    for (const blocked of BLOCKED_PATHS) {
      if (path === blocked || path.startsWith(blocked + "/")) {
        return { success: false, message: `Writing to ${blocked} is not allowed.` };
      }
    }

    // Check content size
    const contentBytes = Buffer.byteLength(content, "utf-8");
    if (contentBytes > MAX_CONTENT_SIZE) {
      return {
        success: false,
        message: `Content is too large (${contentBytes} bytes). Maximum allowed size is ${MAX_CONTENT_SIZE} bytes (1 MB).`,
      };
    }

    const podName = await findPodForDeployment(ctx.deploymentId, { requireReady: false });
    if (!podName) {
      return {
        success: false,
        message: "No running pod found. The bot may not be deployed or is still starting.",
      };
    }

    try {
      // Escape single quotes in path for shell safety
      const escapedPath = path.replace(/'/g, "'\\''");
      await execInPodWithStdin(podName, ["sh", "-c", `cat > '${escapedPath}'`], content);

      return {
        success: true,
        message: `Successfully wrote ${contentBytes} bytes to ${path}.`,
        data: { path, bytesWritten: contentBytes },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ deploymentId: ctx.deploymentId, err: msg }, "MCP: write_file failed");
      return {
        success: false,
        message: `Could not write file at ${path}: ${msg}`,
      };
    }
  },
};

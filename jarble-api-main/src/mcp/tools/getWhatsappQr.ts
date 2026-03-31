import { findPodForDeployment } from "../../k8s/index.js";
import type { ManagedBy } from "../../k8s/constants.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const getWhatsappQrTool: McpTool = {
  name: "get_whatsapp_qr",
  description:
    "Initiate WhatsApp QR code pairing. Returns instructions for the user to scan the QR code. The actual QR stream is handled by the frontend SSE endpoint.",
  parameters: {
    type: "object",
    properties: {},
  },
  // No rendersComponent - the frontend handles WhatsApp QR via the SSE stream
  async execute(_params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    if (ctx.deployment.status !== "running") {
      return {
        success: false,
        message: "The bot must be running to start WhatsApp pairing. Please start the bot first.",
      };
    }

    const managedBy = (ctx.deployment?.managedBy ?? "legacy") as ManagedBy;
    const podName = await findPodForDeployment(ctx.deploymentId, { requireReady: false, managedBy });
    if (!podName) {
      return {
        success: false,
        message: "No running pod found. The bot may still be starting up.",
      };
    }

    return {
      success: true,
      message: "WhatsApp pairing is available. The user should use the WhatsApp QR pairing button in the platforms panel to scan the QR code.",
    };
  },
};

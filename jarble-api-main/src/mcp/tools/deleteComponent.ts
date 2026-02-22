/**
 * delete_component MCP Tool — Remove a custom component definition from the bot's PVC.
 */
import { deleteComponentFromPvc } from "../../k8s/index.js";
import {
  validateComponentName,
  BUILTIN_COMPONENTS,
} from "../../utils/componentResolver.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const deleteComponentTool: McpTool = {
  name: "delete_component",
  description:
    "Delete a custom component definition from the bot's storage. Cannot delete built-in components.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Component name to delete",
      },
    },
    required: ["name"],
  },
  async execute(
    params: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const name = params.name as string;

    if (!name) {
      return { success: false, message: "Missing required parameter 'name'." };
    }

    // Don't allow deleting built-in components
    if (BUILTIN_COMPONENTS.has(name)) {
      return { success: false, message: `Cannot delete built-in component "${name}".` };
    }

    // Validate name format
    const nameErr = validateComponentName(name);
    if (nameErr) {
      return { success: false, message: nameErr };
    }

    try {
      const deleted = await deleteComponentFromPvc(ctx.deploymentId, name);

      if (!deleted) {
        return {
          success: false,
          message: `Component "${name}" not found.`,
        };
      }

      logger.info(
        { deploymentId: ctx.deploymentId, component: name },
        "delete_component: deleted"
      );

      return {
        success: true,
        message: `Component "${name}" deleted successfully.`,
      };
    } catch (err: any) {
      logger.error(
        { deploymentId: ctx.deploymentId, component: name, err: err.message },
        "delete_component: failed"
      );
      return {
        success: false,
        message: `Failed to delete component: ${err.message}`,
      };
    }
  },
};

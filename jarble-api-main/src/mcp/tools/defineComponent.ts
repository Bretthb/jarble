/**
 * define_component MCP Tool — Save a reusable UI component template to the bot's PVC.
 *
 * Bots call this to create custom components composed of built-in primitives
 * with {{variable}} placeholders for dynamic data.
 */
import { writeComponentToPvc } from "../../k8s/index.js";
import {
  validateComponentName,
  validateComponentDefinition,
} from "../../utils/componentResolver.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const defineComponentTool: McpTool = {
  name: "define_component",
  description:
    "Create a reusable UI component template saved to the bot's storage. Components are composed of built-in primitives (card, data_table, stat_grid, key_value, code_block, alert, progress, image) with {{variable}} placeholders.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Component name (lowercase, letters/digits/underscores, max 64 chars)",
      },
      description: {
        type: "string",
        description: "Human-readable description of what this component displays",
      },
      layout: {
        type: "array",
        description:
          'Array of built-in component blocks with {{variable}} placeholders. Example: [{"component":"card","props":{"title":"{{title}}"}}]',
        items: {
          type: "object",
          properties: {
            component: { type: "string" },
            props: { type: "object" },
          },
          required: ["component", "props"],
        },
      },
    },
    required: ["name", "layout"],
  },
  async execute(
    params: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const name = params.name as string;
    const description = (params.description as string) || undefined;
    const layout = params.layout as Array<{ component: string; props: Record<string, unknown> }>;

    if (!name || !layout) {
      return { success: false, message: "Missing required parameters 'name' and 'layout'." };
    }

    // Validate name
    const nameErr = validateComponentName(name);
    if (nameErr) {
      return { success: false, message: nameErr };
    }

    // Build definition object
    const definition = {
      name,
      ...(description ? { description } : {}),
      layout,
    };

    // Validate full definition
    const defErr = validateComponentDefinition(definition);
    if (defErr) {
      return { success: false, message: defErr };
    }

    // Write to PVC
    try {
      await writeComponentToPvc(ctx.deploymentId, name, definition);

      logger.info(
        { deploymentId: ctx.deploymentId, component: name },
        "define_component: saved"
      );

      return {
        success: true,
        message: `Component "${name}" saved successfully. You can now use it with render_ui.`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        { deploymentId: ctx.deploymentId, component: name, err: msg },
        "define_component: failed"
      );
      return {
        success: false,
        message: `Failed to save component: ${msg}`,
      };
    }
  },
};

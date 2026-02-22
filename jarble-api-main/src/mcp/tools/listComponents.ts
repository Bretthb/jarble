/**
 * list_components MCP Tool — Discover available UI components (built-in + custom).
 *
 * Returns a data_table showing all components the bot can use with render_ui.
 */
import { listComponentsOnPvc } from "../../k8s/deployment.js";
import { BUILTIN_COMPONENTS } from "../../utils/componentResolver.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  card: "Simple card with title, subtitle, and body text",
  data_table: "Table with column headers and data rows",
  stat_grid: "Grid of metric cards with labels, values, and optional change indicators",
  key_value: "List of key-value pairs",
  code_block: "Syntax-highlighted code snippet",
  alert: "Notification banner (info, success, warning, error)",
  progress: "Progress bar with label and percentage",
  image: "Image with optional alt text and caption",
  layout: "Container that renders an array of child components",
};

export const listComponentsTool: McpTool = {
  name: "list_components",
  description:
    "List all available UI components (built-in + custom). Shows component names, types, and descriptions.",
  parameters: {
    type: "object",
    properties: {},
  },
  rendersComponent: "canvas_block",
  async execute(
    _params: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    // Gather custom components from PVC
    const customComponents = await listComponentsOnPvc(ctx.deploymentId);

    // Build rows: built-in first, then custom
    const rows: Array<[string, string, string]> = [];

    for (const name of BUILTIN_COMPONENTS) {
      rows.push([name, "built-in", BUILTIN_DESCRIPTIONS[name] || ""]);
    }

    for (const comp of customComponents) {
      rows.push([comp.name, "custom", comp.description || ""]);
    }

    const summary = `${BUILTIN_COMPONENTS.size} built-in + ${customComponents.length} custom component(s) available.`;

    return {
      success: true,
      message: summary,
      data: {
        component: "data_table",
        props: {
          title: "Available Components",
          columns: ["Name", "Type", "Description"],
          rows,
        },
      },
    };
  },
};

/**
 * list_components MCP Tool — Discover available UI components (built-in + custom).
 *
 * Returns a data_table showing all components the bot can use with render_ui.
 */
import { listComponentsOnPvc } from "../../k8s/index.js";
import type { ManagedBy } from "../../k8s/constants.js";
import { COMPONENT_NAME_SET, getComponentDescriptions, COMPONENT_MANIFEST } from "@jarble/component-manifest";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

// Descriptions derived from the shared manifest (single source of truth)
const BUILTIN_DESCRIPTIONS: Record<string, string> = getComponentDescriptions(COMPONENT_MANIFEST);
const BUILTIN_COMPONENTS: Set<string> = COMPONENT_NAME_SET;

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
    const managedBy = (ctx.deployment?.managedBy ?? "legacy") as ManagedBy;
    const customComponents = await listComponentsOnPvc(ctx.deploymentId, managedBy);

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

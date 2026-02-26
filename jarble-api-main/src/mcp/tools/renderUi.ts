/**
 * render_ui MCP Tool — Render a UI component on the Jarble canvas.
 *
 * Supports both built-in components (card, data_table, etc.) and custom
 * bot-defined components stored on the PVC.
 */
import { readComponentFromPvc } from "../../k8s/index.js";
import {
  isBuiltinComponent,
  resolveCustomComponent,
  type ComponentDefinition,
} from "../../utils/componentResolver.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const renderUiTool: McpTool = {
  name: "render_ui",
  description:
    "Render a UI component on the Jarble canvas. Supports built-in components (card, data_table, stat_grid, key_value, code_block, alert, progress, image, layout, chart, tabs, accordion, badge, list, timeline, divider, avatar, blockquote, metric_card, header, button_group, form, gauge, radar, treemap, funnel, waterfall, scatter, steps, result, tree, calendar_heatmap, descriptions, code_editor, map, carousel, stock, sankey, sunburst, heatmap, wordcloud, histogram, box, liquid, rose, dual_axes, bullet, radial_bar, venn, circle_packing, statistic, tag_cloud, video, image_gallery, audio, spreadsheet, sandbox) and custom bot-defined components.",
  parameters: {
    type: "object",
    properties: {
      component: {
        type: "string",
        description:
          "Component name — a built-in (card, data_table, stat_grid, key_value, code_block, alert, progress, image, layout, chart, tabs, accordion, badge, list, timeline, divider, avatar, blockquote, metric_card, header, button_group, form, gauge, radar, treemap, funnel, waterfall, scatter, steps, result, tree, calendar_heatmap, descriptions, code_editor, map, carousel, stock, sankey, sunburst, heatmap, wordcloud, histogram, box, liquid, rose, dual_axes, bullet, radial_bar, venn, circle_packing, statistic, tag_cloud, video, image_gallery, audio, spreadsheet, sandbox) or a custom component name",
      },
      props: {
        type: "object",
        description: "Component props — structure depends on the component type. See component reference for required fields.",
        additionalProperties: true,
      },
    },
    required: ["component", "props"],
  },
  rendersComponent: "canvas_block",
  async execute(
    params: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const component = params.component as string;
    const props = (params.props as Record<string, unknown>) || {};

    if (!component) {
      return { success: false, message: "Missing 'component' parameter." };
    }

    // Built-in component — pass through directly
    if (isBuiltinComponent(component)) {
      return {
        success: true,
        message: `Rendering ${component} component.`,
        data: { component, props },
      };
    }

    // Custom component — resolve from PVC
    try {
      const definition = await readComponentFromPvc(ctx.deploymentId, component);
      if (!definition) {
        return {
          success: false,
          message: `Component "${component}" not found. Use list_components to see available components, or define_component to create a new one.`,
        };
      }

      const resolved = resolveCustomComponent(
        definition as unknown as ComponentDefinition,
        props
      );

      // Return as a layout component wrapping the resolved children
      return {
        success: true,
        message: `Rendering custom component "${component}".`,
        data: {
          component: "layout",
          props: {
            title: (definition as any).description || undefined,
            children: resolved,
          },
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { deploymentId: ctx.deploymentId, component, err: msg },
        "render_ui: failed to resolve custom component"
      );
      return {
        success: false,
        message: `Failed to resolve component "${component}": ${msg}`,
      };
    }
  },
};

import { db, tables, dbDate } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { validateThemeConfig } from "@jarble/component-manifest";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const setThemeTool: McpTool = {
  name: "set_theme",
  description:
    "Set the visual theme for this deployment's web chat page. Supports presets (midnight, forest, cyberpunk, ocean, rose, amber, terminal) and custom color overrides. Use 'default' preset to reset. Omit all params to view current theme.",
  parameters: {
    type: "object",
    properties: {
      preset: {
        type: "string",
        enum: ["default", "midnight", "forest", "cyberpunk", "ocean", "rose", "amber", "terminal"],
        description: "Theme preset name. 'default' resets to platform defaults.",
      },
      colors: {
        type: "object",
        description:
          "Custom color overrides (hex values like '#ff0000'). Keys: background, foreground, primary, primary-foreground, secondary, secondary-foreground, card, card-foreground, muted, muted-foreground, accent, accent-foreground, destructive, border, input, ring, chart-1 through chart-5.",
        additionalProperties: { type: "string" },
      },
      radius: {
        type: "string",
        description: "Border radius value, e.g. '0.75rem', '0', '1rem'",
      },
      fontFamily: {
        type: "string",
        description: "CSS font-family for body text, e.g. \"'Fira Code', monospace\"",
      },
      headingFontFamily: {
        type: "string",
        description: "CSS font-family for headings, e.g. \"'Playfair Display', serif\"",
      },
    },
  },
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    // If nothing specified, return current theme
    const hasParams = params.preset || params.colors || params.radius || params.fontFamily || params.headingFontFamily;
    if (!hasParams) {
      const current = ctx.deployment.themeConfig;
      if (!current) {
        return { success: true, message: "No custom theme set — using platform defaults." };
      }
      try {
        const parsed = JSON.parse(current);
        return {
          success: true,
          message: `Current theme: ${JSON.stringify(parsed, null, 2)}`,
          data: parsed,
        };
      } catch {
        return { success: true, message: "No custom theme set — using platform defaults." };
      }
    }

    // Build theme config from params
    const themeConfig: Record<string, unknown> = {};
    if (params.preset) themeConfig.preset = params.preset;
    if (params.colors) themeConfig.colors = params.colors;
    if (params.radius) themeConfig.radius = params.radius;
    if (params.fontFamily) themeConfig.fontFamily = params.fontFamily;
    if (params.headingFontFamily) themeConfig.headingFontFamily = params.headingFontFamily;

    // If preset is "default" and nothing else, reset
    if (themeConfig.preset === "default" && Object.keys(themeConfig).length === 1) {
      await db.update(tables.deployments)
        .set({ themeConfig: null, updatedAt: dbDate() } as any)
        .where(eq(tables.deployments.id, ctx.deploymentId));

      logger.info({ deploymentId: ctx.deploymentId }, "MCP: Theme reset to default");
      return { success: true, message: "Theme reset to platform defaults." };
    }

    // Validate
    const error = validateThemeConfig(themeConfig);
    if (error) {
      return { success: false, message: `Invalid theme config: ${error}` };
    }

    // Persist
    await db.update(tables.deployments)
      .set({ themeConfig: JSON.stringify(themeConfig), updatedAt: dbDate() } as any)
      .where(eq(tables.deployments.id, ctx.deploymentId));

    const parts: string[] = [];
    if (themeConfig.preset) parts.push(`Preset: ${themeConfig.preset}`);
    if (themeConfig.colors) parts.push(`Custom colors: ${Object.keys(themeConfig.colors as object).join(", ")}`);
    if (themeConfig.radius) parts.push(`Border radius: ${themeConfig.radius}`);
    if (themeConfig.fontFamily) parts.push(`Font: ${themeConfig.fontFamily}`);
    if (themeConfig.headingFontFamily) parts.push(`Heading font: ${themeConfig.headingFontFamily}`);

    logger.info({ deploymentId: ctx.deploymentId, preset: themeConfig.preset }, "MCP: Theme updated");

    return {
      success: true,
      message: `Theme updated! The chat page will reflect the new theme on next load.\n${parts.join("\n")}`,
    };
  },
};

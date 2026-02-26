import { db, tables } from "../../db/index.js";
import { eq } from "drizzle-orm";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const getDeploymentInfoTool: McpTool = {
  name: "get_deployment_info",
  description:
    "Get the current deployment status, name, runtime, LLM config, and connected platforms. Use when user asks about status, info, or overview.",
  parameters: {
    type: "object",
    properties: {},
  },
  rendersComponent: "show_status",
  async execute(_params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const dep = ctx.deployment;

    // Fetch connected platforms
    const creds = await db.query.platformCredentials.findMany({
      where: eq(tables.platformCredentials.deploymentId, ctx.deploymentId),
    });
    const platforms = (creds as any[]).map((c) => c.platformId);

    return {
      success: true,
      message: `Deployment "${dep.name}" is ${dep.status}. Runtime: ${dep.runtime}. LLM: ${dep.llmProvider || "none"}/${dep.llmModel || "none"}. Connected platforms: ${platforms.length > 0 ? platforms.join(", ") : "none"}.`,
      data: {
        id: dep.id,
        name: dep.name,
        status: dep.status,
        runtime: dep.runtime,
        llmProvider: dep.llmProvider,
        llmModel: dep.llmModel,
        llmMode: dep.llmMode,
        systemPrompt: dep.systemPrompt,
        description: dep.description,
        connectedPlatforms: platforms,
      },
    };
  },
};

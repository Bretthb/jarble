import { db, tables, dbDate } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { encryptApiKey } from "../../utils/encryption.js";
import { syncConfigsToPvc } from "../../services/configSync.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const updateLlmConfigTool: McpTool = {
  name: "update_llm_config",
  description:
    "View or update the LLM provider, model, or API key. If no parameters are provided, returns current config.",
  parameters: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        enum: ["openrouter", "openai", "anthropic", "google"],
        description: "LLM provider",
      },
      model: {
        type: "string",
        description: "LLM model ID (e.g. 'openrouter/auto', 'gpt-4o', 'claude-sonnet-4-20250514')",
      },
      apiKey: {
        type: "string",
        description: "New LLM API key (will be encrypted at rest)",
      },
    },
  },
  rendersComponent: "show_llm_config",
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const provider = params.provider as string | undefined;
    const model = params.model as string | undefined;
    const apiKey = params.apiKey as string | undefined;

    // Read-only if no params
    if (!provider && !model && !apiKey) {
      return {
        success: true,
        message: `Current LLM config: provider=${ctx.deployment.llmProvider || "none"}, model=${ctx.deployment.llmModel || "none"}, mode=${ctx.deployment.llmMode}.`,
        data: {
          llmProvider: ctx.deployment.llmProvider,
          llmModel: ctx.deployment.llmModel,
          llmMode: ctx.deployment.llmMode,
        },
      };
    }

    const updates: Record<string, any> = { updatedAt: dbDate() };
    if (provider) updates.llmProvider = provider;
    if (model) updates.llmModel = model;
    if (apiKey) updates.llmApiKey = encryptApiKey(apiKey);

    await db.update(tables.deployments)
      .set(updates)
      .where(eq(tables.deployments.id, ctx.deploymentId));

    logger.info({ deploymentId: ctx.deploymentId, provider, model }, "MCP: LLM config updated");

    // Secret change → triggers configSync restart
    if (ctx.deployment.status === "running") {
      void syncConfigsToPvc(ctx.deploymentId);
    }

    const parts: string[] = [];
    if (provider) parts.push(`provider → ${provider}`);
    if (model) parts.push(`model → ${model}`);
    if (apiKey) parts.push("API key updated");

    return {
      success: true,
      message: `LLM config updated: ${parts.join(", ")}. ${apiKey ? "The bot is restarting to apply the new key." : ""}`,
    };
  },
};

/**
 * Tambo tool definitions — infrastructure-only wrappers around tRPC mutations.
 *
 * Each tool is scoped to a deployment via createTamboTools(deploymentId).
 * Tools use the vanilla tRPC client (no hooks) so they can run
 * from Tambo's agent execution context.
 *
 * Bot interaction (chat, config, skills, platforms, files) is now handled
 * via MCP — see DeploymentTamboProvider for mcpServers config.
 */
import { defineTool } from "@tambo-ai/react";
import { z } from "zod";
import { vanillaClient } from "./trpc-vanilla";

// ── Tool Factory ───────────────────────────────────────────────────────────

export function createTamboTools(deploymentId: string) {
  return [
    // ── Infrastructure Tools — things the bot can't do for itself ────────

    defineTool({
      name: "startDeployment",
      description: "Start a stopped deployment.",
      tool: async () => {
        return await vanillaClient.deployment.start.mutate({ id: deploymentId });
      },
      inputSchema: z.object({}),
      outputSchema: z.object({ success: z.boolean() }),
    }),

    defineTool({
      name: "stopDeployment",
      description: "Stop a running deployment. The pod will be scaled to 0.",
      tool: async () => {
        return await vanillaClient.deployment.stop.mutate({ id: deploymentId });
      },
      inputSchema: z.object({}),
      outputSchema: z.object({ success: z.boolean() }),
    }),

    defineTool({
      name: "restartDeployment",
      description: "Restart the deployment. This scales the pod down and back up.",
      tool: async () => {
        return await vanillaClient.deployment.restart.mutate({ id: deploymentId });
      },
      inputSchema: z.object({}),
      outputSchema: z.object({ success: z.boolean() }),
    }),

    defineTool({
      name: "deleteDeployment",
      description:
        "Permanently delete this deployment and all its resources. This is irreversible.",
      tool: async () => {
        return await vanillaClient.deployment.delete.mutate({ id: deploymentId });
      },
      inputSchema: z.object({}),
      outputSchema: z.object({ success: z.boolean() }),
    }),

    defineTool({
      name: "changeLlmApiKey",
      description:
        "Change the LLM API key for this deployment. Use when the bot is down because it ran out of tokens or the key expired. This is an infrastructure-level change.",
      tool: async (params) => {
        return await vanillaClient.deployment.update.mutate({
          id: deploymentId,
          llmApiKey: params.apiKey,
          ...(params.provider ? { llmProvider: params.provider } : {}),
        });
      },
      inputSchema: z.object({
        apiKey: z.string().describe("The new LLM API key"),
        provider: z
          .enum(["openrouter", "openai", "anthropic", "google"])
          .optional()
          .describe("LLM provider (only if switching providers)"),
      }),
      outputSchema: z.object({ success: z.boolean() }),
    }),

    defineTool({
      name: "getDeploymentLogs",
      description:
        "Fetch recent pod logs. Use when the bot is unresponsive and you need to debug why.",
      tool: async () => {
        return await vanillaClient.deployment.getLogs.query({ id: deploymentId });
      },
      inputSchema: z.object({}),
      outputSchema: z.object({
        logs: z.string(),
      }),
      annotations: { tamboStreamableHint: true },
    }),

    defineTool({
      name: "getDeploymentStatus",
      description:
        "Check if the pod is running. Use when the bot is unresponsive to see if it's a pod-level issue.",
      tool: async () => {
        return await vanillaClient.deployment.getStatus.query({ id: deploymentId });
      },
      inputSchema: z.object({}),
      outputSchema: z.object({
        status: z.string(),
        podPhase: z.string().optional(),
      }),
      annotations: { tamboStreamableHint: true },
    }),
  ];
}

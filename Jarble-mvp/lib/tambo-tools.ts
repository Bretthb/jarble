/**
 * Tambo tool definitions — wrappers around tRPC mutations.
 *
 * Each tool is scoped to a deployment via createTamboTools(deploymentId).
 * Tools use the vanilla tRPC client (no hooks) so they can run
 * from Tambo's agent execution context.
 */
import { defineTool } from "@tambo-ai/react";
import { z } from "zod";
import { vanillaClient } from "./trpc-vanilla";

export function createTamboTools(deploymentId: string) {
  return [
    defineTool({
      name: "getDeploymentInfo",
      description:
        "Fetch the current deployment state including name, status, runtime, LLM config, connected platforms, and system prompt.",
      tool: async () => {
        return await vanillaClient.deployment.getById.query({ id: deploymentId });
      },
      inputSchema: z.object({}),
      outputSchema: z.object({
        id: z.string(),
        name: z.string(),
        status: z.string(),
        runtime: z.string(),
        llmProvider: z.string().nullable(),
        llmModel: z.string().nullable(),
        llmMode: z.string(),
        systemPrompt: z.string().nullable(),
        description: z.string().nullable(),
      }),
      annotations: { tamboStreamableHint: true },
    }),

    defineTool({
      name: "updateDeployment",
      description:
        "Update deployment settings: name, description, system prompt, LLM provider, LLM model, or LLM API key. Only include fields you want to change.",
      tool: async (params) => {
        return await vanillaClient.deployment.update.mutate({
          id: deploymentId,
          ...params,
        });
      },
      inputSchema: z.object({
        name: z.string().optional().describe("New deployment name"),
        description: z.string().optional().describe("New description"),
        systemPrompt: z.string().optional().describe("New system prompt"),
        llmProvider: z
          .enum(["openrouter", "openai", "anthropic", "google"])
          .optional()
          .describe("LLM provider"),
        llmModel: z.string().optional().describe("LLM model ID"),
        llmApiKey: z.string().optional().describe("New LLM API key (encrypted at rest)"),
      }),
      outputSchema: z.object({ success: z.boolean() }),
    }),

    defineTool({
      name: "savePlatformCredentials",
      description:
        "Save platform credentials to connect a messaging platform (Telegram, Discord, Slack). This triggers configSync to update the pod.",
      tool: async (params) => {
        return await vanillaClient.platformCredentials.save.mutate({
          deploymentId,
          platformId: params.platformId,
          credentials: params.credentials,
        });
      },
      inputSchema: z.object({
        platformId: z
          .enum(["telegram", "discord", "slack", "whatsapp"])
          .describe("The messaging platform to connect"),
        credentials: z
          .object({
            botToken: z.string().optional().describe("Bot token (Telegram, Discord, Slack)"),
            appToken: z.string().optional().describe("App token (Slack only)"),
          })
          .describe(
            "Platform-specific credentials. Telegram: { botToken }. Discord: { botToken }. Slack: { botToken, appToken }."
          ),
      }),
      outputSchema: z.object({ success: z.boolean() }),
    }),

    defineTool({
      name: "deletePlatformCredentials",
      description: "Remove platform credentials and disconnect a messaging platform.",
      tool: async (params) => {
        return await vanillaClient.platformCredentials.delete.mutate({
          deploymentId,
          platformId: params.platformId,
        });
      },
      inputSchema: z.object({
        platformId: z
          .enum(["telegram", "discord", "slack", "whatsapp"])
          .describe("The platform to disconnect"),
      }),
      outputSchema: z.object({ success: z.boolean() }),
    }),

    defineTool({
      name: "getPlatformCredentials",
      description: "Get which platforms are connected and their masked credentials.",
      tool: async () => {
        return await vanillaClient.platformCredentials.getByDeployment.query({
          deploymentId,
        });
      },
      inputSchema: z.object({}),
      outputSchema: z.array(
        z.object({
          platformId: z.string(),
          maskedCredentials: z.object({
            botToken: z.string().optional(),
            appToken: z.string().optional(),
          }).optional(),
        })
      ),
      annotations: { tamboStreamableHint: true },
    }),

    defineTool({
      name: "listSkills",
      description: "List all available skills from the catalog and which ones are installed on this deployment.",
      tool: async () => {
        const [catalog, installed] = await Promise.all([
          vanillaClient.skills.listCatalog.query({}),
          vanillaClient.skills.listForDeployment.query({ deploymentId }),
        ]);
        const installedSkillIds = new Set(
          (installed as Array<{ skill: { id: string } | null }>)
            .filter((entry) => entry.skill !== null)
            .map((entry) => entry.skill!.id)
        );
        return (catalog as Array<{ id: string; name: string; description: string | null }>).map(
          (skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            installed: installedSkillIds.has(skill.id),
          })
        );
      },
      inputSchema: z.object({}),
      outputSchema: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          installed: z.boolean(),
        })
      ),
      annotations: { tamboStreamableHint: true },
    }),

    defineTool({
      name: "installSkill",
      description: "Install a skill on this deployment by skill ID.",
      tool: async (params) => {
        return await vanillaClient.skills.install.mutate({
          deploymentId,
          skillId: params.skillId,
        });
      },
      inputSchema: z.object({
        skillId: z.string().describe("The skill catalog ID to install"),
      }),
      outputSchema: z.object({ success: z.boolean() }),
    }),

    defineTool({
      name: "uninstallSkill",
      description: "Uninstall a skill from this deployment by skill ID.",
      tool: async (params) => {
        return await vanillaClient.skills.uninstall.mutate({
          deploymentId,
          skillId: params.skillId,
        });
      },
      inputSchema: z.object({
        skillId: z.string().describe("The skill catalog ID to uninstall"),
      }),
      outputSchema: z.object({ success: z.boolean() }),
    }),

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
      name: "getDeploymentLogs",
      description: "Fetch recent logs from the deployment pod.",
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
      description: "Get the current K8s pod status for this deployment.",
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

    defineTool({
      name: "validateProviderKey",
      description: "Validate an LLM API key for a given provider.",
      tool: async (params) => {
        return await vanillaClient.openrouter.validateProviderKey.mutate(params);
      },
      inputSchema: z.object({
        provider: z
          .enum(["openrouter", "openai", "anthropic", "google"])
          .describe("The LLM provider"),
        apiKey: z.string().describe("The API key to validate"),
      }),
      outputSchema: z.object({
        valid: z.boolean(),
        message: z.string().optional(),
      }),
    }),

    defineTool({
      name: "pollTelegramPairing",
      description:
        "Check if a Telegram bot has been paired. Call this after saving Telegram credentials and the pod has restarted.",
      tool: async () => {
        // Use type assertion — pollTelegramPairing exists on the router but
        // the linked package type inference truncates at 6 procedures.
        return await (vanillaClient.platformCredentials as any).pollTelegramPairing.mutate({
          deploymentId,
        });
      },
      inputSchema: z.object({}),
      outputSchema: z.object({
        status: z.enum(["pending", "paired", "not_found"]),
      }),
    }),
  ];
}

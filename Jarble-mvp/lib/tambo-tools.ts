/**
 * Tambo tool definitions — wrappers around tRPC mutations.
 *
 * Each tool is scoped to a deployment via createTamboTools(deploymentId).
 * Tools use the vanilla tRPC client (no hooks) so they can run
 * from Tambo's agent execution context.
 */
import { defineTool } from "@tambo-ai/react";
import { z } from "zod";
import { vanillaClient, getToken } from "./trpc-vanilla";
import { API_URL } from "./trpc";

// ── SSE parser for chatWithBot ─────────────────────────────────────────────

/** Regex to strip ```jarble_ui ... ``` fenced blocks from displayed text */
const JARBLE_UI_FENCE = /```jarble_ui\s*\n[\s\S]*?```/g;

interface UIBlockResult {
  id: string;
  component: string;
  props: Record<string, unknown>;
}

/**
 * Call the pod proxy and collect the full response (text + UI blocks).
 * Used by the chatWithBot tool — no streaming needed since tool results
 * are returned in full.
 */
async function callPodProxy(
  deploymentId: string,
  message: string
): Promise<{ text: string; uiBlocks: UIBlockResult[] }> {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(`${API_URL}/api/tambo-agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      deploymentId,
      messages: [{ role: "user", content: message }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Request failed");
    throw new Error(errText);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const uiBlocks: UIBlockResult[] = [];
  const pendingBlocks = new Map<string, UIBlockResult>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;

      try {
        const event = JSON.parse(trimmed.slice(6));

        if (event.type === "TEXT_MESSAGE_CONTENT" && event.delta) {
          text += event.delta;
        }

        if (event.type === "UI_BLOCK_START") {
          pendingBlocks.set(event.blockId, {
            id: event.blockId,
            component: event.component,
            props: {},
          });
        }
        if (event.type === "UI_BLOCK_PROPS") {
          const block = pendingBlocks.get(event.blockId);
          if (block) block.props = event.props;
        }
        if (event.type === "UI_BLOCK_END") {
          const block = pendingBlocks.get(event.blockId);
          if (block) {
            uiBlocks.push(block);
            pendingBlocks.delete(event.blockId);
          }
        }

        if (event.type === "RUN_FINISHED") break;
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  // Strip jarble_ui markers from displayed text
  const cleanText = text.replace(JARBLE_UI_FENCE, "").replace(/\n{3,}/g, "\n\n").trim();

  return { text: cleanText, uiBlocks };
}

// ── Tool Factory ───────────────────────────────────────────────────────────

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
        return await (vanillaClient.platformCredentials as any).pollTelegramPairing.mutate({
          deploymentId,
        });
      },
      inputSchema: z.object({}),
      outputSchema: z.object({
        status: z.enum(["pending", "paired", "not_found"]),
      }),
    }),

    // ── Bot Chat Tool ─────────────────────────────────────────────────────

    defineTool({
      name: "chatWithBot",
      description:
        "Send a message to the bot running on this deployment and get its response. " +
        "Use this when the user wants to chat with their bot, test it, or ask it questions. " +
        "The bot may return text and/or UI blocks (cards, tables, charts, etc.). " +
        "If the result includes uiBlocks, render each one as the corresponding Canvas component.",
      tool: async (params) => {
        try {
          return await callPodProxy(deploymentId, params.message);
        } catch (err: any) {
          // Return error as text instead of throwing so Tambo can relay it
          return {
            text: `Could not reach the bot: ${err.message || "unknown error"}. The bot may be starting up or unreachable. Try checking its status.`,
            uiBlocks: [],
          };
        }
      },
      inputSchema: z.object({
        message: z.string().describe("The message to send to the bot"),
      }),
      outputSchema: z.object({
        text: z.string().describe("The bot's text response"),
        uiBlocks: z
          .array(
            z.object({
              id: z.string(),
              component: z.string().describe("Canvas component name: card, data_table, stat_grid, key_value, code_block, alert, progress, image, layout"),
              props: z.record(z.string(), z.unknown()).describe("Props for the canvas component"),
            })
          )
          .describe("UI blocks returned by the bot — render each as the corresponding CanvasXxx component"),
      }),
    }),
  ];
}

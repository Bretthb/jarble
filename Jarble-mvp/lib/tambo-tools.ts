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

/** Map bot snake_case component names to Tambo PascalCase registered names */
const BOT_TO_TAMBO_NAME: Record<string, string> = {
  card: "Card",
  data_table: "DataTable",
  stat_grid: "StatGrid",
  key_value: "KeyValue",
  code_block: "CodeBlock",
  alert: "Alert",
  progress: "Progress",
  image: "Image",
  layout: "Card", // layout not registered — fallback to Card
};

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
            ...(event.editable ? { editable: true } : {}),
            ...(event.fileId ? { fileId: event.fileId } : {}),
            ...(event.saveMethod ? { saveMethod: event.saveMethod } : {}),
          });
        }
        if (event.type === "UI_BLOCK_PROPS") {
          const block = pendingBlocks.get(event.blockId);
          if (block) {
            block.props = event.props;
          }
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

    // ── Bot Chat Tool — primary interface ────────────────────────────────

    defineTool({
      name: "chatWithBot",
      description:
        "Send a message to the bot and get its response. The bot may return text and structured data. " +
        "If it returns structured data (dataBlocks), use the appropriate canvas component " +
        "(DataTable, StatGrid, Card, KeyValue, CodeBlock, Alert, Progress, Image) to render it.",
      tool: async (params) => {
        try {
          const result = await callPodProxy(deploymentId, params.message);

          return {
            text: result.text,
            dataBlocks: result.uiBlocks.map((b) => ({
              suggestedComponent: BOT_TO_TAMBO_NAME[b.component] || b.component,
              data: b.props,
            })),
          };
        } catch (err: any) {
          return {
            text: `Could not reach the bot: ${err.message || "unknown error"}. The bot may be starting up or unreachable. Try checking its status.`,
            dataBlocks: [],
          };
        }
      },
      inputSchema: z.object({
        message: z.string().describe("The message to send to the bot"),
      }),
      outputSchema: z.object({
        text: z.string().describe("The bot's text response"),
        dataBlocks: z.array(z.object({
          suggestedComponent: z.string().describe("The bot's suggested component type (a hint, not a requirement)"),
          data: z.record(z.string(), z.unknown()).describe("Structured data to render"),
        })).describe("Structured data blocks the bot provided — render using canvas components"),
      }),
      transformToContent: (result: { text: string; dataBlocks: Array<{ suggestedComponent: string; data: Record<string, unknown> }> }) => {
        let content = result.text || "(no response)";
        if (result.dataBlocks.length > 0) {
          content += "\n\n[Bot provided structured data — render using appropriate canvas components]\n";
          content += JSON.stringify(result.dataBlocks, null, 2);
        }
        return [{ type: "text" as const, text: content }];
      },
    }),
  ];
}

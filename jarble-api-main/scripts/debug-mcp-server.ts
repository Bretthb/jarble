#!/usr/bin/env npx tsx
/**
 * Jarble Debug MCP Server
 *
 * Lets Claude Code communicate directly with running OpenClaw deployments
 * for agent-to-agent debugging. Talks to the Jarble API debug endpoints.
 *
 * Tools:
 *   - list_deployments — List all deployments with statuses
 *   - chat_with_deployment — Send a message to a bot, get structured response
 *   - read_deployment_config — Read config files from a pod's PVC
 *   - sync_deployment_config — Force configSync push to pod
 *   - get_deployment_logs — Get recent pod logs
 *   - get_deployment_status — Get DB + pod status for a deployment
 *   - set_deployment_theme — Set the theme preset for a deployment
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.JARBLE_API_URL || "http://localhost:3001";

// ── HTTP helper ──────────────────────────────────────────────────────────────

async function apiGet(path: string): Promise<any> {
  const url = `${API_BASE}/debug${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API GET ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function apiPost(path: string, body?: unknown): Promise<any> {
  const url = `${API_BASE}/debug${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "jarble-debug",
  version: "1.0.0",
});

// 1. List deployments
server.tool(
  "list_deployments",
  "List all deployments with their statuses, runtime, and LLM config",
  {},
  async () => {
    const data = await apiGet("/db");
    const deployments = data.tables?.deployments?.data || [];
    const summary = deployments.map((d: any) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      runtime: d.runtime,
      llmProvider: d.llmProvider,
      llmModel: d.llmModel,
      template: d.template,
      createdAt: d.createdAt,
    }));
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(summary, null, 2),
      }],
    };
  },
);

// 2. Chat with deployment
server.tool(
  "chat_with_deployment",
  "Send a message to an OpenClaw bot deployment and get the response. Returns text + any UI blocks the bot renders.",
  {
    deploymentId: z.string().describe("The deployment ID to chat with"),
    message: z.string().describe("The message to send to the bot"),
    sessionKey: z.string().optional().describe("Session key for conversation continuity (auto-generated if omitted)"),
  },
  async ({ deploymentId, message, sessionKey }) => {
    const result = await apiPost(`/deployment/${deploymentId}/chat`, {
      message,
      sessionKey,
    });
    const parts: string[] = [];
    parts.push(`**Bot response:**\n${result.text}`);
    if (result.uiBlocks?.length > 0) {
      parts.push(`\n**UI Blocks (${result.uiBlocks.length}):**\n${JSON.stringify(result.uiBlocks, null, 2)}`);
    }
    if (result.uiUpdates?.length > 0) {
      parts.push(`\n**UI Updates (${result.uiUpdates.length}):**\n${JSON.stringify(result.uiUpdates, null, 2)}`);
    }
    if (result.componentDefs?.length > 0) {
      parts.push(`\n**Component Definitions (${result.componentDefs.length}):**\n${JSON.stringify(result.componentDefs, null, 2)}`);
    }
    return {
      content: [{
        type: "text" as const,
        text: parts.join("\n"),
      }],
    };
  },
);

// 3. Read deployment config
server.tool(
  "read_deployment_config",
  "Read config files from a deployment's pod PVC. Without a file path, returns soul.md, openclaw.json, and directory listings. With a file path, reads that specific file.",
  {
    deploymentId: z.string().describe("The deployment ID"),
    file: z.string().optional().describe("Specific file path relative to /data/ (e.g. 'config/soul.md', 'skills/web-search.json'). Omit to get overview."),
  },
  async ({ deploymentId, file }) => {
    const query = file ? `?file=${encodeURIComponent(file)}` : "";
    const result = await apiGet(`/deployment/${deploymentId}/config${query}`);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(result, null, 2),
      }],
    };
  },
);

// 4. Sync deployment config
server.tool(
  "sync_deployment_config",
  "Force a configSync push to the pod — re-renders soul.md, openclaw.json, skills, and restarts the deployment. Use after making DB changes that need to reach the pod.",
  {
    deploymentId: z.string().describe("The deployment ID to sync"),
  },
  async ({ deploymentId }) => {
    const result = await apiPost(`/deployment/${deploymentId}/sync-config`);
    return {
      content: [{
        type: "text" as const,
        text: `Config sync triggered for ${deploymentId}. ${result.message || "Running in background."}`,
      }],
    };
  },
);

// 5. Get deployment logs
server.tool(
  "get_deployment_logs",
  "Get recent pod logs from a deployment. Useful for debugging bot startup issues, MCP tool errors, or runtime crashes.",
  {
    deploymentId: z.string().describe("The deployment ID"),
    tailLines: z.number().optional().default(100).describe("Number of log lines to fetch (default 100)"),
  },
  async ({ deploymentId, tailLines }) => {
    const result = await apiGet(`/deployment/${deploymentId}/logs?tail=${tailLines}`);
    return {
      content: [{
        type: "text" as const,
        text: `**Pod:** ${result.podName} (${result.lineCount} lines)\n\n\`\`\`\n${result.logs}\n\`\`\``,
      }],
    };
  },
);

// 6. Get deployment status
server.tool(
  "get_deployment_status",
  "Get detailed status for a deployment — DB record + live pod status",
  {
    deploymentId: z.string().describe("The deployment ID"),
  },
  async ({ deploymentId }) => {
    const dbData = await apiGet("/db");
    const deployment = (dbData.tables?.deployments?.data || []).find((d: any) => d.id === deploymentId);
    if (!deployment) {
      return {
        content: [{
          type: "text" as const,
          text: `Deployment ${deploymentId} not found in database`,
        }],
      };
    }
    // Try to get pod status
    let podStatus = null;
    try {
      podStatus = await apiGet(`/deployment/${deploymentId}/pod-status`);
    } catch {
      // Pod status endpoint may not exist or pod may not exist
    }
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ deployment, podStatus }, null, 2),
      }],
    };
  },
);

// 7. Set deployment theme
server.tool(
  "set_deployment_theme",
  "Set the visual theme for a deployment's workspace. Available presets: default, ocean, forest, sunset, midnight, lavender, cyberpunk",
  {
    deploymentId: z.string().describe("The deployment ID"),
    preset: z.string().describe("Theme preset name: default, ocean, forest, sunset, midnight, lavender, cyberpunk"),
  },
  async ({ deploymentId, preset }) => {
    const result = await apiPost(`/deployment/${deploymentId}/theme`, { preset });
    return {
      content: [{
        type: "text" as const,
        text: `Theme set to "${preset}" for deployment ${deploymentId}. ${result.message || ""}`,
      }],
    };
  },
);

// ── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server fatal error:", err);
  process.exit(1);
});

"use client";

/**
 * DeploymentTamboProvider - wraps TamboProvider with deployment-scoped tools,
 * registered components, Auth0 token, MCP server config, and agent context.
 *
 * Place this around the chat interface for a specific deployment.
 */

import { createContext, useContext, useMemo, useState, useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { TamboProvider, type ContextHelpers } from "@tambo-ai/react";
import { MCPTransport, TamboMcpProvider } from "@tambo-ai/react/mcp";
import { tamboComponents, createTamboTools } from "@/lib/tambo";
import { API_URL } from "@/lib/trpc";

/** React context so child components can read the deployment ID. */
const DeploymentIdContext = createContext<string>("");
export function useDeploymentId() {
  return useContext(DeploymentIdContext);
}

const TAMBO_API_KEY = process.env.NEXT_PUBLIC_TAMBO_API_KEY!;

/** Agent instructions injected via contextHelpers so the hosted agent knows
 *  how to behave and when to use which tools. */
const AGENT_INSTRUCTIONS = `You are Jarble's configuration & prompt engineering assistant. You help users manage their bot AND craft effective system prompts. The bot runs on a pod and communicates via MCP tools.

IMPORTANT: You are in the CONFIG SIDEBAR. The user talks to their bot directly through the main canvas chat. Your job is configuration, management, and prompt coaching.

## What you handle:

### Prompt Engineering (primary)
- Read the current system prompt: use read_file on /data/config/soul.md
- Write/update the system prompt: use write_file to /data/config/soul.md (then restart for changes to take effect)
- Help users write effective prompts: personality, tone, knowledge areas, response style
- Explain what the bot can do on each platform (dashboard UI components vs plain text on Telegram/Discord)
- Suggest prompt improvements based on what the user wants the bot to do

When editing soul.md:
- The FIRST section is the user's custom prompt (personality, instructions, knowledge)
- The LAST section (## Platform Awareness onward) is auto-injected by Jarble - do NOT remove or edit it
- Place user content BEFORE the ## Platform Awareness section
- After writing, remind the user to restart the bot (or offer to do it) for changes to take effect

### Prompt tips you should share:
- Be specific about tone and personality ("You are a friendly cooking assistant" > "You help with cooking")
- Define what the bot should/shouldn't do
- Include domain knowledge or example responses
- For dashboard bots: mention that the bot can create charts, tables, interactive widgets, and 3D visualizations
- For multi-platform bots: the bot auto-detects platform - no special instructions needed

### Configuration
- Platform management → connect/disconnect platforms (WhatsApp, Telegram, etc.)
- LLM settings → change model, temperature, max tokens via MCP
- Lifecycle operations → restart/stop/start/delete using infrastructure tools
- API key changes → use changeLlmApiKey tool
- Pod debugging → use getDeploymentLogs, getDeploymentStatus
- File management → use read_file/write_file MCP tools
- Skill/component management → use MCP tools to list/create/delete custom components

## DO NOT:
- Forward user messages to the bot (the canvas handles that directly)
- Try to have conversations with the bot on behalf of the user
- Edit the ## Platform Awareness section of soul.md (it's auto-managed)

## File Rendering
When read_file returns file content, render a BotCanvas with:
- component: "code_block"
- propsJson: JSON.stringify({ code: <content>, language: <ext>, title: <filename> })
- fileId: the full file path
- editable: true
- deploymentId: from context

## Destructive Actions
For restart, stop, delete: ALWAYS render ConfirmAction first.`;

interface DeploymentTamboProviderProps {
  deploymentId: string;
  deploymentName: string;
  children: React.ReactNode;
}

export default function DeploymentTamboProvider({
  deploymentId,
  deploymentName,
  children,
}: DeploymentTamboProviderProps) {
  const { user, getAccessTokenSilently } = useAuth0();
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAccessTokenSilently()
      .then((token) => { if (!cancelled) setAuthToken(token); })
      .catch((err) => { console.warn("[Jarble:Auth] Failed to get access token:", err); });
    return () => { cancelled = true; };
  }, [getAccessTokenSilently]);

  const tools = useMemo(
    () => createTamboTools(deploymentId),
    [deploymentId]
  );

  const mcpServers = useMemo(() => {
    if (!authToken) return [];
    return [{
      url: `${API_URL}/api/mcp/${deploymentId}`,
      serverKey: "openclaw",
      customHeaders: { Authorization: `Bearer ${authToken}` },
      transport: MCPTransport.HTTP,
    }];
  }, [deploymentId, authToken]);

  const contextHelpers: ContextHelpers = useMemo(
    () => ({
      agentInstructions: () => AGENT_INSTRUCTIONS,
      deploymentContext: () => ({
        deploymentId,
        deploymentName,
      }),
    }),
    [deploymentId, deploymentName]
  );

  const initialMessages = useMemo(
    () => [
      {
        role: "assistant" as const,
        content: [
          {
            type: "text" as const,
            text: `Config panel for **${deploymentName}**. I can help you craft your bot's personality & system prompt, manage platforms, LLM settings, and pod lifecycle. Chat with your bot directly on the canvas - use me for configuration and prompt engineering.`,
          },
        ],
      },
    ],
    [deploymentName]
  );

  return (
    <DeploymentIdContext.Provider value={deploymentId}>
      <TamboProvider
        apiKey={TAMBO_API_KEY}
        userKey={user?.sub || "anonymous"}
        components={tamboComponents}
        tools={tools}
        mcpServers={mcpServers}
        contextHelpers={contextHelpers}
        autoGenerateThreadName={false}
        initialMessages={initialMessages}
      >
        <TamboMcpProvider>
          {children}
        </TamboMcpProvider>
      </TamboProvider>
    </DeploymentIdContext.Provider>
  );
}

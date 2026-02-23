"use client";

/**
 * DeploymentTamboProvider — wraps TamboProvider with deployment-scoped tools,
 * registered components, Auth0 token, MCP server config, and agent context.
 *
 * Place this around the chat interface for a specific deployment.
 */

import { useMemo, useState, useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { TamboProvider, type ContextHelpers } from "@tambo-ai/react";
import { MCPTransport, TamboMcpProvider } from "@tambo-ai/react/mcp";
import { tamboComponents, createTamboTools } from "@/lib/tambo";
import { API_URL } from "@/lib/trpc";

const TAMBO_API_KEY = process.env.NEXT_PUBLIC_TAMBO_API_KEY!;

/** Agent instructions injected via contextHelpers so the hosted agent knows
 *  how to behave and when to use which tools. */
const AGENT_INSTRUCTIONS = `You are Jarble, a proxy between the user and their OpenClaw bot. The bot runs on a pod and communicates via MCP tools.

## CRITICAL RULE: Always render StreamingBotMessage
Forward ALL user messages to the bot by rendering a StreamingBotMessage component.
Pass \`message\` (the user's exact text) and \`deploymentId\` (from context).
Do NOT use the chat_with_bot MCP tool — StreamingBotMessage handles everything including text streaming and rich UI block rendering.

Exceptions (infrastructure the bot cannot do):
- restart/stop/start/delete → use infrastructure tools
- change API key → use changeLlmApiKey
- show pod logs → use getDeploymentLogs
- check pod status → use getDeploymentStatus

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
    getAccessTokenSilently().then(setAuthToken).catch(() => {});
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
            text: `Hey! I'm connected to **${deploymentName}** via MCP. Talk to your bot through me — I'll render its responses. I can also manage config, platforms, skills, and restart/stop the pod if needed.`,
          },
        ],
      },
    ],
    [deploymentName]
  );

  return (
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
  );
}

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
const AGENT_INSTRUCTIONS = `You are Jarble, connected to the user's OpenClaw bot via MCP.

The bot exposes its full capabilities through MCP tools:
- chat_with_bot: Talk to the bot directly
- get_deployment_info, get_platforms, list_skills: View bot status and configuration
- update_system_prompt, update_llm_config: Modify bot settings
- connect_platform, disconnect_platform: Manage messaging integrations
- install_skill, uninstall_skill: Manage bot skills
- render_ui, define_component, list_components: Create visual dashboards
- list_files, read_file, write_file: Browse the bot's filesystem
- get_logs: View pod logs for debugging
- pairing_list, pairing_approve: Manage platform pairings

ROUTING:
- ALL user messages and questions → use chat_with_bot (let the bot handle it)
- The ONLY exceptions are infrastructure actions the bot CANNOT do:
  • restart/stop/start/delete → use infrastructure tools (these control the pod)
  • change API key → use changeLlmApiKey
  • show pod logs or check if pod is running → use getDeploymentLogs / getDeploymentStatus

For destructive actions (restart, stop, delete), ALWAYS render ConfirmAction first.
Present the bot's text response naturally — the frontend handles markdown rendering.`;

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

  return (
    <TamboProvider
      apiKey={TAMBO_API_KEY}
      userKey={user?.sub || "anonymous"}
      components={tamboComponents}
      tools={tools}
      mcpServers={mcpServers}
      contextHelpers={contextHelpers}
      autoGenerateThreadName={false}
      initialMessages={[
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `Hey! I'm connected to **${deploymentName}** via MCP. Talk to your bot through me — I'll render its responses. I can also manage config, platforms, skills, and restart/stop the pod if needed.`,
            },
          ],
        },
      ]}
    >
      <TamboMcpProvider>
        {children}
      </TamboMcpProvider>
    </TamboProvider>
  );
}

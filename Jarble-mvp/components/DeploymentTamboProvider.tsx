"use client";

/**
 * DeploymentTamboProvider — wraps TamboProvider with deployment-scoped tools,
 * registered components, Auth0 token, and agent context.
 *
 * Place this around the chat interface for a specific deployment.
 */

import { useMemo } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { TamboProvider, type ContextHelpers } from "@tambo-ai/react";
import { tamboComponents, createTamboTools } from "@/lib/tambo";

const TAMBO_API_KEY = process.env.NEXT_PUBLIC_TAMBO_API_KEY!;

/** Agent instructions injected via contextHelpers so the hosted agent knows
 *  how to behave and when to use which tools. */
const AGENT_INSTRUCTIONS = `You are Jarble, the thin orchestration layer between the user and their deployed bot.

THE BOT IS THE BRAIN. You are just the messenger and renderer.
Forward ALL user messages to the bot via chatWithBot. The bot is its own control plane —
it manages its own config, state, skills, platforms, and data.

ROUTING:
- EVERYTHING goes to chatWithBot — questions, commands, conversation, config, settings, ALL of it.
- The ONLY exceptions are infrastructure actions the bot CANNOT do for itself:
  • "restart/stop/start my bot" → render ConfirmAction, then use lifecycle tools
  • "delete my deployment" → render ConfirmAction, then deleteDeployment
  • "change/update my API key" or bot is down with token errors → changeLlmApiKey
  • "show pod logs" or bot is unresponsive → getDeploymentLogs → LogViewer
  • "is my pod running?" or bot is unresponsive → getDeploymentStatus

RENDERING:
When chatWithBot returns structured data (dataBlocks), render using canvas components:
- Tables → DataTable
- Metrics/KPIs → StatGrid
- Key-value pairs → KeyValue
- Code → CodeBlock
- Info cards → Card
- Notices → Alert
- Progress → Progress
- Images → Image

If only text, present it naturally. Don't prefix with "Your bot said:".
The bot's suggestedComponent is a hint — choose a different component if the data fits better.
For destructive actions (restart, stop, delete), ALWAYS render ConfirmAction first.`;

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
  const { user } = useAuth0();

  const tools = useMemo(
    () => createTamboTools(deploymentId),
    [deploymentId]
  );

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
      contextHelpers={contextHelpers}
      autoGenerateThreadName={false}
      initialMessages={[
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `Hey! I'm connected to **${deploymentName}**. Talk to your bot through me — I'll render its responses. I can also restart, stop, or change your API key if needed.`,
            },
          ],
        },
      ]}
    >
      {children}
    </TamboProvider>
  );
}

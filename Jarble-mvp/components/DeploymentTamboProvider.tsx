"use client";

/**
 * DeploymentTamboProvider — wraps TamboProvider with deployment-scoped tools,
 * all registered components, Auth0 token, and agent context.
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
const AGENT_INSTRUCTIONS = `You are Jarble, the orchestration layer between the user and their deployed bot.

YOUR ROLE:
You sit between the user and their OpenClaw bot. ALL user messages flow through you.
- If the message is conversational (chatting, testing, asking the bot questions), forward it to the bot using "chatWithBot" and present the bot's response.
- If the message is about management (status, platforms, config, skills, logs, lifecycle), handle it with the appropriate management tools.
- You are a transparent middleman — the user should feel like they're talking to their bot, with you handling the infrastructure behind the scenes.

RULES:
1. DEFAULT TO chatWithBot. If you're unsure whether something is management or conversation, forward it to the bot.
2. Present bot responses naturally — don't prefix with "Your bot said:". Just show the response as if the bot is talking.
3. If chatWithBot returns uiBlocks, render each block as the matching Canvas component (CanvasCard, CanvasDataTable, CanvasStatGrid, etc.).
4. For management tasks, use tools directly: getDeploymentInfo → StatusCard, getPlatformCredentials → PlatformSetup, listSkills → SkillsPanel, getDeploymentLogs → LogViewer.
5. For destructive actions (restart, stop, delete), always render ConfirmAction first.
6. When the user explicitly asks to manage/configure/check status/connect platforms, switch to management tools.
7. When the user says things like "hello", "tell me a joke", "what can you do" — that's for the bot, use chatWithBot.
8. If the bot says it can't render rich UI (tables, charts, etc.), YOU render it instead using the registered Canvas components. You have: CanvasDataTable (columns + rows), CanvasStatGrid (stat cards), CanvasKeyValue (key-value pairs), CanvasCard (text card), CanvasCodeBlock (code), CanvasAlert (notifications), CanvasProgress (progress bars), CanvasImage (images).
9. When the user asks for structured data (tables, stats, lists), and the bot provides the data as text/JSON/markdown, convert it to the appropriate Canvas component yourself.`;

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

  // Deployment-scoped tools — memoized to avoid re-registration on every render
  const tools = useMemo(
    () => createTamboTools(deploymentId),
    [deploymentId]
  );

  // Context helpers give the agent deployment context on every message
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
              text: `Hi! I'm your deployment assistant for **${deploymentName}**. I can help you manage your bot — check status, configure platforms, update settings, view logs, or chat with your bot directly. What would you like to do?`,
            },
          ],
        },
      ]}
    >
      {children}
    </TamboProvider>
  );
}

/**
 * Tambo component + tool registration.
 *
 * Exports:
 *   tamboComponents — array of TamboComponent for the TamboProvider
 *   createTamboTools — factory returning deployment-scoped tools
 */
import { z } from "zod";
import type { TamboComponent } from "@tambo-ai/react";
import StatusCard from "@/components/tambo/StatusCard";
import SystemPromptEditor from "@/components/tambo/SystemPromptEditor";
import LLMConfigCard from "@/components/tambo/LLMConfigCard";
import PlatformSetup from "@/components/tambo/PlatformSetup";
import SkillsPanel from "@/components/tambo/SkillsPanel";
import LogViewer from "@/components/tambo/LogViewer";
import ConfirmAction from "@/components/tambo/ConfirmAction";

export { createTamboTools } from "./tambo-tools";

export const tamboComponents: TamboComponent[] = [
  {
    name: "StatusCard",
    description:
      "Shows deployment overview: name, status, runtime, LLM config, connected platforms, and storage. Render when user asks about status, info, or overview of their bot.",
    component: StatusCard,
    propsSchema: z.object({
      name: z.string().describe("Deployment name"),
      status: z.string().describe("Current status: running, stopped, creating, failed, pending"),
      runtime: z.string().describe("Runtime slug, e.g. openclaw"),
      llmProvider: z.string().describe("LLM provider name"),
      llmModel: z.string().describe("LLM model name"),
      platforms: z.array(z.string()).describe("List of connected platform names"),
      storageUsedGb: z.number().optional().describe("Storage used in GB"),
      storageAllocatedGb: z.number().optional().describe("Storage allocated in GB"),
    }),
  },
  {
    name: "SystemPromptEditor",
    description:
      "Textarea editor for the bot's system prompt. Render when user wants to edit, change, or set the system prompt. Pre-fill suggestedPrompt if user described what they want.",
    component: SystemPromptEditor,
    propsSchema: z.object({
      deploymentId: z.string().describe("The deployment ID"),
      currentPrompt: z.string().describe("The current system prompt from the deployment"),
      suggestedPrompt: z
        .string()
        .optional()
        .describe("AI-suggested prompt based on user's description"),
    }),
  },
  {
    name: "LLMConfigCard",
    description:
      "LLM configuration panel: provider selector, model dropdown, API key input. Render when user wants to change LLM provider, model, or API key.",
    component: LLMConfigCard,
    propsSchema: z.object({
      deploymentId: z.string().describe("The deployment ID"),
      currentProvider: z.string().describe("Current LLM provider"),
      currentModel: z.string().describe("Current LLM model"),
      suggestedProvider: z
        .string()
        .optional()
        .describe("Suggested provider if user asked to switch"),
      suggestedModel: z
        .string()
        .optional()
        .describe("Suggested model if user asked to switch"),
    }),
  },
  {
    name: "PlatformSetup",
    description:
      "Connect or disconnect a messaging platform (Telegram, Discord, Slack, WhatsApp). Render when user wants to connect or manage a platform.",
    component: PlatformSetup,
    propsSchema: z.object({
      deploymentId: z.string().describe("The deployment ID"),
      platform: z
        .enum(["telegram", "discord", "slack", "whatsapp"])
        .describe("Which platform to set up"),
      isConnected: z.boolean().describe("Whether this platform is already connected"),
      maskedCredentials: z
        .object({
          botToken: z.string().optional(),
          appToken: z.string().optional(),
        })
        .optional()
        .describe("Masked credential values for display"),
    }),
  },
  {
    name: "SkillsPanel",
    description:
      "Grid of available skills with toggle switches. Render when user asks about skills, wants to add or remove capabilities.",
    component: SkillsPanel,
    propsSchema: z.object({
      deploymentId: z.string().describe("The deployment ID"),
      availableSkills: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          installed: z.boolean(),
        })
      ).describe("List of skills with install status"),
    }),
  },
  {
    name: "LogViewer",
    description:
      "Terminal-style log viewer with live streaming. Render when user asks to see logs or debug output.",
    component: LogViewer,
    propsSchema: z.object({
      deploymentId: z.string().describe("The deployment ID"),
      initialLogs: z
        .string()
        .optional()
        .describe("Initial log text to display before live stream connects"),
    }),
  },
  {
    name: "ConfirmAction",
    description:
      "Confirmation card for lifecycle actions: restart, stop, start, delete. Always render this before executing destructive or lifecycle actions.",
    component: ConfirmAction,
    propsSchema: z.object({
      action: z
        .enum(["restart", "stop", "delete", "start"])
        .describe("The action to confirm"),
      deploymentName: z.string().describe("Name of the deployment"),
      deploymentId: z.string().describe("The deployment ID"),
    }),
  },
];

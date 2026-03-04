/**
 * Tambo component + tool registration.
 *
 * Exports:
 *   tamboComponents — infrastructure + all canvas components for TamboProvider
 *   createTamboTools — factory returning deployment-scoped infrastructure tools
 */
import { z } from "zod";
import type { TamboComponent } from "@tambo-ai/react";

// ── Infrastructure Components ────────────────────────────────────────────────

import LogViewer from "@/components/tambo/LogViewer";
import ConfirmAction from "@/components/tambo/ConfirmAction";

export { createTamboTools } from "./tambo-tools";

import { tamboCanvasComponents } from "./tambo-canvas-registry";

/** Infrastructure components for the config sidebar agent */
const tamboInfraComponents: TamboComponent[] = [
  {
    name: "LogViewer",
    description:
      "Terminal-style log viewer with live streaming. Render when user asks to see pod logs or debug why the bot is down.",
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

/** All Tambo components: infrastructure + all 40 canvas components.
 *  Canvas components are registered so the config sidebar agent can render
 *  charts, tables, stat_grids etc. directly without the BotCanvas wrapper. */
export const tamboComponents: TamboComponent[] = [
  ...tamboInfraComponents,
  ...tamboCanvasComponents,
];

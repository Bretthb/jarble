/**
 * Tambo component + tool registration.
 *
 * Exports:
 *   tamboComponents — array of TamboComponent for the TamboProvider
 *   createTamboTools — factory returning deployment-scoped infrastructure tools
 */
import { z } from "zod";
import type { TamboComponent } from "@tambo-ai/react";

// ── Infrastructure Components ────────────────────────────────────────────────

import LogViewer from "@/components/tambo/LogViewer";
import ConfirmAction from "@/components/tambo/ConfirmAction";

// ── Bot Canvas Wrapper (renders UI blocks from MCP render_ui tool) ──────────

import BotCanvas from "@/components/tambo/BotCanvas";

export { createTamboTools } from "./tambo-tools";

export const tamboComponents: TamboComponent[] = [
  // ── Infrastructure Components (2) — for when the bot can't help itself ─

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

  // ── Bot Canvas Wrapper — editable bot-rendered blocks ──────────────────

  {
    name: "BotCanvas",
    description:
      "Wrapper for bot-rendered UI blocks with editing support. Used by MCP render_ui tool.",
    component: BotCanvas,
    propsSchema: z.object({
      blockId: z.string(),
      component: z.string(),
      propsJson: z.string().describe("JSON-serialized component props"),
      editable: z.boolean().optional(),
      fileId: z.string().optional(),
      saveMethod: z.enum(["mcp", "chat"]).optional(),
      deploymentId: z.string(),
    }),
  },

  // Canvas primitives (DataTable, StatGrid, Card, etc.) are intentionally NOT
  // registered here. Bot data is rendered via MCP render_ui tool or as markdown
  // in the text response.
];

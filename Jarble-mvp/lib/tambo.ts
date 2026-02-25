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

// ── Streaming Bot Message (SSE-based real-time response) ────────────────────

import StreamingBotMessage from "@/components/tambo/StreamingBotMessage";

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
      "ALWAYS render this component when the chat_with_bot tool returns uiBlocks in its data. Render ONE BotCanvas per uiBlock. This renders rich visual components (charts, tables, cards, stat grids, timelines, etc.) that the bot created. Extract blockId, component, and props from each uiBlock entry and pass them as shown in the schema.",
    component: BotCanvas,
    propsSchema: z.object({
      blockId: z.string().describe("The block ID from uiBlocks[].blockId"),
      component: z.string().describe("The component name from uiBlocks[].component (e.g. 'card', 'stat_grid', 'chart')"),
      propsJson: z.string().describe("JSON.stringify(uiBlocks[].props) — the component props as a JSON string"),
      editable: z.boolean().optional().describe("uiBlocks[].editable — defaults to true"),
      fileId: z.string().optional().describe("uiBlocks[].fileId — for file-backed editable components"),
      saveMethod: z.enum(["mcp", "chat"]).optional().describe("uiBlocks[].saveMethod — how edits are saved"),
      deploymentId: z.string().describe("The deployment ID from context"),
    }),
  },

  // ── Streaming Bot Message — real-time SSE response from bot ─────────────

  {
    name: "StreamingBotMessage",
    description:
      "ALWAYS render this when forwarding a user message to the bot. Pass the user's exact message text and the deploymentId from context. This streams the bot's response in real-time with text animation and renders rich UI blocks (charts, tables, cards) as they arrive.",
    component: StreamingBotMessage,
    propsSchema: z.object({
      message: z.string().describe("The user's message to forward to the bot"),
      deploymentId: z
        .string()
        .optional()
        .describe("Optional — automatically resolved from context"),
    }),
  },

  // Canvas primitives (DataTable, StatGrid, Card, etc.) are intentionally NOT
  // registered here. Bot data is rendered via MCP render_ui tool or as markdown
  // in the text response.
];

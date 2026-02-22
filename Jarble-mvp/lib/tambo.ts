/**
 * Tambo component + tool registration.
 *
 * Exports:
 *   tamboComponents — array of TamboComponent for the TamboProvider
 *   createTamboTools — factory returning deployment-scoped tools
 */
import { z } from "zod";
import type { TamboComponent } from "@tambo-ai/react";

/** Preprocess helper: if a value is a JSON string, try to parse it into an array */
function coerceArray(val: unknown): unknown {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { /* not JSON */ }
  }
  return val;
}

// ── Infrastructure Components ────────────────────────────────────────────────

import LogViewer from "@/components/tambo/LogViewer";
import ConfirmAction from "@/components/tambo/ConfirmAction";

// ── Canvas Primitives (bot data rendering) ──────────────────────────────────

import CanvasCard from "@/components/canvas/components/CanvasCard";
import CanvasDataTable from "@/components/canvas/components/CanvasDataTable";
import CanvasStatGrid from "@/components/canvas/components/CanvasStatGrid";
import CanvasKeyValue from "@/components/canvas/components/CanvasKeyValue";
import CanvasCodeBlock from "@/components/canvas/components/CanvasCodeBlock";
import CanvasAlert from "@/components/canvas/components/CanvasAlert";
import CanvasProgress from "@/components/canvas/components/CanvasProgress";
import CanvasImage from "@/components/canvas/components/CanvasImage";

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

  // ── Canvas Primitives (8) — bot data rendered by Tambo's LLM ──────────

  {
    name: "DataTable",
    description:
      "Renders tabular data with columns and rows. Use when bot returns data with column headers and row values, database query results, lists of items with multiple fields, or any grid-like data.",
    component: CanvasDataTable,
    propsSchema: z.object({
      title: z.string().optional().describe("Table title or heading"),
      columns: z.preprocess(coerceArray, z.array(z.string())).describe("Column header names"),
      rows: z.preprocess(coerceArray, z.array(z.array(z.union([z.string(), z.number()])))).describe("Row data — each row is an array of cell values matching column order"),
    }),
  },
  {
    name: "StatGrid",
    description:
      "Grid of metric cards with labels, values, and optional change indicators. Use for KPIs, dashboard summaries, numeric overviews, or any set of labeled statistics.",
    component: CanvasStatGrid,
    propsSchema: z.object({
      stats: z.preprocess(coerceArray, z.array(z.object({
        label: z.string().describe("Metric name, e.g. 'Revenue', 'Users'"),
        value: z.union([z.string(), z.number()]).describe("Metric value, e.g. '$12,500' or 156"),
        change: z.string().optional().describe("Change indicator, e.g. '+12%', '-3%'"),
        icon: z.string().optional().describe("Emoji or icon hint"),
      }))).describe("Array of stat metrics to display in a grid"),
    }),
  },
  {
    name: "Card",
    description:
      "Simple content card with optional title, subtitle, and body text. Use for summaries, explanations, single-topic info blocks, or any content that fits a card format.",
    component: CanvasCard,
    propsSchema: z.object({
      title: z.string().optional().describe("Card heading"),
      subtitle: z.string().optional().describe("Secondary heading or tagline"),
      body: z.string().optional().describe("Main text content of the card"),
    }),
  },
  {
    name: "KeyValue",
    description:
      "Key-value pair list with optional title. Use for settings, configuration details, properties, metadata, or any labeled data pairs.",
    component: CanvasKeyValue,
    propsSchema: z.object({
      title: z.string().optional().describe("Section title"),
      items: z.preprocess(coerceArray, z.array(z.object({
        key: z.string().describe("Property name or label"),
        value: z.union([z.string(), z.number()]).describe("Property value"),
      }))).describe("Array of key-value pairs"),
    }),
  },
  {
    name: "CodeBlock",
    description:
      "Syntax-highlighted code block with optional language tag and title. Use for code snippets, configuration files, JSON data, or any preformatted text.",
    component: CanvasCodeBlock,
    propsSchema: z.object({
      code: z.string().describe("The code or preformatted text content"),
      language: z.string().optional().describe("Programming language for syntax highlighting, e.g. 'json', 'python', 'javascript'"),
      title: z.string().optional().describe("Title or filename label above the code block"),
    }),
  },
  {
    name: "Alert",
    description:
      "Styled alert banner for messages with a severity level. Use for warnings, errors, success confirmations, or informational notices.",
    component: CanvasAlert,
    propsSchema: z.object({
      title: z.string().optional().describe("Alert heading"),
      message: z.string().describe("Alert body text"),
      variant: z.enum(["info", "success", "warning", "error"]).describe("Severity: info (blue), success (green), warning (yellow), error (red)"),
    }),
  },
  {
    name: "Progress",
    description:
      "Progress bar showing completion percentage (0-100). Use for task progress, loading indicators, usage meters, or any percentage-based metric.",
    component: CanvasProgress,
    propsSchema: z.object({
      label: z.string().optional().describe("Label above the progress bar"),
      value: z.number().min(0).max(100).describe("Completion percentage (0-100)"),
      variant: z.enum(["default", "success", "warning", "error"]).optional().describe("Color variant based on status"),
    }),
  },
  {
    name: "Image",
    description:
      "Displays an image with optional alt text and caption. Use when bot returns an image URL, chart, screenshot, or any visual content.",
    component: CanvasImage,
    propsSchema: z.object({
      src: z.string().url().describe("Image URL"),
      alt: z.string().optional().describe("Alt text for accessibility"),
      caption: z.string().optional().describe("Caption displayed below the image"),
    }),
  },
];

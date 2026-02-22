/**
 * Canvas Component Registry
 *
 * Maps component names to React components with Zod prop schemas.
 * Used by CanvasRenderer to safely validate and render bot UI blocks.
 */

import { z, type ZodType } from "zod";
import type { ComponentType } from "react";

import CanvasCard from "./components/CanvasCard";
import CanvasDataTable from "./components/CanvasDataTable";
import CanvasStatGrid from "./components/CanvasStatGrid";
import CanvasKeyValue from "./components/CanvasKeyValue";
import CanvasCodeBlock from "./components/CanvasCodeBlock";
import CanvasAlert from "./components/CanvasAlert";
import CanvasProgress from "./components/CanvasProgress";
import CanvasImage from "./components/CanvasImage";
import CanvasLayout from "./components/CanvasLayout";

// ── Schemas ──────────────────────────────────────────────────────────────────

export const cardSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  body: z.string().optional(),
});

export const dataTableSchema = z.object({
  title: z.string().optional(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number()]))),
});

export const statGridSchema = z.object({
  stats: z.array(
    z.object({
      label: z.string(),
      value: z.union([z.string(), z.number()]),
      change: z.string().optional(),
      icon: z.string().optional(),
    })
  ),
});

export const keyValueSchema = z.object({
  title: z.string().optional(),
  items: z.array(
    z.object({
      key: z.string(),
      value: z.union([z.string(), z.number()]),
    })
  ),
});

export const codeBlockSchema = z.object({
  code: z.string(),
  language: z.string().optional(),
  title: z.string().optional(),
});

export const alertSchema = z.object({
  title: z.string().optional(),
  message: z.string(),
  variant: z.enum(["info", "success", "warning", "error"]),
});

export const progressSchema = z.object({
  label: z.string().optional(),
  value: z.number().min(0).max(100),
  variant: z.enum(["default", "success", "warning", "error"]).optional(),
});

export const imageSchema = z.object({
  src: z.string().url(),
  alt: z.string().optional(),
  caption: z.string().optional(),
});

export const layoutSchema = z.object({
  title: z.string().optional(),
  children: z.array(
    z.object({
      component: z.string(),
      props: z.record(z.string(), z.unknown()),
    })
  ),
});

// ── Registry ─────────────────────────────────────────────────────────────────

export interface CanvasComponentEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>;
  propsSchema: ZodType;
}

export const CANVAS_COMPONENTS: Record<string, CanvasComponentEntry> = {
  card: { component: CanvasCard, propsSchema: cardSchema },
  data_table: { component: CanvasDataTable, propsSchema: dataTableSchema },
  stat_grid: { component: CanvasStatGrid, propsSchema: statGridSchema },
  key_value: { component: CanvasKeyValue, propsSchema: keyValueSchema },
  code_block: { component: CanvasCodeBlock, propsSchema: codeBlockSchema },
  alert: { component: CanvasAlert, propsSchema: alertSchema },
  progress: { component: CanvasProgress, propsSchema: progressSchema },
  image: { component: CanvasImage, propsSchema: imageSchema },
  layout: { component: CanvasLayout, propsSchema: layoutSchema },
};

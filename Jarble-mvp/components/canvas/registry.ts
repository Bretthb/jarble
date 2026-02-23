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
import CanvasChart from "./components/CanvasChart";
import CanvasTabs from "./components/CanvasTabs";
import CanvasAccordion from "./components/CanvasAccordion";
import CanvasBadge from "./components/CanvasBadge";
import CanvasList from "./components/CanvasList";
import CanvasTimeline from "./components/CanvasTimeline";
import CanvasDivider from "./components/CanvasDivider";
import CanvasAvatar from "./components/CanvasAvatar";
import CanvasBlockquote from "./components/CanvasBlockquote";
import CanvasMetricCard from "./components/CanvasMetricCard";
import CanvasHeader from "./components/CanvasHeader";
import CanvasButtonGroup from "./components/CanvasButtonGroup";
import CanvasForm from "./components/CanvasForm";

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
      component: z.string().describe("Canvas component name (card, data_table, stat_grid, etc.)"),
      propsJson: z.string().optional().describe("JSON-stringified props for the child component"),
      props: z.record(z.string(), z.unknown()).optional().describe("Props object (alternative to propsJson)"),
    })
  ),
});

export const chartSchema = z.object({
  type: z.enum(["bar", "line", "pie", "area"]),
  title: z.string().optional(),
  data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
  dataKeys: z.array(z.string()),
  xAxisKey: z.string().optional(),
  colors: z.array(z.string()).optional(),
  stacked: z.boolean().optional(),
  showLegend: z.boolean().optional(),
  showGrid: z.boolean().optional(),
  height: z.number().optional(),
});

const childSchema = z.object({
  component: z.string(),
  propsJson: z.string().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
});

export const tabsSchema = z.object({
  tabs: z.array(z.object({
    label: z.string(),
    content: z.string().optional(),
    children: z.array(childSchema).optional(),
  })),
  defaultTab: z.number().optional(),
});

export const accordionSchema = z.object({
  items: z.array(z.object({
    title: z.string(),
    content: z.string().optional(),
    children: z.array(childSchema).optional(),
    defaultOpen: z.boolean().optional(),
  })),
  type: z.enum(["single", "multiple"]).optional(),
});

export const badgeSchema = z.object({
  text: z.string(),
  variant: z.enum(["default", "secondary", "destructive", "outline", "success", "warning", "info"]).optional(),
  icon: z.string().optional(),
});

export const listSchema = z.object({
  title: z.string().optional(),
  items: z.array(z.object({
    text: z.string(),
    description: z.string().optional(),
    icon: z.string().optional(),
    badge: z.string().optional(),
    badgeVariant: z.string().optional(),
  })),
  ordered: z.boolean().optional(),
});

export const timelineSchema = z.object({
  title: z.string().optional(),
  events: z.array(z.object({
    label: z.string(),
    description: z.string().optional(),
    timestamp: z.string().optional(),
    icon: z.string().optional(),
    status: z.enum(["completed", "active", "pending"]).optional(),
  })),
});

export const dividerSchema = z.object({
  label: z.string().optional(),
  variant: z.enum(["solid", "dashed", "dotted"]).optional(),
  spacing: z.enum(["sm", "md", "lg"]).optional(),
});

export const avatarSchema = z.object({
  name: z.string(),
  src: z.string().optional(),
  subtitle: z.string().optional(),
  size: z.enum(["sm", "md", "lg"]).optional(),
});

export const blockquoteSchema = z.object({
  text: z.string(),
  attribution: z.string().optional(),
  variant: z.enum(["default", "info", "warning"]).optional(),
});

export const metricCardSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  change: z.string().optional(),
  changeLabel: z.string().optional(),
  icon: z.string().optional(),
  sparkline: z.array(z.number()).optional(),
});

export const headerSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  divider: z.boolean().optional(),
});

export const buttonGroupSchema = z.object({
  buttons: z.array(z.object({
    id: z.string(),
    label: z.string(),
    variant: z.enum(["default", "secondary", "destructive", "outline"]).optional(),
    icon: z.string().optional(),
    disabled: z.boolean().optional(),
  })),
});

export const formSchema = z.object({
  title: z.string().optional(),
  fields: z.array(z.object({
    name: z.string(),
    label: z.string(),
    type: z.enum(["text", "email", "textarea", "select", "checkbox", "number"]),
    placeholder: z.string().optional(),
    required: z.boolean().optional(),
    options: z.array(z.string()).optional(),
    defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })),
  submitLabel: z.string().optional(),
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
  chart: { component: CanvasChart, propsSchema: chartSchema },
  tabs: { component: CanvasTabs, propsSchema: tabsSchema },
  accordion: { component: CanvasAccordion, propsSchema: accordionSchema },
  badge: { component: CanvasBadge, propsSchema: badgeSchema },
  list: { component: CanvasList, propsSchema: listSchema },
  timeline: { component: CanvasTimeline, propsSchema: timelineSchema },
  divider: { component: CanvasDivider, propsSchema: dividerSchema },
  avatar: { component: CanvasAvatar, propsSchema: avatarSchema },
  blockquote: { component: CanvasBlockquote, propsSchema: blockquoteSchema },
  metric_card: { component: CanvasMetricCard, propsSchema: metricCardSchema },
  header: { component: CanvasHeader, propsSchema: headerSchema },
  button_group: { component: CanvasButtonGroup, propsSchema: buttonGroupSchema },
  form: { component: CanvasForm, propsSchema: formSchema },
};

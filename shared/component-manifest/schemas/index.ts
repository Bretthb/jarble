/**
 * Component Prop Schemas (Zod)
 *
 * Single source of truth for all canvas component prop validation schemas.
 * Previously defined in Jarble-mvp/components/canvas/registry.ts.
 *
 * These schemas are used by:
 * - CanvasRenderer (frontend) for prop validation before render
 * - Future: API-side validation of render_ui payloads
 */

import { z, type ZodType } from "zod";

// ── Display Components ────────────────────────────────────────────────────────

export const cardSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  body: z.string().optional(),
  content: z.string().optional(),
  icon: z.string().optional(),
  status: z.enum(["info", "success", "warning", "error"]).optional(),
  live: z.boolean().optional(),
  lastUpdated: z.string().optional(),
});

export const dataTableSchema = z.object({
  title: z.string().optional(),
  columns: z.array(z.string()),
  // Accept boolean and null in addition to string/number — LLMs frequently emit these in table cells
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
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
  live: z.boolean().optional(),
  lastUpdated: z.string().optional(),
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
  // Accept any string — z.string().url() would reject relative paths (/assets/...) and data: URIs
  src: z.string(),
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
  columns: z.number().min(1).max(4).optional().describe("Grid columns (1-4). Auto-detects if omitted."),
  direction: z.enum(["grid", "vertical", "horizontal"]).optional().describe("Layout mode: grid (default), vertical stack, or horizontal row."),
  gap: z.number().optional().describe("Gap between children in px. Default: 12."),
});

export const metricCardSchema = z.object({
  label: z.string().optional(),
  title: z.string().optional(),  // Alias for label (bots often use title)
  value: z.union([z.string(), z.number()]),
  change: z.string().optional(),
  changeLabel: z.string().optional(),
  subtitle: z.string().optional(),  // Alias for changeLabel
  trend: z.enum(["up", "down", "neutral"]).optional(),
  icon: z.string().optional(),
  sparkline: z.array(z.number()).optional(),
  live: z.boolean().optional(),
  lastUpdated: z.string().optional(),
});

export const headerSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  divider: z.boolean().optional(),
});

export const badgeSchema = z.object({
  text: z.string(),
  variant: z.enum(["default", "secondary", "destructive", "outline", "success", "positive", "warning", "info"]).optional(),
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
  // Accept "items" as alias for "events" (LLMs often use "items")
  events: z.array(z.object({
    // Accept "title" as alias for "label" (LLMs often use "title")
    label: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    timestamp: z.string().optional(),
    // Accept "date" as alias for "timestamp"
    date: z.string().optional(),
    icon: z.string().optional(),
    status: z.enum(["completed", "active", "pending"]).optional(),
    color: z.string().optional(),
  }).transform((e) => ({
    ...e,
    label: e.label || e.title || "Untitled",
    timestamp: e.timestamp || e.date,
  }))).optional(),
  items: z.array(z.object({
    label: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    timestamp: z.string().optional(),
    date: z.string().optional(),
    icon: z.string().optional(),
    status: z.enum(["completed", "active", "pending"]).optional(),
    color: z.string().optional(),
  }).transform((e) => ({
    ...e,
    label: e.label || e.title || "Untitled",
    timestamp: e.timestamp || e.date,
  }))).optional(),
}).transform((data) => ({
  ...data,
  events: data.events || data.items || [],
}));

export const dividerSchema = z.object({
  label: z.string().optional(),
  variant: z.enum(["solid", "dashed", "dotted"]).optional(),
  spacing: z.enum(["sm", "md", "lg"]).optional(),
});

// ── Chart ─────────────────────────────────────────────────────────────────────

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

// ── Interactive Components ────────────────────────────────────────────────────

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

// ── Media Components ──────────────────────────────────────────────────────────

export const videoSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  controls: z.boolean().optional(),
  loop: z.boolean().optional(),
  muted: z.boolean().optional(),
});

export const audioSchema = z.object({
  src: z.string().optional(),
  url: z.string().optional(), // alias for src
  title: z.string().optional(),
  autoplay: z.boolean().optional(),
}).transform((d) => ({ src: d.src || d.url || "", title: d.title, autoplay: d.autoplay }));

export const imageGallerySchema = z.object({
  images: z.array(z.object({
    src: z.string(),
    alt: z.string().optional(),
    caption: z.string().optional(),
  })),
  title: z.string().optional(),
  columns: z.number().optional(),
});

export const avatarSchema = z.object({
  name: z.string(),
  src: z.string().optional(),
  image: z.string().optional(), // alias for src
  subtitle: z.string().optional(),
  description: z.string().optional(), // alias for subtitle
  size: z.enum(["sm", "md", "lg"]).optional(),
}).transform((d) => ({ ...d, src: d.src || d.image, subtitle: d.subtitle || d.description }));

export const blockquoteSchema = z.object({
  text: z.string().optional(),
  quote: z.string().optional(), // alias for text
  attribution: z.string().optional(),
  author: z.string().optional(), // alias for attribution
  variant: z.enum(["default", "info", "warning"]).optional(),
}).transform((d) => ({ ...d, text: d.text || d.quote || "", attribution: d.attribution || d.author }));

export const textMessageSchema = z.object({
  botText: z.string(),
  userText: z.string().optional(),
});

export const carouselSchema = z.object({
  items: z.array(z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    image: z.string().optional(),
  })),
  autoplay: z.boolean().optional(),
});

// ── Specialized Components ────────────────────────────────────────────────────

export const codeEditorSchema = z.object({
  code: z.string(),
  language: z.string().optional(),
  title: z.string().optional(),
  readOnly: z.boolean().optional(),
  height: z.number().optional(),
});

export const spreadsheetSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())).optional(),
  title: z.string().optional(),
  height: z.number().optional(),
});

export const sandboxSchema = z.object({
  html: z.string(),
  css: z.string().optional(),
  js: z.string().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  height: z.number().optional(),
  title: z.string().optional(),
  libraries: z.array(z.string()).optional(),
});

export const mapSchema = z.object({
  center: z.tuple([z.number(), z.number()]).optional(),
  location: z.tuple([z.number(), z.number()]).optional(), // alias for center
  position: z.tuple([z.number(), z.number()]).optional(), // alias for center
  zoom: z.number().optional(),
  markers: z.array(z.object({
    lat: z.number(),
    lng: z.number(),
    label: z.string().optional(),
  })).optional(),
  title: z.string().optional(),
  height: z.number().optional(),
}).transform((d) => ({ ...d, center: d.center || d.location || d.position || [0, 0] as [number, number] }));

// ── Ant Design Components ─────────────────────────────────────────────────────

export const descriptionsSchema = z.object({
  title: z.string().optional(),
  items: z.array(z.object({
    label: z.string(),
    value: z.union([z.string(), z.number()]),
    span: z.number().optional(),
  })),
  columns: z.number().optional(),
  bordered: z.boolean().optional(),
});

export const stepsSchema = z.object({
  current: z.number(),
  items: z.array(z.object({
    title: z.string(),
    description: z.string().optional(),
    content: z.string().optional(),
    icon: z.string().optional(),
  }).transform((d) => ({ ...d, description: d.description || d.content }))),
  direction: z.enum(["vertical", "horizontal"]).optional(),
  orientation: z.enum(["vertical", "horizontal"]).optional(),
}).transform((d) => ({ ...d, direction: d.direction || d.orientation || "horizontal" }));

export const resultSchema = z.object({
  status: z.enum(["success", "error", "info", "warning"]),
  title: z.string(),
  subtitle: z.string().optional(),
});

export const statisticSchema = z.object({
  value: z.union([z.string(), z.number()]),
  title: z.string().optional(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  precision: z.number().optional(),
  isCountdown: z.boolean().optional(),
  countdownTarget: z.string().optional(),
});

export const tagCloudSchema = z.object({
  tags: z.array(z.object({
    text: z.string(),
    color: z.string().optional(),
    size: z.enum(["small", "medium", "large"]).optional(),
  })),
  title: z.string().optional(),
});

// Tree nodes — 3 levels deep (avoids z.lazy recursion issues)
const treeLeaf = z.object({ title: z.string(), key: z.string() });
const treeL2 = z.object({ title: z.string(), key: z.string(), children: z.array(treeLeaf).optional() });
const treeL1 = z.object({ title: z.string(), key: z.string(), children: z.array(treeL2).optional() });

export const treeSchema = z.object({
  data: z.array(treeL1),
  title: z.string().optional(),
  defaultExpandAll: z.boolean().optional(),
});

// ── Schema Record ─────────────────────────────────────────────────────────────

/**
 * All component schemas keyed by component name.
 * Used by CanvasRenderer for prop validation.
 */
export const COMPONENT_SCHEMAS: Record<string, ZodType> = {
  card: cardSchema,
  data_table: dataTableSchema,
  stat_grid: statGridSchema,
  key_value: keyValueSchema,
  code_block: codeBlockSchema,
  alert: alertSchema,
  progress: progressSchema,
  image: imageSchema,
  layout: layoutSchema,
  chart: chartSchema,
  tabs: tabsSchema,
  accordion: accordionSchema,
  badge: badgeSchema,
  list: listSchema,
  timeline: timelineSchema,
  divider: dividerSchema,
  metric_card: metricCardSchema,
  header: headerSchema,
  button_group: buttonGroupSchema,
  form: formSchema,
  code_editor: codeEditorSchema,
  spreadsheet: spreadsheetSchema,
  sandbox: sandboxSchema,
  video: videoSchema,
  canvas: sandboxSchema, // alias: LLMs often say "canvas" when they mean "sandbox"
  audio: audioSchema,
  avatar: avatarSchema,
  blockquote: blockquoteSchema,
  text_message: textMessageSchema,
  image_gallery: imageGallerySchema,
  map: mapSchema,
  descriptions: descriptionsSchema,
  steps: stepsSchema,
  result: resultSchema,
  carousel: carouselSchema,
  statistic: statisticSchema,
  tag_cloud: tagCloudSchema,
  tree: treeSchema,
};

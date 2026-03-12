/**
 * Canvas Component Registry
 *
 * Maps component names to React components with Zod prop schemas.
 * Used by CanvasRenderer to safely validate and render bot UI blocks.
 *
 * Zod schemas are imported from @jarble/component-manifest (shared package).
 * This file only handles the React component mapping.
 */

import type { ZodType } from "zod";
import type { ComponentType } from "react";
import dynamic from "next/dynamic";

// ── Schemas from shared manifest ──────────────────────────────────────────────

import {
  cardSchema,
  dataTableSchema,
  statGridSchema,
  keyValueSchema,
  codeBlockSchema,
  alertSchema,
  progressSchema,
  imageSchema,
  layoutSchema,
  chartSchema,
  tabsSchema,
  accordionSchema,
  badgeSchema,
  listSchema,
  timelineSchema,
  dividerSchema,
  metricCardSchema,
  headerSchema,
  buttonGroupSchema,
  formSchema,
  codeEditorSchema,
  spreadsheetSchema,
  sandboxSchema,
  marketplaceSandboxSchema,
  sandpackSandboxSchema,
  videoSchema,
  embedSchema,
  audioSchema,
  avatarSchema,
  blockquoteSchema,
  textMessageSchema,
  imageGallerySchema,
  mapSchema,
  descriptionsSchema,
  stepsSchema,
  resultSchema,
  carouselSchema,
  statisticSchema,
  tagCloudSchema,
  treeSchema,
  reasoningSchema,
  toolSchema,
  sourcesSchema,
} from "@jarble/component-manifest";

// Re-export schemas for consumers that import them directly from registry.ts
export {
  cardSchema,
  dataTableSchema,
  statGridSchema,
  keyValueSchema,
  codeBlockSchema,
  alertSchema,
  progressSchema,
  imageSchema,
  layoutSchema,
  chartSchema,
  tabsSchema,
  accordionSchema,
  badgeSchema,
  listSchema,
  timelineSchema,
  dividerSchema,
  metricCardSchema,
  headerSchema,
  buttonGroupSchema,
  formSchema,
  codeEditorSchema,
  spreadsheetSchema,
  sandboxSchema,
  marketplaceSandboxSchema,
  sandpackSandboxSchema,
  videoSchema,
  embedSchema,
  audioSchema,
  avatarSchema,
  blockquoteSchema,
  textMessageSchema,
  imageGallerySchema,
  mapSchema,
  descriptionsSchema,
  stepsSchema,
  resultSchema,
  carouselSchema,
  statisticSchema,
  tagCloudSchema,
  treeSchema,
  reasoningSchema,
  toolSchema,
  sourcesSchema,
};

// ── Lightweight components — static imports ──────────────────────────────────

import CanvasCard from "./components/CanvasCard";
import CanvasDataTable from "./components/CanvasDataTable";
import CanvasStatGrid from "./components/CanvasStatGrid";
import CanvasKeyValue from "./components/CanvasKeyValue";
import CanvasCodeBlock from "./components/CanvasCodeBlock";
import CanvasAlert from "./components/CanvasAlert";
import CanvasProgress from "./components/CanvasProgress";
import CanvasImage from "./components/CanvasImage";
import CanvasLayout from "./components/CanvasLayout";
import CanvasTabs from "./components/CanvasTabs";
import CanvasAccordion from "./components/CanvasAccordion";
import CanvasBadge from "./components/CanvasBadge";
import CanvasList from "./components/CanvasList";
import CanvasTimeline from "./components/CanvasTimeline";
import CanvasDivider from "./components/CanvasDivider";
import CanvasMetricCard from "./components/CanvasMetricCard";
import CanvasHeader from "./components/CanvasHeader";
import CanvasButtonGroup from "./components/CanvasButtonGroup";
import CanvasForm from "./components/CanvasForm";
import CanvasAudio from "./components/CanvasAudio";
import CanvasAvatar from "./components/CanvasAvatar";
import CanvasBlockquote from "./components/CanvasBlockquote";
import CanvasTextMessage from "./components/CanvasTextMessage";
import CanvasReasoning from "./components/CanvasReasoning";
import CanvasTool from "./components/CanvasTool";
import CanvasSources from "./components/CanvasSources";

// ── Heavy components — lazy-loaded (ssr: false) ─────────────────────────────

const CanvasChart = dynamic(() => import("./components/CanvasChart"), { ssr: false });
const CanvasCodeEditor = dynamic(() => import("./components/CanvasCodeEditor"), { ssr: false });
const CanvasSpreadsheet = dynamic(() => import("./components/CanvasSpreadsheet"), { ssr: false });
const CanvasSandbox = dynamic(() => import("./components/CanvasSandbox"), { ssr: false });
const MarketplaceSandbox = dynamic(() => import("./components/MarketplaceSandbox"), { ssr: false });
const CanvasSandpackSandbox = dynamic(() => import("./components/CanvasSandpackSandbox"), { ssr: false });
const CanvasVideo = dynamic(() => import("./components/CanvasVideo"), { ssr: false });
const CanvasEmbed = dynamic(() => import("./components/CanvasEmbed"), { ssr: false });
const CanvasMap = dynamic(() => import("./components/CanvasMap"), { ssr: false });
const CanvasImageGallery = dynamic(() => import("./components/CanvasImageGallery"), { ssr: false });

// ── Antd-based — lazy-loaded ────────────────────────────────────────────────

const CanvasTree = dynamic(() => import("./components/CanvasTree"), { ssr: false });
const CanvasDescriptions = dynamic(() => import("./components/CanvasDescriptions"), { ssr: false });
const CanvasSteps = dynamic(() => import("./components/CanvasSteps"), { ssr: false });
const CanvasResult = dynamic(() => import("./components/CanvasResult"), { ssr: false });
const CanvasCarousel = dynamic(() => import("./components/CanvasCarousel"), { ssr: false });
const CanvasStatistic = dynamic(() => import("./components/CanvasStatistic"), { ssr: false });
const CanvasTagCloud = dynamic(() => import("./components/CanvasTagCloud"), { ssr: false });

// ── Registry ─────────────────────────────────────────────────────────────────

export interface CanvasComponentEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>;
  propsSchema: ZodType;
}

// Log registered components — call explicitly in a useEffect if needed, not at module load time
// (module-level calls fire on every hot reload and in SSR contexts)
export const logRegistry = () => {
  if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
    const keys = Object.keys(CANVAS_COMPONENTS);
    console.log("[Jarble:Registry]", keys.length, "components registered:", keys.join(", "));
  }
};

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
  metric_card: { component: CanvasMetricCard, propsSchema: metricCardSchema },
  header: { component: CanvasHeader, propsSchema: headerSchema },
  button_group: { component: CanvasButtonGroup, propsSchema: buttonGroupSchema },
  form: { component: CanvasForm, propsSchema: formSchema },
  code_editor: { component: CanvasCodeEditor, propsSchema: codeEditorSchema },
  spreadsheet: { component: CanvasSpreadsheet, propsSchema: spreadsheetSchema },
  sandbox: { component: CanvasSandbox, propsSchema: sandboxSchema },
  marketplace_sandbox: { component: MarketplaceSandbox, propsSchema: marketplaceSandboxSchema },
  sandpack_sandbox: { component: CanvasSandpackSandbox, propsSchema: sandpackSandboxSchema },
  video: { component: CanvasVideo, propsSchema: videoSchema },
  embed: { component: CanvasEmbed, propsSchema: embedSchema },
  // Alias: LLMs often say "canvas" when they mean "sandbox"
  canvas: { component: CanvasSandbox, propsSchema: sandboxSchema },
  // ── Newly registered components ────────────────────────────────────────────
  audio: { component: CanvasAudio, propsSchema: audioSchema },
  avatar: { component: CanvasAvatar, propsSchema: avatarSchema },
  blockquote: { component: CanvasBlockquote, propsSchema: blockquoteSchema },
  text_message: { component: CanvasTextMessage, propsSchema: textMessageSchema },
  image_gallery: { component: CanvasImageGallery, propsSchema: imageGallerySchema },
  map: { component: CanvasMap, propsSchema: mapSchema },
  descriptions: { component: CanvasDescriptions, propsSchema: descriptionsSchema },
  steps: { component: CanvasSteps, propsSchema: stepsSchema },
  result: { component: CanvasResult, propsSchema: resultSchema },
  carousel: { component: CanvasCarousel, propsSchema: carouselSchema },
  statistic: { component: CanvasStatistic, propsSchema: statisticSchema },
  tag_cloud: { component: CanvasTagCloud, propsSchema: tagCloudSchema },
  tree: { component: CanvasTree, propsSchema: treeSchema },
  reasoning: { component: CanvasReasoning, propsSchema: reasoningSchema },
  tool: { component: CanvasTool, propsSchema: toolSchema },
  sources: { component: CanvasSources, propsSchema: sourcesSchema },
};

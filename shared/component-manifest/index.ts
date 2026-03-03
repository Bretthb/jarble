/**
 * @jarble/component-manifest
 *
 * Single source of truth for all Jarble canvas component metadata.
 * Consumed by:
 * - Frontend (registry.ts) for Zod schemas + component mapping
 * - API (componentResolver.ts) for builtin name validation
 * - API (listComponents.ts) for component descriptions
 * - API (openclaw.ts) for prompt generation
 * - MCP server (jarble-ui-server.js) via generated JSON
 */

// ── Component entries ─────────────────────────────────────────────────────────

import { cardEntry } from "./components/card.js";
import { dataTableEntry } from "./components/data_table.js";
import { statGridEntry } from "./components/stat_grid.js";
import { keyValueEntry } from "./components/key_value.js";
import { codeBlockEntry } from "./components/code_block.js";
import { alertEntry } from "./components/alert.js";
import { progressEntry } from "./components/progress.js";
import { imageEntry } from "./components/image.js";
import { layoutEntry } from "./components/layout.js";
import { chartEntry } from "./components/chart.js";
import { tabsEntry } from "./components/tabs.js";
import { accordionEntry } from "./components/accordion.js";
import { badgeEntry } from "./components/badge.js";
import { listEntry } from "./components/list.js";
import { timelineEntry } from "./components/timeline.js";
import { dividerEntry } from "./components/divider.js";
import { metricCardEntry } from "./components/metric_card.js";
import { headerEntry } from "./components/header.js";
import { buttonGroupEntry } from "./components/button_group.js";
import { formEntry } from "./components/form.js";
import { codeEditorEntry } from "./components/code_editor.js";
import { spreadsheetEntry } from "./components/spreadsheet.js";
import { sandboxEntry, SANDBOX_SDK_VERSION } from "./components/sandbox.js";
import { marketplaceSandboxEntry } from "./components/marketplace_sandbox.js";
import { videoEntry } from "./components/video.js";
import { audioEntry } from "./components/audio.js";
import { avatarEntry } from "./components/avatar.js";
import { blockquoteEntry } from "./components/blockquote.js";
import { textMessageEntry } from "./components/text_message.js";
import { imageGalleryEntry } from "./components/image_gallery.js";
import { mapEntry } from "./components/map.js";
import { descriptionsEntry } from "./components/descriptions.js";
import { stepsEntry } from "./components/steps.js";
import { resultEntry } from "./components/result.js";
import { carouselEntry } from "./components/carousel.js";
import { statisticEntry } from "./components/statistic.js";
import { tagCloudEntry } from "./components/tag_cloud.js";
import { treeEntry } from "./components/tree.js";
import { reasoningEntry } from "./components/reasoning.js";
import { toolEntry } from "./components/tool.js";
import { sourcesEntry } from "./components/sources.js";

import type { ComponentManifestEntry } from "./types.js";

// ── Manifest ──────────────────────────────────────────────────────────────────

/**
 * The complete component manifest — keyed by canonical component name.
 * Includes the "canvas" alias pointing to sandbox.
 */
export const COMPONENT_MANIFEST: Record<string, ComponentManifestEntry> = {
  card: cardEntry,
  data_table: dataTableEntry,
  stat_grid: statGridEntry,
  key_value: keyValueEntry,
  code_block: codeBlockEntry,
  alert: alertEntry,
  progress: progressEntry,
  image: imageEntry,
  layout: layoutEntry,
  chart: chartEntry,
  tabs: tabsEntry,
  accordion: accordionEntry,
  badge: badgeEntry,
  list: listEntry,
  timeline: timelineEntry,
  divider: dividerEntry,
  metric_card: metricCardEntry,
  header: headerEntry,
  button_group: buttonGroupEntry,
  form: formEntry,
  code_editor: codeEditorEntry,
  spreadsheet: spreadsheetEntry,
  sandbox: sandboxEntry,
  marketplace_sandbox: marketplaceSandboxEntry,
  video: videoEntry,
  // Alias: LLMs often say "canvas" when they mean "sandbox"
  canvas: { ...sandboxEntry, name: "canvas", aliases: [] },
  audio: audioEntry,
  avatar: avatarEntry,
  blockquote: blockquoteEntry,
  text_message: textMessageEntry,
  image_gallery: imageGalleryEntry,
  map: mapEntry,
  descriptions: descriptionsEntry,
  steps: stepsEntry,
  result: resultEntry,
  carousel: carouselEntry,
  statistic: statisticEntry,
  tag_cloud: tagCloudEntry,
  tree: treeEntry,
  reasoning: reasoningEntry,
  tool: toolEntry,
  sources: sourcesEntry,
};

// ── Derived exports ───────────────────────────────────────────────────────────

/** All component names (including aliases like "canvas") */
export const COMPONENT_NAMES: string[] = Object.keys(COMPONENT_MANIFEST);

/** Set for O(1) name lookups */
export const COMPONENT_NAME_SET: Set<string> = new Set(COMPONENT_NAMES);

/**
 * Default card sizes per component, derived from manifest layout.defaultSize.
 * Matches the shape previously in types.ts: { width, height }.
 */
export const DEFAULT_CARD_SIZES: Record<string, { width: number; height: number }> =
  Object.fromEntries(
    Object.entries(COMPONENT_MANIFEST).map(([name, entry]) => [
      name,
      { width: entry.layout.defaultSize.w, height: entry.layout.defaultSize.h },
    ])
  );

/**
 * Splittable components config, derived from manifest entries that have `splittable`.
 * Shape: { [componentName]: { into: string; propsKey: string } }
 */
export const MANIFEST_SPLITTABLE: Record<string, { into: string; propsKey: string }> =
  Object.fromEntries(
    Object.entries(COMPONENT_MANIFEST)
      .filter(([, entry]) => entry.splittable)
      .map(([name, entry]) => [name, entry.splittable!])
  );

// ── Re-exports ────────────────────────────────────────────────────────────────

export { COMPONENT_SCHEMAS } from "./schemas/index.js";
export { generatePromptReference } from "./derive/promptText.js";
export { generateMcpReference, getComponentReference, getComponentDescriptions } from "./derive/mcpReference.js";
export { deriveComponentNames, deriveComponentNameSet } from "./derive/nameList.js";
export type { ComponentManifestEntry, LayoutHintType, ComponentCategory, LoadingStrategy } from "./types.js";
export { TRUSTED_CDN_ORIGINS } from "./security.js";
export { SANDBOX_SDK_VERSION } from "./components/sandbox.js";

// Re-export individual schemas for direct imports
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
  videoSchema,
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
} from "./schemas/index.js";

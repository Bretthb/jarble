/**
 * Parses ```jarble_ui fenced code blocks from bot text.
 *
 * Bot responses can embed rich UI descriptors:
 *   ```jarble_ui
 *   {"component":"data_table","props":{"columns":["A"],"rows":[["1"]]}}
 *   ```
 *
 * This parser extracts them, returning cleaned text and an array of UI blocks.
 *
 * Uses a JSON-aware brace-depth parser instead of regex to correctly handle
 * nested backticks inside JSON payloads (e.g. code_block components with
 * markdown content containing fenced code blocks).
 */

import { nanoid } from "nanoid";
import { logger } from "./logger.js";

export type LayoutHint = "full-width" | "half" | "third" | "compact" | "auto";

const VALID_LAYOUT_HINTS = new Set<string>(["full-width", "half", "third", "compact", "auto"]);

export interface JarbleUIBlock {
  id: string;
  component: string;
  props: Record<string, unknown>;
  editable?: boolean;
  fileId?: string;
  saveMethod?: "mcp" | "chat";
  layoutHint?: LayoutHint;
}

export interface JarbleUIUpdate {
  cardId: string;
  props: Record<string, unknown>;
  merge: boolean;
  component?: string;
}

/** Max blocks per message to prevent abuse */
const MAX_BLOCKS = 20;
/** Max JSON size per block (100KB) */
const MAX_BLOCK_SIZE = 100_000;

export interface JarbleComponentDef {
  name: string;
  description?: string;
  layout: Array<{ component: string; props: Record<string, unknown> }>;
}

// ── Brace-depth JSON extractor ──────────────────────────────────────────────

/**
 * Extract a complete JSON object from text starting at the given index.
 *
 * Tracks brace depth to find the matching closing `}`, correctly skipping
 * braces inside JSON string literals. This handles cases where the JSON
 * payload contains triple backticks (e.g. code_block with markdown content),
 * which would cause the old regex-based parser to terminate early.
 *
 * Returns the JSON substring and the index after the closing `}`, or null
 * if no complete JSON object is found (incomplete block during streaming).
 */
function extractJsonFromBlock(text: string, startIndex: number): { json: string; endIndex: number } | null {
  // Find opening brace
  let i = startIndex;
  while (i < text.length && text[i] !== "{") i++;
  if (i >= text.length) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  const start = i;

  for (; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"' && !escape) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { json: text.slice(start, i + 1), endIndex: i + 1 };
      }
    }
  }

  return null; // Incomplete block
}

/**
 * Find all fenced blocks of a given type and extract their JSON payloads.
 *
 * Scans for ``` + marker (e.g. "jarble_ui") openings, uses brace-depth
 * parsing to find the complete JSON object, then continues scanning.
 *
 * Returns an array of { json, matchStart, matchEnd } for each found block,
 * where matchStart/matchEnd span the entire fenced block (opening backticks
 * through the JSON object end). The closing ``` is consumed if present.
 */
interface FencedBlock {
  json: string;
  matchStart: number;
  matchEnd: number;
}

function findFencedBlocks(text: string, marker: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const openPattern = "```" + marker;
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const openIdx = text.indexOf(openPattern, searchFrom);
    if (openIdx === -1) break;

    // Verify the marker is followed by whitespace/newline (not a longer marker)
    const afterMarker = openIdx + openPattern.length;
    if (afterMarker < text.length) {
      const nextChar = text[afterMarker];
      // For "jarble_ui", reject if followed by "_" (which would be _update or _define)
      if (marker === "jarble_ui" && nextChar === "_") {
        searchFrom = afterMarker;
        continue;
      }
      // Marker must be followed by whitespace or newline
      if (nextChar !== " " && nextChar !== "\t" && nextChar !== "\n" && nextChar !== "\r") {
        searchFrom = afterMarker;
        continue;
      }
    }

    // Find the JSON object using brace-depth parsing
    const result = extractJsonFromBlock(text, afterMarker);
    if (!result) {
      // Incomplete block (still streaming) — skip
      searchFrom = afterMarker;
      continue;
    }

    // Find and consume the closing ``` if present after the JSON
    let matchEnd = result.endIndex;
    // Skip whitespace/newlines after JSON
    let closeSearch = result.endIndex;
    while (closeSearch < text.length && (text[closeSearch] === " " || text[closeSearch] === "\t" || text[closeSearch] === "\n" || text[closeSearch] === "\r")) {
      closeSearch++;
    }
    // Check for closing backticks
    if (text.startsWith("```", closeSearch)) {
      matchEnd = closeSearch + 3;
    }

    blocks.push({
      json: result.json,
      matchStart: openIdx,
      matchEnd,
    });

    searchFrom = matchEnd;
  }

  return blocks;
}

/**
 * Remove found fenced blocks from text, replacing them with empty strings.
 * Processes blocks in reverse order to maintain correct indices.
 */
function stripBlocks(text: string, blocks: FencedBlock[]): string {
  if (blocks.length === 0) return text;

  // Process in reverse order so indices remain valid
  let result = text;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    result = result.slice(0, block.matchStart) + result.slice(block.matchEnd);
  }
  return result;
}

// ── Extraction functions ────────────────────────────────────────────────────

export function extractUIBlocks(text: string): {
  cleanText: string;
  uiBlocks: JarbleUIBlock[];
} {
  const uiBlocks: JarbleUIBlock[] = [];
  const fenced = findFencedBlocks(text, "jarble_ui");
  const validBlocks: FencedBlock[] = [];

  for (const block of fenced) {
    if (uiBlocks.length >= MAX_BLOCKS) {
      logger.warn(`[uiBlockParser] Exceeded MAX_BLOCKS (${MAX_BLOCKS}), truncating`);
      break;
    }

    if (block.json.length > MAX_BLOCK_SIZE) {
      logger.warn(`[uiBlockParser] Block exceeds MAX_BLOCK_SIZE (${block.json.length} > ${MAX_BLOCK_SIZE}), skipping`);
      continue;
    }

    try {
      const parsed = JSON.parse(block.json);

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof parsed.component !== "string" ||
        typeof parsed.props !== "object" ||
        parsed.props === null
      ) {
        continue; // Invalid structure, leave as text
      }

      uiBlocks.push({
        id: nanoid(10),
        component: parsed.component,
        props: parsed.props,
        ...(parsed.editable === true ? { editable: true } : {}),
        ...(typeof parsed.fileId === "string" ? { fileId: parsed.fileId } : {}),
        ...(parsed.saveMethod === "chat" ? { saveMethod: "chat" as const } : {}),
        ...(typeof parsed.layout_hint === "string" && VALID_LAYOUT_HINTS.has(parsed.layout_hint)
          ? { layoutHint: parsed.layout_hint as LayoutHint }
          : {}),
      });
      validBlocks.push(block);
    } catch {
      logger.warn("[uiBlockParser] Failed to parse jarble_ui block: %s", block.json.slice(0, 200));
      // Invalid JSON, leave as visible text
    }
  }

  const cleanText = stripBlocks(text, validBlocks).replace(/\n{3,}/g, "\n\n").trim();

  if (uiBlocks.length > 0) {
    logger.debug(`[uiBlockParser] Extracted ${uiBlocks.length} blocks from ${text.length} chars`);
  }

  return { cleanText, uiBlocks };
}

/** Max update blocks per message */
const MAX_UPDATES = 20;

/**
 * Extract ```jarble_ui_update fenced code blocks from bot text.
 *
 * Returns the cleaned text (with update blocks stripped) and an array of
 * parsed UI update descriptors.
 */
export function extractUIUpdates(text: string): {
  cleanText: string;
  uiUpdates: JarbleUIUpdate[];
} {
  const uiUpdates: JarbleUIUpdate[] = [];
  const fenced = findFencedBlocks(text, "jarble_ui_update");
  const validBlocks: FencedBlock[] = [];

  for (const block of fenced) {
    if (uiUpdates.length >= MAX_UPDATES) {
      logger.warn(`[uiBlockParser] Exceeded MAX_UPDATES (${MAX_UPDATES}), truncating`);
      break;
    }

    if (block.json.length > MAX_BLOCK_SIZE) {
      logger.warn(`[uiBlockParser] Update block exceeds MAX_BLOCK_SIZE (${block.json.length} > ${MAX_BLOCK_SIZE}), skipping`);
      continue;
    }

    try {
      const parsed = JSON.parse(block.json);

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof parsed.card_id !== "string" ||
        typeof parsed.props !== "object" ||
        parsed.props === null
      ) {
        continue; // Invalid structure, leave as text
      }

      uiUpdates.push({
        cardId: parsed.card_id,
        props: parsed.props,
        merge: parsed.merge !== false,
        ...(typeof parsed.component === "string" ? { component: parsed.component } : {}),
      });
      validBlocks.push(block);
    } catch {
      logger.warn("[uiBlockParser] Failed to parse jarble_ui_update block: %s", block.json.slice(0, 200));
      // Invalid JSON, leave as visible text
    }
  }

  const cleanText = stripBlocks(text, validBlocks).replace(/\n{3,}/g, "\n\n").trim();

  if (uiUpdates.length > 0) {
    logger.debug(`[uiBlockParser] Extracted ${uiUpdates.length} updates from ${text.length} chars`);
  }

  return { cleanText, uiUpdates };
}

// ── Component Definitions ────────────────────────────────────────────────────

/** Max component definitions per message */
const MAX_DEFS = 5;

/**
 * Extract ```jarble_ui_define fenced code blocks from bot text.
 * These define reusable custom components with template variables.
 *
 * Format:
 *   ```jarble_ui_define
 *   {"name":"kpi_row","description":"...","layout":[{component,props}]}
 *   ```
 */
export function extractComponentDefs(text: string): {
  cleanText: string;
  componentDefs: JarbleComponentDef[];
} {
  const componentDefs: JarbleComponentDef[] = [];
  const fenced = findFencedBlocks(text, "jarble_ui_define");
  const validBlocks: FencedBlock[] = [];

  for (const block of fenced) {
    if (componentDefs.length >= MAX_DEFS) {
      logger.warn(`[uiBlockParser] Exceeded MAX_DEFS (${MAX_DEFS}), truncating`);
      break;
    }

    if (block.json.length > MAX_BLOCK_SIZE) {
      logger.warn(`[uiBlockParser] Define block exceeds MAX_BLOCK_SIZE, skipping`);
      continue;
    }

    try {
      const parsed = JSON.parse(block.json);

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof parsed.name !== "string" ||
        !Array.isArray(parsed.layout)
      ) {
        continue; // Invalid structure, leave as text
      }

      // Validate component name format
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(parsed.name)) {
        logger.warn(`[uiBlockParser] Invalid component name: ${parsed.name}`);
        continue;
      }

      componentDefs.push({
        name: parsed.name,
        description: typeof parsed.description === "string" ? parsed.description : undefined,
        layout: parsed.layout,
      });
      validBlocks.push(block);
    } catch {
      logger.warn("[uiBlockParser] Failed to parse jarble_ui_define block: %s", block.json.slice(0, 200));
      // Invalid JSON, leave as visible text
    }
  }

  const cleanText = stripBlocks(text, validBlocks).replace(/\n{3,}/g, "\n\n").trim();

  if (componentDefs.length > 0) {
    logger.debug(`[uiBlockParser] Extracted ${componentDefs.length} component definitions`);
  }

  return { cleanText, componentDefs };
}

/**
 * Extract all fenced block types from text.
 *
 * Order matters: define > update > render (each strips its blocks before the next).
 */
export function extractAllUIBlocks(text: string): {
  cleanText: string;
  uiBlocks: JarbleUIBlock[];
  uiUpdates: JarbleUIUpdate[];
  componentDefs: JarbleComponentDef[];
} {
  // 1. Extract component definitions first
  const { cleanText: afterDefs, componentDefs } = extractComponentDefs(text);
  // 2. Then updates (jarble_ui_update must be matched before jarble_ui)
  const { cleanText: afterUpdates, uiUpdates } = extractUIUpdates(afterDefs);
  // 3. Then render blocks from the remaining text
  const { cleanText, uiBlocks } = extractUIBlocks(afterUpdates);

  return { cleanText, uiBlocks, uiUpdates, componentDefs };
}

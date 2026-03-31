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
import { TRUSTED_CDN_ORIGINS as TRUSTED_CDN_ORIGINS_ARRAY } from "@jarble/component-manifest";

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
  dashboardId?: string;
  dashboardTitle?: string;
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

// ── Server-side library URL validation ──────────────────────────────────────

/**
 * Allowlist of trusted CDN origins for sandbox library URLs.
 * Imported from @jarble/component-manifest (single source of truth).
 */
export const TRUSTED_CDN_ORIGINS = new Set(TRUSTED_CDN_ORIGINS_ARRAY);

/**
 * Validate that a library URL is from a trusted CDN origin.
 * Returns true only for HTTPS URLs whose origin is in TRUSTED_CDN_ORIGINS.
 */
export function validateLibraryUrl(url: string): boolean {
  if (!url.startsWith("https://")) return false;
  try {
    const parsed = new URL(url);
    return TRUSTED_CDN_ORIGINS.has(parsed.origin);
  } catch {
    return false;
  }
}

/**
 * Sanitize a libraries array by filtering out invalid or untrusted URLs.
 * Returns only string entries that pass validateLibraryUrl.
 * Logs a warning for each rejected URL.
 */
export function sanitizeLibraries(libraries: unknown): string[] {
  if (!Array.isArray(libraries)) return [];
  const result: string[] = [];
  for (const item of libraries) {
    if (typeof item !== "string") {
      logger.warn("[uiBlockParser] Rejected non-string library entry: %s", typeof item);
      continue;
    }
    if (validateLibraryUrl(item)) {
      result.push(item);
    } else {
      logger.warn("[uiBlockParser] Rejected untrusted library URL: %s", item);
    }
  }
  return result;
}

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
  // Track the last position where depth was 1 and we just closed a value -
  // this is a potential truncation repair point
  let lastDepth1Close = -1;

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
      // Track last close at depth 1 (inside the root object)
      if (depth === 1) lastDepth1Close = i;
    }
  }

  // Incomplete block - try to repair truncated JSON.
  // Large sandbox components often get truncated by OpenClaw CLI timeout.
  // Strategy: find the last point where the "props" object was somewhat valid
  // and close all open braces.
  if (depth > 0 && !inString) {
    // Close all remaining braces
    const truncated = text.slice(start, text.length);
    const closingBraces = "}".repeat(depth);
    const repaired = truncated + closingBraces;
    try {
      JSON.parse(repaired);
      logger.debug("[uiBlockParser] Repaired truncated JSON (%d chars, added %d closing braces)", repaired.length, depth);
      return { json: repaired, endIndex: text.length };
    } catch {
      // Repair failed - might be mid-string. Try closing the string first.
      const repairedWithString = truncated + '"' + closingBraces;
      try {
        JSON.parse(repairedWithString);
        logger.debug("[uiBlockParser] Repaired truncated JSON with string close (%d chars)", repairedWithString.length);
        return { json: repairedWithString, endIndex: text.length };
      } catch {
        // Last resort: truncate to the last clean depth-1 close point
        if (lastDepth1Close > start) {
          const safeJson = text.slice(start, lastDepth1Close + 1) + "}";
          try {
            JSON.parse(safeJson);
            logger.debug("[uiBlockParser] Repaired truncated JSON by truncating to last safe point (%d chars)", safeJson.length);
            return { json: safeJson, endIndex: lastDepth1Close + 1 };
          } catch { /* truly unrecoverable */ }
        }
      }
    }
  }

  return null; // Truly incomplete/unrecoverable
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
    let result = extractJsonFromBlock(text, afterMarker);
    if (!result) {
      // Brace-depth parser failed - try fallback: find closing ``` and JSON.parse the content
      const closingIdx = text.indexOf("```", afterMarker);
      if (closingIdx !== -1) {
        const rawContent = text.slice(afterMarker, closingIdx).trim();
        if (rawContent.startsWith("{")) {
          try {
            JSON.parse(rawContent); // validate it's valid JSON
            result = { json: rawContent, endIndex: closingIdx };
            logger.debug("[uiBlockParser] Brace-depth parser failed but JSON.parse fallback succeeded (%d chars)", rawContent.length);
          } catch {
            // Not valid JSON either - truly incomplete
          }
        }
      }
      if (!result) {
        // Incomplete block (still streaming) - skip
        searchFrom = afterMarker;
        continue;
      }
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

      // Server-side library URL validation for sandbox components
      if (parsed.props.libraries) {
        parsed.props.libraries = sanitizeLibraries(parsed.props.libraries);
      }

      // Server-side import map URL validation for sandbox components
      if (parsed.props.importMap && typeof parsed.props.importMap === "object" && !Array.isArray(parsed.props.importMap)) {
        const safeMap: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed.props.importMap as Record<string, unknown>)) {
          if (typeof value === "string" && validateLibraryUrl(value)) {
            safeMap[key] = value;
          } else {
            logger.warn("[uiBlockParser] Rejected untrusted import map URL for %s: %s", key, value);
          }
        }
        parsed.props.importMap = safeMap;
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
        ...(typeof parsed.dashboardId === "string" ? { dashboardId: parsed.dashboardId } : {}),
        ...(typeof parsed.dashboardTitle === "string" ? { dashboardTitle: parsed.dashboardTitle } : {}),
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

// ── Suggestions Extraction ────────────────────────────────────────────────────

/** Max suggestions per message */
const MAX_SUGGESTIONS = 10;

/**
 * Extract ```jarble_suggestions fenced code blocks from bot text.
 *
 * Format:
 *   ```jarble_suggestions
 *   ["Option A", "Option B", "Option C"]
 *   ```
 *
 * Returns the cleaned text (with suggestion blocks stripped) and an array
 * of suggestion strings.
 */
export function extractSuggestions(text: string): {
  cleanText: string;
  suggestions: string[];
} {
  const suggestions: string[] = [];
  const openPattern = "```jarble_suggestions";
  const validBlocks: FencedBlock[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const openIdx = text.indexOf(openPattern, searchFrom);
    if (openIdx === -1) break;

    const afterMarker = openIdx + openPattern.length;
    // Marker must be followed by whitespace/newline or end of text
    if (afterMarker < text.length) {
      const nextChar = text[afterMarker];
      if (nextChar !== " " && nextChar !== "\t" && nextChar !== "\n" && nextChar !== "\r") {
        searchFrom = afterMarker;
        continue;
      }
    }

    // Find the opening bracket for the JSON array
    let bracketStart = afterMarker;
    while (bracketStart < text.length && text[bracketStart] !== "[") {
      if (text[bracketStart] === "`") break; // Hit closing backticks before finding array
      bracketStart++;
    }
    if (bracketStart >= text.length || text[bracketStart] !== "[") {
      searchFrom = afterMarker;
      continue;
    }

    // Find the matching closing bracket
    let depth = 0;
    let inString = false;
    let escape = false;
    let bracketEnd = -1;

    for (let i = bracketStart; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\" && inString) { escape = true; continue; }
      if (ch === '"' && !escape) { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "[") depth++;
      if (ch === "]") {
        depth--;
        if (depth === 0) {
          bracketEnd = i + 1;
          break;
        }
      }
    }

    if (bracketEnd === -1) {
      // Incomplete block (still streaming)
      searchFrom = afterMarker;
      continue;
    }

    // Find and consume closing ``` if present
    let matchEnd = bracketEnd;
    let closeSearch = bracketEnd;
    while (closeSearch < text.length && (text[closeSearch] === " " || text[closeSearch] === "\t" || text[closeSearch] === "\n" || text[closeSearch] === "\r")) {
      closeSearch++;
    }
    if (text.startsWith("```", closeSearch)) {
      matchEnd = closeSearch + 3;
    }

    // Parse the JSON array
    const jsonStr = text.slice(bracketStart, bracketEnd);
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string" && suggestions.length < MAX_SUGGESTIONS) {
            suggestions.push(item);
          }
        }
        validBlocks.push({ json: jsonStr, matchStart: openIdx, matchEnd });
      }
    } catch {
      logger.warn("[uiBlockParser] Failed to parse jarble_suggestions block: %s", jsonStr.slice(0, 200));
    }

    searchFrom = matchEnd;
  }

  const cleanText = stripBlocks(text, validBlocks).replace(/\n{3,}/g, "\n\n").trim();

  if (suggestions.length > 0) {
    logger.debug(`[uiBlockParser] Extracted ${suggestions.length} suggestions`);
  }

  return { cleanText, suggestions };
}

// ── Design Context extraction ────────────────────────────────────────────────

const DESIGN_CONTEXT_FENCE_RE = /```jarble_design_context\s*\n([\s\S]*?)```/g;

/**
 * Extract ```jarble_design_context blocks from bot text.
 * Returns the last context found (most recent wins) and cleaned text.
 */
function extractDesignContext(text: string): {
  cleanText: string;
  designContext: Record<string, unknown> | null;
} {
  let designContext: Record<string, unknown> | null = null;
  const cleanText = text.replace(DESIGN_CONTEXT_FENCE_RE, (_match, jsonStr: string) => {
    try {
      const parsed = JSON.parse(jsonStr.trim());
      if (parsed && typeof parsed === "object") {
        designContext = parsed as Record<string, unknown>;
      }
    } catch {
      logger.warn("[uiBlockParser] Failed to parse design context JSON");
    }
    return "";
  }).replace(/\n{3,}/g, "\n\n").trim();
  return { cleanText, designContext };
}

/**
 * Extract all fenced block types from text.
 *
 * Order matters: suggestions > design context > define > update > render (each strips its blocks before the next).
 */
export function extractAllUIBlocks(text: string): {
  cleanText: string;
  uiBlocks: JarbleUIBlock[];
  uiUpdates: JarbleUIUpdate[];
  componentDefs: JarbleComponentDef[];
  suggestions: string[];
  designContext: Record<string, unknown> | null;
} {
  // 0. Extract suggestions first (lightweight, no overlap with UI blocks)
  const { cleanText: afterSuggestions, suggestions } = extractSuggestions(text);
  // 0.5. Extract design context blocks
  const { cleanText: afterDesignCtx, designContext } = extractDesignContext(afterSuggestions);
  // 1. Extract component definitions
  const { cleanText: afterDefs, componentDefs } = extractComponentDefs(afterDesignCtx);
  // 2. Then updates (jarble_ui_update must be matched before jarble_ui)
  const { cleanText: afterUpdates, uiUpdates } = extractUIUpdates(afterDefs);
  // 3. Then render blocks from the remaining text
  const { cleanText, uiBlocks } = extractUIBlocks(afterUpdates);

  return { cleanText, uiBlocks, uiUpdates, componentDefs, suggestions, designContext };
}

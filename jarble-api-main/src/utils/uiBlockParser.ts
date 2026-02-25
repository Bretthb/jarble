/**
 * Parses ```jarble_ui fenced code blocks from bot text.
 *
 * Bot responses can embed rich UI descriptors:
 *   ```jarble_ui
 *   {"component":"data_table","props":{"columns":["A"],"rows":[["1"]]}}
 *   ```
 *
 * This parser extracts them, returning cleaned text and an array of UI blocks.
 */

import { nanoid } from "nanoid";

export interface JarbleUIBlock {
  id: string;
  component: string;
  props: Record<string, unknown>;
  editable?: boolean;
  fileId?: string;
  saveMethod?: "mcp" | "chat";
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

/**
 * Regex to match ```jarble_ui ... ``` fenced code blocks.
 * Handles optional whitespace and newlines inside the fence.
 */
const JARBLE_UI_FENCE = /```jarble_ui\s*\n([\s\S]*?)```/g;

/**
 * Regex to match ```jarble_ui_update ... ``` fenced code blocks.
 * Must be applied BEFORE the general jarble_ui fence since "jarble_ui_update"
 * would partially match "jarble_ui" otherwise.
 */
const JARBLE_UI_UPDATE_FENCE = /```jarble_ui_update\s*\n([\s\S]*?)```/g;

export function extractUIBlocks(text: string): {
  cleanText: string;
  uiBlocks: JarbleUIBlock[];
} {
  const uiBlocks: JarbleUIBlock[] = [];
  let blockCount = 0;

  const cleanText = text.replace(JARBLE_UI_FENCE, (match, jsonContent: string) => {
    if (blockCount >= MAX_BLOCKS) return match; // Leave excess blocks as visible text

    const trimmed = jsonContent.trim();
    if (trimmed.length > MAX_BLOCK_SIZE) return match; // Too large, leave as text

    try {
      const parsed = JSON.parse(trimmed);

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof parsed.component !== "string" ||
        typeof parsed.props !== "object" ||
        parsed.props === null
      ) {
        return match; // Invalid structure, leave as text
      }

      uiBlocks.push({
        id: nanoid(10),
        component: parsed.component,
        props: parsed.props,
        ...(parsed.editable === true ? { editable: true } : {}),
        ...(typeof parsed.fileId === "string" ? { fileId: parsed.fileId } : {}),
        ...(parsed.saveMethod === "chat" ? { saveMethod: "chat" as const } : {}),
      });
      blockCount++;

      return ""; // Strip the block from text
    } catch {
      return match; // Invalid JSON, leave as visible text
    }
  });

  // Clean up extra blank lines left by stripped blocks
  const finalText = cleanText.replace(/\n{3,}/g, "\n\n").trim();

  return { cleanText: finalText, uiBlocks };
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
  let updateCount = 0;

  const cleanText = text.replace(JARBLE_UI_UPDATE_FENCE, (match, jsonContent: string) => {
    if (updateCount >= MAX_UPDATES) return match;

    const trimmed = jsonContent.trim();
    if (trimmed.length > MAX_BLOCK_SIZE) return match;

    try {
      const parsed = JSON.parse(trimmed);

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof parsed.card_id !== "string" ||
        typeof parsed.props !== "object" ||
        parsed.props === null
      ) {
        return match; // Invalid structure, leave as text
      }

      uiUpdates.push({
        cardId: parsed.card_id,
        props: parsed.props,
        merge: parsed.merge !== false,
        ...(typeof parsed.component === "string" ? { component: parsed.component } : {}),
      });
      updateCount++;

      return ""; // Strip the block from text
    } catch {
      return match; // Invalid JSON, leave as visible text
    }
  });

  const finalText = cleanText.replace(/\n{3,}/g, "\n\n").trim();

  return { cleanText: finalText, uiUpdates };
}

/**
 * Extract both ```jarble_ui and ```jarble_ui_update fenced blocks from text.
 *
 * Convenience wrapper that runs both extractors. The update fence is matched
 * first (before the general jarble_ui fence) to prevent partial collisions.
 */
export function extractAllUIBlocks(text: string): {
  cleanText: string;
  uiBlocks: JarbleUIBlock[];
  uiUpdates: JarbleUIUpdate[];
} {
  // Extract updates first (jarble_ui_update must be matched before jarble_ui)
  const { cleanText: afterUpdates, uiUpdates } = extractUIUpdates(text);
  // Then extract render blocks from the remaining text
  const { cleanText, uiBlocks } = extractUIBlocks(afterUpdates);

  return { cleanText, uiBlocks, uiUpdates };
}

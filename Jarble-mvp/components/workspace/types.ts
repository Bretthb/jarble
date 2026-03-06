/** Canvas workspace types — cards, state, and actions. */

export type LayoutHint = "full-width" | "half" | "third" | "compact" | "auto";
export type CanvasMode = "dashboard" | "freeform";

/** Tracks fix attempt frequency per card for rate limiting error loops. */
export interface FixAttemptRecord {
  count: number;
  windowStart: number;
}

/** Max fix attempts before rate-limiting the "Fix Component" button. */
export const FIX_ATTEMPT_LIMIT = 3;

/** Window (ms) in which fix attempts are counted before resetting. */
export const FIX_ATTEMPT_WINDOW_MS = 60_000;

/** Maximum number of cards allowed on the canvas before eviction. */
export const MAX_CANVAS_CARDS = 100;

export interface CanvasCard {
  id: string;
  /** Registered component name (e.g. "chart", "sandbox", "text_message") */
  component: string;
  props: Record<string, unknown>;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  minimized: boolean;
  /** Whether the card content is user-editable */
  editable?: boolean;
  /** PVC file path for save-to-file flow */
  fileId?: string;
  /** How the card saves: MCP write_file or chat message */
  saveMethod?: "mcp" | "chat";
  createdAt: number;
  /** Links card back to the SSE message that spawned it */
  sourceMessageId?: string;
  /** Display title for the card header */
  title?: string;
  /** Whether the card is currently selected (e.g. via user click) */
  selected?: boolean;
  /** Name given when the user saved this card to their library */
  savedName?: string;
  /** Dashboard grid layout hint: controls column span */
  layoutHint?: LayoutHint;
  /** Whether this card is pinned (immune to canvas clears and eviction) */
  pinned?: boolean;
  /** Whether the original props were lost (e.g. trimmed by context window) */
  propsLost?: boolean;
  /** LLM provider that generated this card (e.g. "anthropic", "openai") */
  llmProvider?: string;
  /** LLM model that generated this card (e.g. "claude-3-opus") */
  llmModel?: string;
  /** Dashboard group this card belongs to */
  groupId?: string;
}

export interface CanvasState {
  cards: CanvasCard[];
  viewportOffset: { x: number; y: number };
  zoom: number;
  nextZIndex: number;
  focusedCardId: string | null;
  mode: CanvasMode;
  /** Per-card fix attempt tracking for error loop rate limiting. */
  fixAttempts: Record<string, FixAttemptRecord>;
  /** Dashboard groups: groupId -> metadata */
  dashboardGroups: Record<string, { title: string; cardIds: string[] }>;
}

// ── Actions ──────────────────────────────────────────────────────────────────

export type CanvasAction =
  | { type: "ADD_CARD"; card: CanvasCard }
  | { type: "REMOVE_CARD"; id: string }
  | { type: "MOVE_CARD"; id: string; position: { x: number; y: number } }
  | { type: "RESIZE_CARD"; id: string; size: { width: number; height: number } }
  | { type: "MINIMIZE_CARD"; id: string }
  | { type: "RESTORE_CARD"; id: string }
  | { type: "BRING_TO_FRONT"; id: string }
  | { type: "SEND_TO_BACK"; id: string }
  | { type: "DUPLICATE_CARD"; id: string; newId: string; offset: { x: number; y: number } }
  | { type: "RESET_CARD_SIZE"; id: string }
  | { type: "FOCUS_CARD"; id: string | null }
  | { type: "SET_VIEWPORT"; offset: { x: number; y: number } }
  | { type: "SET_ZOOM"; zoom: number }
  | { type: "RESTORE_STATE"; state: CanvasState }
  | { type: "SPLIT_CARD"; id: string }
  | { type: "MERGE_CARDS"; sourceId: string; targetId: string }
  | { type: "GROUP_CARDS"; cardIds: string[] }
  | { type: "TOGGLE_SELECT_CARD"; id: string }
  | { type: "REORDER_CARDS"; sourceId: string; targetId: string }
  | { type: "UPDATE_CARD_PROPS"; id: string; props: Record<string, unknown>; merge: boolean; component?: string }
  | { type: "SELECT_CARD"; id: string }
  | { type: "DESELECT_CARD" }
  | { type: "SAVE_CARD"; id: string; savedName: string; fileId: string }
  | { type: "UNSAVE_CARD"; id: string }
  | { type: "TIDY_LAYOUT"; containerWidth: number }
  | { type: "SET_CANVAS_MODE"; mode: CanvasMode }
  | { type: "CLEAR_CANVAS" }
  | { type: "RECORD_FIX_ATTEMPT"; id: string }
  | { type: "RESET_FIX_ATTEMPTS"; id: string }
  | { type: "PIN_CARD"; id: string }
  | { type: "UNPIN_CARD"; id: string }
  | { type: "CREATE_DASHBOARD_GROUP"; groupId: string; title: string; cardIds: string[] }
  | { type: "UNGROUP_DASHBOARD"; groupId: string };

// ── Splittable components config ────────────────────────────────────────────

export const SPLITTABLE_COMPONENTS: Record<string, {
  /** Property name containing the array of items */
  itemsKey: string;
  /** Component type for individual items after split */
  splitComponent: string;
  /** Function to transform one item into props for the split component */
  transformItem: (item: unknown, index: number) => Record<string, unknown>;
  /** Minimum items required to show split button */
  minItems: number;
}> = {
  stat_grid: {
    itemsKey: "stats",
    splitComponent: "metric_card",
    transformItem: (item: unknown) => {
      const stat = item as { label: string; value: string | number; change?: string; description?: string; trend?: "up" | "down" };
      return {
        label: stat.label,
        value: stat.value,
        change: stat.change || stat.description,
      };
    },
    minItems: 2,
  },
  key_value: {
    itemsKey: "items",
    splitComponent: "card",
    transformItem: (item: unknown) => {
      const kv = item as { key: string; value: string };
      return {
        title: kv.key,
        content: String(kv.value),
      };
    },
    minItems: 2,
  },
  descriptions: {
    itemsKey: "items",
    splitComponent: "card",
    transformItem: (item: unknown) => {
      const desc = item as { label: string; value: string };
      return {
        title: desc.label,
        content: String(desc.value),
      };
    },
    minItems: 2,
  },
  data_table: {
    itemsKey: "rows",
    splitComponent: "data_table",
    transformItem: (item: unknown, _index: number) => {
      // Each split gets a single-row table (preserving columns from parent — set at dispatch time)
      return { rows: [item] };
    },
    minItems: 2,
  },
  tabs: {
    itemsKey: "tabs",
    splitComponent: "card",
    transformItem: (item: unknown) => {
      const tab = item as { label: string; content?: string; children?: unknown[] };
      return {
        title: tab.label,
        body: tab.content || "",
        ...(tab.children ? { children: tab.children } : {}),
      };
    },
    minItems: 2,
  },
  list: {
    itemsKey: "items",
    splitComponent: "card",
    transformItem: (item: unknown) => {
      const li = item as { text: string; description?: string };
      return {
        title: li.text,
        body: li.description || "",
      };
    },
    minItems: 2,
  },
  timeline: {
    itemsKey: "events",
    splitComponent: "card",
    transformItem: (item: unknown) => {
      const ev = item as { label: string; description?: string; timestamp?: string };
      return {
        title: ev.label,
        subtitle: ev.timestamp || "",
        body: ev.description || "",
      };
    },
    minItems: 2,
  },
};

/** Check if a card can be split */
export function canSplitCard(card: CanvasCard): boolean {
  const config = SPLITTABLE_COMPONENTS[card.component];
  if (!config) return false;
  const items = card.props[config.itemsKey];
  return Array.isArray(items) && items.length >= config.minItems;
}

/** Check if two cards can be merged */
export function canMergeCards(source: CanvasCard, target: CanvasCard): boolean {
  // Can merge if same component type and both have array items
  if (source.component !== target.component) return false;
  const config = SPLITTABLE_COMPONENTS[source.component];
  if (!config) return false;
  const sourceItems = source.props[config.itemsKey];
  const targetItems = target.props[config.itemsKey];

  if (!Array.isArray(sourceItems) || !Array.isArray(targetItems)) return false;
  // At least one must have items to make merge meaningful
  if (sourceItems.length === 0 && targetItems.length === 0) return false;

  return true;
}

// ── Default sizes per component type (derived from shared manifest) ──────────

import { DEFAULT_CARD_SIZES as MANIFEST_SIZES } from "@jarble/component-manifest";

export const DEFAULT_CARD_SIZES: Record<string, { width: number; height: number }> = MANIFEST_SIZES;

export const DEFAULT_CARD_SIZE = { width: 320, height: 220 };

export const INITIAL_CANVAS_STATE: CanvasState = {
  cards: [],
  viewportOffset: { x: 0, y: 0 },
  zoom: 1,
  nextZIndex: 1,
  focusedCardId: null,
  mode: "dashboard",
  fixAttempts: {},
  dashboardGroups: {},
};

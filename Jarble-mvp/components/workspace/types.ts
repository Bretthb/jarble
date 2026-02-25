/** Canvas workspace types — cards, state, and actions. */

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
}

export interface CanvasState {
  cards: CanvasCard[];
  viewportOffset: { x: number; y: number };
  zoom: number;
  nextZIndex: number;
  focusedCardId: string | null;
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
  | { type: "REORDER_CARDS"; sourceId: string; targetId: string }
  | { type: "UPDATE_CARD_PROPS"; id: string; props: Record<string, unknown>; merge: boolean; component?: string }
  | { type: "SELECT_CARD"; id: string }
  | { type: "DESELECT_CARD" }
  | { type: "SAVE_CARD"; id: string; savedName: string };

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
    splitComponent: "statistic",
    transformItem: (item: unknown) => {
      const stat = item as { label: string; value: string | number; change?: string; trend?: "up" | "down" };
      return {
        title: stat.label,
        value: stat.value,
        suffix: stat.change,
        trend: stat.trend,
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

// ── Default sizes per component type ─────────────────────────────────────────

export const DEFAULT_CARD_SIZES: Record<string, { width: number; height: number }> = {
  sandbox: { width: 600, height: 500 },
  chart: { width: 500, height: 400 },
  data_table: { width: 500, height: 400 },
  spreadsheet: { width: 600, height: 450 },
  code_editor: { width: 550, height: 400 },
  map: { width: 500, height: 400 },
  text_message: { width: 400, height: 300 },
};

export const DEFAULT_CARD_SIZE = { width: 400, height: 300 };

export const INITIAL_CANVAS_STATE: CanvasState = {
  cards: [],
  viewportOffset: { x: 0, y: 0 },
  zoom: 1,
  nextZIndex: 1,
  focusedCardId: null,
};

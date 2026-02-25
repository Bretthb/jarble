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
  | { type: "RESTORE_STATE"; state: CanvasState };

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

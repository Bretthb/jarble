import type { CanvasState, CanvasAction } from "./types";
import { INITIAL_CANVAS_STATE, DEFAULT_CARD_SIZES, DEFAULT_CARD_SIZE } from "./types";

export { INITIAL_CANVAS_STATE };

export function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case "ADD_CARD":
      return {
        ...state,
        cards: [...state.cards, { ...action.card, zIndex: state.nextZIndex }],
        nextZIndex: state.nextZIndex + 1,
      };

    case "REMOVE_CARD":
      return {
        ...state,
        cards: state.cards.filter((c) => c.id !== action.id),
        focusedCardId: state.focusedCardId === action.id ? null : state.focusedCardId,
      };

    case "MOVE_CARD":
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.id ? { ...c, position: action.position } : c
        ),
      };

    case "RESIZE_CARD":
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.id ? { ...c, size: action.size } : c
        ),
      };

    case "MINIMIZE_CARD":
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.id ? { ...c, minimized: true } : c
        ),
      };

    case "RESTORE_CARD":
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.id ? { ...c, minimized: false } : c
        ),
      };

    case "BRING_TO_FRONT": {
      const nextZ = state.nextZIndex;
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.id ? { ...c, zIndex: nextZ } : c
        ),
        focusedCardId: action.id,
        // Normalize when z-index gets high to avoid overflow
        nextZIndex: nextZ >= 1000 ? normalizeAndGetNext(state.cards, action.id) : nextZ + 1,
      };
    }

    case "SEND_TO_BACK": {
      // Set z-index to 0; all other cards keep their order above it
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.id ? { ...c, zIndex: 0 } : c
        ),
      };
    }

    case "DUPLICATE_CARD": {
      const source = state.cards.find((c) => c.id === action.id);
      if (!source) return state;
      const clone = {
        ...source,
        id: action.newId,
        position: { x: source.position.x + action.offset.x, y: source.position.y + action.offset.y },
        zIndex: state.nextZIndex,
        createdAt: Date.now(),
      };
      return {
        ...state,
        cards: [...state.cards, clone],
        nextZIndex: state.nextZIndex + 1,
        focusedCardId: action.newId,
      };
    }

    case "RESET_CARD_SIZE": {
      const card = state.cards.find((c) => c.id === action.id);
      if (!card) return state;
      const defaultSize = DEFAULT_CARD_SIZES[card.component] || DEFAULT_CARD_SIZE;
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.id ? { ...c, size: defaultSize } : c
        ),
      };
    }

    case "FOCUS_CARD":
      return { ...state, focusedCardId: action.id };

    case "SET_VIEWPORT":
      return { ...state, viewportOffset: action.offset };

    case "SET_ZOOM":
      return { ...state, zoom: Math.max(0.25, Math.min(2.0, action.zoom)) };

    case "RESTORE_STATE":
      return action.state;

    default:
      return state;
  }
}

/** Re-rank all cards starting from 1, preserving relative order. */
function normalizeAndGetNext(cards: CanvasState["cards"], frontId: string): number {
  const sorted = [...cards].sort((a, b) => a.zIndex - b.zIndex);
  let z = 1;
  for (const card of sorted) {
    card.zIndex = card.id === frontId ? cards.length + 1 : z++;
  }
  return cards.length + 2;
}

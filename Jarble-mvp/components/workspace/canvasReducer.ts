import type { CanvasState, CanvasAction, CanvasCard } from "./types";
import { INITIAL_CANVAS_STATE, DEFAULT_CARD_SIZES, DEFAULT_CARD_SIZE, SPLITTABLE_COMPONENTS } from "./types";

export { INITIAL_CANVAS_STATE };

export function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  if (process.env.NODE_ENV === "development") {
    console.log(`[Jarble:Reducer] ${action.type}`);
  }

  switch (action.type) {
    case "ADD_CARD": {
      const newState = {
        ...state,
        cards: [...state.cards, { ...action.card, zIndex: state.nextZIndex }],
        nextZIndex: state.nextZIndex + 1,
      };
      if (process.env.NODE_ENV === "development") console.log(`[Jarble:Reducer] ADD_CARD -> ${newState.cards.length} cards`);
      return newState;
    }

    case "REMOVE_CARD": {
      const newState = {
        ...state,
        cards: state.cards.filter((c) => c.id !== action.id),
        focusedCardId: state.focusedCardId === action.id ? null : state.focusedCardId,
      };
      if (process.env.NODE_ENV === "development") console.log(`[Jarble:Reducer] REMOVE_CARD -> ${newState.cards.length} cards`);
      return newState;
    }

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
      // Normalize when z-index gets high to avoid overflow
      if (nextZ >= 1000) {
        const { cards: normalizedCards, nextZIndex } = normalizeZIndices(state.cards, action.id);
        return {
          ...state,
          cards: normalizedCards,
          focusedCardId: action.id,
          nextZIndex,
        };
      }
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.id ? { ...c, zIndex: nextZ } : c
        ),
        focusedCardId: action.id,
        nextZIndex: nextZ + 1,
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
      if (process.env.NODE_ENV === "development") console.log(`[Jarble:Reducer] RESTORE_STATE -> ${action.state.cards.length} cards`);
      return action.state;

    case "SPLIT_CARD": {
      const card = state.cards.find((c) => c.id === action.id);
      if (!card) return state;

      const config = SPLITTABLE_COMPONENTS[card.component];
      if (!config) return state;

      const items = card.props[config.itemsKey];
      if (!Array.isArray(items) || items.length < config.minItems) return state;

      // Create new cards for each item with error handling
      const newCards: CanvasCard[] = [];
      const timestamp = Date.now();
      for (let index = 0; index < items.length; index++) {
        try {
          let transformedProps = config.transformItem(items[index], index);
          // For data_table splits, propagate columns from parent
          if (card.component === "data_table" && card.props.columns) {
            transformedProps = { ...transformedProps, columns: card.props.columns, title: `Row ${index + 1}` };
          }
          const offset = { x: (index % 3) * 220, y: Math.floor(index / 3) * 180 };
          newCards.push({
            id: `${card.id}-split-${index}-${timestamp}`,
            component: config.splitComponent,
            props: transformedProps,
            position: { x: card.position.x + offset.x, y: card.position.y + offset.y },
            size: DEFAULT_CARD_SIZES[config.splitComponent] || { width: 200, height: 150 },
            zIndex: state.nextZIndex + index,
            minimized: false,
            createdAt: timestamp,
            sourceMessageId: card.sourceMessageId,
            title: (transformedProps as { title?: string }).title || `Item ${index + 1}`,
          });
        } catch (err) {
          console.error(`[Jarble:Reducer] Failed to split item ${index}:`, err);
          // Skip this item and continue
        }
      }

      if (newCards.length === 0) return state; // All transformations failed

      if (process.env.NODE_ENV === "development") console.log(`[Jarble:Reducer] SPLIT_CARD -> ${items.length} items split into ${newCards.length} cards`);
      return {
        ...state,
        // Remove original card, add split cards
        cards: [...state.cards.filter((c) => c.id !== action.id), ...newCards],
        nextZIndex: state.nextZIndex + newCards.length,
      };
    }

    case "MERGE_CARDS": {
      const source = state.cards.find((c) => c.id === action.sourceId);
      const target = state.cards.find((c) => c.id === action.targetId);
      if (!source || !target) return state;

      // Only merge same component types
      if (source.component !== target.component) return state;

      const config = SPLITTABLE_COMPONENTS[source.component];
      if (!config) return state;

      const sourceItems = source.props[config.itemsKey];
      const targetItems = target.props[config.itemsKey];
      if (!Array.isArray(sourceItems) || !Array.isArray(targetItems)) return state;

      // Merge items into target card, preserving all properties
      const mergedCard: CanvasCard = {
        ...target,
        props: {
          ...target.props,
          [config.itemsKey]: [...targetItems, ...sourceItems],
        },
        title: target.title || source.title || target.component.replace(/_/g, " "),
        // Preserve editable if either card was editable
        editable: target.editable || source.editable,
        // Keep target's fileId (since it's the surviving card)
        fileId: target.fileId,
        saveMethod: target.saveMethod,
        // Keep earliest sourceMessageId
        sourceMessageId: target.sourceMessageId || source.sourceMessageId,
        // Keep earliest createdAt
        createdAt: Math.min(target.createdAt, source.createdAt),
      };

      return {
        ...state,
        cards: state.cards
          .filter((c) => c.id !== action.sourceId && c.id !== action.targetId)
          .concat(mergedCard),
      };
    }

    case "REORDER_CARDS": {
      const sourceIndex = state.cards.findIndex((c) => c.id === action.sourceId);
      const targetIndex = state.cards.findIndex((c) => c.id === action.targetId);
      if (sourceIndex === -1 || targetIndex === -1) return state;

      // Move source card to target's position
      const newCards = [...state.cards];
      const [movedCard] = newCards.splice(sourceIndex, 1);
      newCards.splice(targetIndex, 0, movedCard);

      return {
        ...state,
        cards: newCards,
      };
    }

    case "UPDATE_CARD_PROPS": {
      return {
        ...state,
        cards: state.cards.map((c) => {
          if (c.id !== action.id) return c;
          const newProps = action.merge ? { ...c.props, ...action.props } : action.props;
          return {
            ...c,
            props: newProps,
            ...(action.component ? { component: action.component } : {}),
          };
        }),
      };
    }

    case "SELECT_CARD":
      return {
        ...state,
        cards: state.cards.map((c) => ({
          ...c,
          selected: c.id === action.id,
        })),
      };

    case "TOGGLE_SELECT_CARD":
      return {
        ...state,
        cards: state.cards.map((c) => ({
          ...c,
          selected: c.id === action.id ? !c.selected : c.selected,
        })),
      };

    case "DESELECT_CARD":
      return {
        ...state,
        cards: state.cards.map((c) => ({
          ...c,
          selected: false,
        })),
      };

    case "GROUP_CARDS": {
      const { cardIds } = action;
      if (cardIds.length < 2) return state;

      // Collect the cards to group (in the order specified)
      const groupedCards = cardIds
        .map((id) => state.cards.find((c) => c.id === id))
        .filter((c): c is CanvasCard => !!c);
      if (groupedCards.length < 2) return state;

      // Build children array for the layout component
      const children = groupedCards.map((c) => ({
        component: c.component,
        props: c.props,
      }));

      // Position: bounding box of all grouped cards
      const minX = Math.min(...groupedCards.map((c) => c.position.x));
      const minY = Math.min(...groupedCards.map((c) => c.position.y));
      const maxX = Math.max(...groupedCards.map((c) => c.position.x + c.size.width));
      const maxY = Math.max(...groupedCards.map((c) => c.position.y + c.size.height));

      const groupId = "group-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const groupCard: CanvasCard = {
        id: groupId,
        component: "layout",
        props: {
          children,
        },
        title: `Group (${groupedCards.length} items)`,
        position: { x: minX, y: minY },
        size: { width: Math.max(400, maxX - minX), height: Math.max(300, maxY - minY) },
        zIndex: state.nextZIndex,
        selected: false,
        minimized: false,
        createdAt: Date.now(),
      };

      // Remove grouped cards, add the new layout card
      const remainingCards = state.cards.filter((c) => !cardIds.includes(c.id));
      return {
        ...state,
        cards: [...remainingCards, groupCard],
        nextZIndex: state.nextZIndex + 1,
      };
    }

    case "SAVE_CARD":
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.id ? { ...c, savedName: action.savedName } : c
        ),
      };

    default:
      return state;
  }
}

/** Re-rank all cards starting from 1, preserving relative order (immutable). */
function normalizeZIndices(cards: CanvasState["cards"], frontId: string): { cards: CanvasCard[]; nextZIndex: number } {
  const sorted = [...cards].sort((a, b) => a.zIndex - b.zIndex);
  let z = 1;
  const normalizedCards = sorted.map((card) => ({
    ...card,
    zIndex: card.id === frontId ? cards.length + 1 : z++,
  }));
  return { cards: normalizedCards, nextZIndex: cards.length + 2 };
}

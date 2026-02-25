"use client";

import { useCallback, useState, useEffect, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Minus, X, Split, Merge } from "lucide-react";
import type { CanvasCard, CanvasAction } from "./types";
import { canSplitCard, canMergeCards } from "./types";

// CSS imports for react-grid-layout
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

// Layout types for react-grid-layout
// Using flexible types to accommodate react-grid-layout's complex type system
interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

type Layouts = Record<string, LayoutItem[]>;

// Dynamically import the wrapped ResponsiveGridLayout to avoid SSR issues
const ResponsiveGridLayout = dynamic(
  () => import("./ResponsiveGridWrapper"),
  {
    ssr: false,
    loading: () => <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading dashboard...</div>
  }
);

/** Convert card sizes to grid units (1 unit = ~100px) */
const GRID_ROW_HEIGHT = 80;
const GRID_COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };

interface DashboardGridProps {
  cards: CanvasCard[];
  dispatch: React.Dispatch<CanvasAction>;
  renderCard: (card: CanvasCard) => ReactNode;
  focusedCardId: string | null;
  streamingCardIds: Set<string>;
}

/** Convert pixel size to grid units */
function pxToGrid(px: number, rowHeight: number): number {
  return Math.max(2, Math.ceil(px / rowHeight));
}

/** Generate react-grid-layout Layout from cards */
function cardsToLayout(cards: CanvasCard[]): LayoutItem[] {
  return cards.map((card, index) => {
    // Convert pixel dimensions to grid units
    const w = Math.min(12, Math.max(3, Math.ceil(card.size.width / 100)));
    const h = pxToGrid(card.size.height, GRID_ROW_HEIGHT);

    // Auto-place in a flowing grid (2 columns for large cards, 3 for smaller)
    const colWidth = w >= 6 ? 6 : 4;
    const x = (index * colWidth) % 12;
    const y = Math.floor(index / (12 / colWidth)) * h;

    return {
      i: card.id,
      x: card.position?.x !== undefined && card.position.x >= 0 ? Math.floor(card.position.x / 100) : x,
      y: card.position?.y !== undefined && card.position.y >= 0 ? Math.floor(card.position.y / GRID_ROW_HEIGHT) : y,
      w,
      h,
      minW: 2,
      minH: 2,
    };
  });
}

export default function DashboardGrid({
  cards,
  dispatch,
  renderCard,
  focusedCardId,
  streamingCardIds,
}: DashboardGridProps) {
  const [layouts, setLayouts] = useState<Layouts>(() => ({ lg: cardsToLayout(cards) }));
  const isUpdatingRef = useRef(false);
  const prevCardIdsRef = useRef<string>("");
  const rafIdRef = useRef<number | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const lastOverlapCheckRef = useRef<number>(0);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      setDraggingCardId(null);
      setMergeTargetId(null);
    };
  }, []);

  // Update layouts only when cards are added/removed (not on position/size changes)
  useEffect(() => {
    const cardIds = cards.map(c => c.id).sort().join(",");
    if (cardIds === prevCardIdsRef.current) return; // No cards added/removed
    prevCardIdsRef.current = cardIds;

    setLayouts((prev: Layouts) => {
      const currentIds = new Set(cards.map((c) => c.id));
      const existingLayouts = prev.lg?.filter((l: LayoutItem) => currentIds.has(l.i)) || [];
      const existingIds = new Set(existingLayouts.map((l: LayoutItem) => l.i));

      // Add new cards
      const newCards = cards.filter((c) => !existingIds.has(c.id));
      if (newCards.length === 0 && existingLayouts.length === prev.lg?.length) {
        return prev; // No changes
      }
      const newLayouts = cardsToLayout(newCards);
      return { lg: [...existingLayouts, ...newLayouts] };
    });
  }, [cards]);

  const handleLayoutChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (currentLayout: any, allLayouts: any) => {
      if (isUpdatingRef.current) return;

      setLayouts(allLayouts);

      // Cancel any pending animation frame to prevent race conditions
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      // Update card positions and sizes in state (batch to avoid multiple re-renders)
      rafIdRef.current = requestAnimationFrame(() => {
        isUpdatingRef.current = true;
        currentLayout.forEach((layoutItem: LayoutItem) => {
          const card = cards.find((c) => c.id === layoutItem.i);
          if (card) {
            const newPosition = { x: layoutItem.x * 100, y: layoutItem.y * GRID_ROW_HEIGHT };
            const newSize = { width: layoutItem.w * 100, height: layoutItem.h * GRID_ROW_HEIGHT };

            // Only dispatch if changed significantly (avoid floating point issues)
            if (Math.abs(card.position.x - newPosition.x) > 1 || Math.abs(card.position.y - newPosition.y) > 1) {
              dispatch({ type: "MOVE_CARD", id: card.id, position: newPosition });
            }
            if (Math.abs(card.size.width - newSize.width) > 1 || Math.abs(card.size.height - newSize.height) > 1) {
              dispatch({ type: "RESIZE_CARD", id: card.id, size: newSize });
            }
          }
        });
        isUpdatingRef.current = false;
        rafIdRef.current = null;
      });
    },
    [cards, dispatch]
  );

  const handleClose = useCallback(
    (cardId: string) => {
      const el = document.getElementById(`card-${cardId}`);
      const iframe = el?.querySelector("iframe");
      if (iframe) iframe.srcdoc = "";
      dispatch({ type: "REMOVE_CARD", id: cardId });
    },
    [dispatch]
  );

  const handleMinimize = useCallback(
    (card: CanvasCard) => {
      dispatch({ type: card.minimized ? "RESTORE_CARD" : "MINIMIZE_CARD", id: card.id });
    },
    [dispatch]
  );

  const handleFocus = useCallback(
    (cardId: string) => {
      dispatch({ type: "FOCUS_CARD", id: cardId });
    },
    [dispatch]
  );

  const handleSplit = useCallback(
    (cardId: string) => {
      dispatch({ type: "SPLIT_CARD", id: cardId });
    },
    [dispatch]
  );

  const handleDragStart = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (_layout: any, _oldItem: any, newItem: any) => {
      setDraggingCardId(newItem.i);
    },
    []
  );

  const handleDrag = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (layout: any, _oldItem: any, newItem: any) => {
      // Throttle overlap detection to every 100ms to reduce jank
      const now = Date.now();
      if (now - lastOverlapCheckRef.current < 100) return;
      lastOverlapCheckRef.current = now;

      const draggingCard = cards.find((c) => c.id === newItem.i);
      if (!draggingCard) return;

      // Find adjacent cards that can be merged (within 1 grid unit)
      // react-grid-layout prevents overlap, so we check for adjacency
      let foundTarget: string | null = null;
      let closestDist = Infinity;

      for (const layoutItem of layout) {
        if (layoutItem.i === newItem.i) continue;

        // Calculate center-to-center distance
        const newCenterX = newItem.x + newItem.w / 2;
        const newCenterY = newItem.y + newItem.h / 2;
        const itemCenterX = layoutItem.x + layoutItem.w / 2;
        const itemCenterY = layoutItem.y + layoutItem.h / 2;

        // Check if edges are touching or very close (within 1 grid unit)
        const gapX = Math.max(0, Math.abs(newCenterX - itemCenterX) - (newItem.w + layoutItem.w) / 2);
        const gapY = Math.max(0, Math.abs(newCenterY - itemCenterY) - (newItem.h + layoutItem.h) / 2);

        // Cards are adjacent if gap is 0-1 grid units
        if (gapX <= 1 && gapY <= 1) {
          const dist = Math.sqrt(gapX * gapX + gapY * gapY);
          const targetCard = cards.find((c) => c.id === layoutItem.i);
          if (targetCard && canMergeCards(draggingCard, targetCard) && dist < closestDist) {
            closestDist = dist;
            foundTarget = layoutItem.i;
          }
        }
      }
      setMergeTargetId(foundTarget);
    },
    [cards]
  );

  const handleDragStop = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (_layout: any, _oldItem: any, _newItem: any) => {
      if (mergeTargetId && draggingCardId) {
        // Merge the cards
        dispatch({ type: "MERGE_CARDS", sourceId: draggingCardId, targetId: mergeTargetId });
      }
      setDraggingCardId(null);
      setMergeTargetId(null);
    },
    [dispatch, draggingCardId, mergeTargetId]
  );

  if (cards.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        <p>UI components will appear here when the bot renders them</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4 bg-background">
      <ResponsiveGridLayout
        className="dashboard-grid"
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={GRID_COLS}
        rowHeight={GRID_ROW_HEIGHT}
        onLayoutChange={handleLayoutChange}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragStop={handleDragStop}
        draggableHandle=".card-drag-handle"
        margin={[16, 16]}
        containerPadding={[0, 0]}
        isResizable={true}
        isDraggable={true}
        useCSSTransforms={true}
        resizeHandles={["s", "w", "e", "n", "sw", "nw", "se", "ne"]}
      >
        {cards.map((card) => (
          <div
            key={card.id}
            id={`card-${card.id}`}
            onClick={() => handleFocus(card.id)}
            className={`dashboard-card overflow-hidden transition-all group ${
              mergeTargetId === card.id
                ? "ring-2 ring-green-500 shadow-[0_0_16px_hsl(142_76%_36%/0.4)] scale-[1.02]"
                : streamingCardIds.has(card.id)
                  ? "ring-1 ring-primary/40 animate-pulse"
                  : card.id === focusedCardId
                    ? "ring-1 ring-primary/30"
                    : ""
            }`}
            style={{ position: "relative" }}
          >
            {/* Invisible drag handle - entire top edge, no visible UI */}
            <div className="card-drag-handle absolute top-0 left-0 right-8 h-3 cursor-grab active:cursor-grabbing z-10" />

            {/* Minimal controls - top right corner, only on hover */}
            <div className="absolute top-0 right-0 z-10 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
              {canSplitCard(card) && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleSplit(card.id); }}
                  className="w-5 h-5 flex items-center justify-center bg-black/40 hover:bg-black/60 text-white/80 hover:text-white transition-colors rounded-bl"
                  title="Split"
                >
                  <Split className="w-3 h-3" />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); handleMinimize(card); }}
                className="w-5 h-5 flex items-center justify-center bg-black/40 hover:bg-black/60 text-white/80 hover:text-white transition-colors"
                title={card.minimized ? "Restore" : "Minimize"}
              >
                <Minus className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleClose(card.id); }}
                className="w-5 h-5 flex items-center justify-center bg-black/40 hover:bg-red-500/80 text-white/80 hover:text-white transition-colors rounded-tr"
                title="Close"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Merge indicator overlay */}
            {mergeTargetId === card.id && (
              <div className="absolute inset-0 bg-green-500/10 flex items-center justify-center z-20 pointer-events-none">
                <div className="bg-green-500 text-white px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-1.5 shadow-lg">
                  <Merge className="w-4 h-4" />
                  Drop to merge
                </div>
              </div>
            )}

            {/* Card content - fills entire card */}
            {card.minimized ? (
              <button
                onClick={(e) => { e.stopPropagation(); handleMinimize(card); }}
                className="w-full h-full flex items-center justify-center gap-2 bg-secondary/50 hover:bg-secondary/70 transition-colors cursor-pointer"
                title="Click to restore"
              >
                <span className="text-xs text-muted-foreground truncate px-2">
                  {card.title || card.component.replace(/_/g, " ")}
                </span>
              </button>
            ) : (
              <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
                {renderCard(card)}
              </div>
            )}
          </div>
        ))}
      </ResponsiveGridLayout>

      <style jsx global>{`
        .dashboard-grid {
          min-height: 100%;
        }
        /* Grid items - card fills entire cell */
        .react-grid-item > .dashboard-card {
          position: absolute !important;
          inset: 0 !important;
        }
        .react-grid-item.react-grid-placeholder {
          background: hsl(var(--primary) / 0.2);
          border: 2px dashed hsl(var(--primary) / 0.5);
          border-radius: 0.75rem;
        }
        /* Reset all handle styles first */
        .react-grid-item > .react-resizable-handle {
          position: absolute !important;
          background: transparent !important;
          opacity: 0;
          transition: opacity 0.15s;
          z-index: 10;
        }
        .react-grid-item:hover > .react-resizable-handle {
          opacity: 1;
        }
        /* Corner handles */
        .react-grid-item > .react-resizable-handle-se,
        .react-grid-item > .react-resizable-handle-sw,
        .react-grid-item > .react-resizable-handle-ne,
        .react-grid-item > .react-resizable-handle-nw {
          width: 12px !important;
          height: 12px !important;
          background: hsl(var(--primary)) !important;
          border-radius: 2px;
        }
        .react-grid-item > .react-resizable-handle-se { bottom: 0 !important; right: 0 !important; cursor: se-resize; }
        .react-grid-item > .react-resizable-handle-sw { bottom: 0 !important; left: 0 !important; cursor: sw-resize; }
        .react-grid-item > .react-resizable-handle-ne { top: 0 !important; right: 0 !important; cursor: ne-resize; }
        .react-grid-item > .react-resizable-handle-nw { top: 0 !important; left: 0 !important; cursor: nw-resize; }
        /* Edge handles - east/west */
        .react-grid-item > .react-resizable-handle-e,
        .react-grid-item > .react-resizable-handle-w {
          width: 6px !important;
          height: 30px !important;
          top: 50% !important;
          transform: translateY(-50%);
          background: hsl(var(--primary) / 0.6) !important;
          border-radius: 3px;
        }
        .react-grid-item > .react-resizable-handle-e { right: 0 !important; left: auto !important; cursor: e-resize; }
        .react-grid-item > .react-resizable-handle-w { left: 0 !important; right: auto !important; cursor: w-resize; }
        /* Edge handles - north/south */
        .react-grid-item > .react-resizable-handle-n,
        .react-grid-item > .react-resizable-handle-s {
          width: 30px !important;
          height: 6px !important;
          left: 50% !important;
          transform: translateX(-50%);
          background: hsl(var(--primary) / 0.6) !important;
          border-radius: 3px;
        }
        .react-grid-item > .react-resizable-handle-n { top: 0 !important; bottom: auto !important; cursor: n-resize; }
        .react-grid-item > .react-resizable-handle-s { bottom: 0 !important; top: auto !important; cursor: s-resize; }
        /* Hover state */
        .react-grid-item > .react-resizable-handle:hover {
          background: hsl(var(--primary)) !important;
        }
        /* Hide the default ::after pseudo-element */
        .react-grid-item > .react-resizable-handle::after {
          display: none !important;
        }
      `}</style>
    </div>
  );
}

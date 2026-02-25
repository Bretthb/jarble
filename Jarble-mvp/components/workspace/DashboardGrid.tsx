"use client";

import { useCallback, useState, useEffect, type ReactNode } from "react";
import { Minus, X } from "lucide-react";
import type { CanvasCard, CanvasAction } from "./types";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

// Layout types for react-grid-layout
interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

type Layouts = { [key: string]: LayoutItem[] };

// Import react-grid-layout - ResponsiveGridLayout already includes width provider
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { ResponsiveGridLayout } = require("react-grid-layout");

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
  const [layouts, setLayouts] = useState<Layouts>({ lg: cardsToLayout(cards) });

  // Update layouts when cards change
  useEffect(() => {
    setLayouts((prev: Layouts) => {
      const currentIds = new Set(cards.map((c) => c.id));
      const existingLayouts = prev.lg?.filter((l: LayoutItem) => currentIds.has(l.i)) || [];
      const existingIds = new Set(existingLayouts.map((l: LayoutItem) => l.i));

      // Add new cards
      const newCards = cards.filter((c) => !existingIds.has(c.id));
      const newLayouts = cardsToLayout(newCards);

      return { lg: [...existingLayouts, ...newLayouts] };
    });
  }, [cards]);

  const handleLayoutChange = useCallback(
    (currentLayout: LayoutItem[], allLayouts: Layouts) => {
      setLayouts(allLayouts);

      // Update card positions and sizes in state
      currentLayout.forEach((layoutItem: LayoutItem) => {
        const card = cards.find((c) => c.id === layoutItem.i);
        if (card) {
          const newPosition = { x: layoutItem.x * 100, y: layoutItem.y * GRID_ROW_HEIGHT };
          const newSize = { width: layoutItem.w * 100, height: layoutItem.h * GRID_ROW_HEIGHT };

          // Only dispatch if changed
          if (card.position.x !== newPosition.x || card.position.y !== newPosition.y) {
            dispatch({ type: "MOVE_CARD", id: card.id, position: newPosition });
          }
          if (card.size.width !== newSize.width || card.size.height !== newSize.height) {
            dispatch({ type: "RESIZE_CARD", id: card.id, size: newSize });
          }
        }
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
        draggableHandle=".card-drag-handle"
        margin={[16, 16]}
        containerPadding={[0, 0]}
        isResizable={true}
        isDraggable={true}
        useCSSTransforms={true}
      >
        {cards.map((card) => (
          <div
            key={card.id}
            id={`card-${card.id}`}
            onClick={() => handleFocus(card.id)}
            className={`flex flex-col h-full rounded-xl border bg-background shadow-lg overflow-hidden transition-shadow ${
              streamingCardIds.has(card.id)
                ? "border-primary/50 shadow-[0_0_12px_hsl(var(--primary)/0.25)] animate-pulse"
                : card.id === focusedCardId
                  ? "border-primary/60 ring-1 ring-primary/30"
                  : "border-border/60"
            }`}
          >
            {/* Title bar */}
            <div className="card-drag-handle flex items-center justify-between px-3 h-8 shrink-0 bg-secondary/50 border-b border-border/40 cursor-grab active:cursor-grabbing select-none">
              <span className="text-xs font-medium text-muted-foreground truncate capitalize">
                {card.title || card.component.replace(/_/g, " ")}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMinimize(card);
                  }}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  title={card.minimized ? "Restore" : "Minimize"}
                >
                  <Minus className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClose(card.id);
                  }}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                  title="Close"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Card content */}
            {!card.minimized && (
              <div className="flex-1 overflow-auto p-3 [&>*]:h-full">
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
        .react-grid-item.react-grid-placeholder {
          background: hsl(var(--primary) / 0.2);
          border: 2px dashed hsl(var(--primary) / 0.5);
          border-radius: 0.75rem;
        }
        .react-grid-item > .react-resizable-handle {
          background: none;
          width: 12px;
          height: 12px;
        }
        .react-grid-item > .react-resizable-handle::after {
          content: "";
          position: absolute;
          right: 3px;
          bottom: 3px;
          width: 8px;
          height: 8px;
          border-right: 2px solid hsl(var(--muted-foreground) / 0.3);
          border-bottom: 2px solid hsl(var(--muted-foreground) / 0.3);
        }
        .react-grid-item:hover > .react-resizable-handle::after {
          border-color: hsl(var(--primary) / 0.5);
        }
      `}</style>
    </div>
  );
}

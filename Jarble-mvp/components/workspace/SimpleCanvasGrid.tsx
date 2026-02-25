"use client";

import { useCallback, useState, useRef, type ReactNode, type DragEvent } from "react";
import { X, Split, Merge, GripVertical } from "lucide-react";
import type { CanvasCard, CanvasAction } from "./types";
import { canSplitCard, canMergeCards } from "./types";

interface SimpleCanvasGridProps {
  cards: CanvasCard[];
  dispatch: React.Dispatch<CanvasAction>;
  renderCard: (card: CanvasCard) => ReactNode;
  focusedCardId: string | null;
  streamingCardIds: Set<string>;
}

export default function SimpleCanvasGrid({
  cards,
  dispatch,
  renderCard,
  focusedCardId,
  streamingCardIds,
}: SimpleCanvasGridProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const dragCounterRef = useRef(0);

  const handleClose = useCallback(
    (cardId: string) => {
      dispatch({ type: "REMOVE_CARD", id: cardId });
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

  const handleMerge = useCallback(
    (sourceId: string, targetId: string) => {
      dispatch({ type: "MERGE_CARDS", sourceId, targetId });
    },
    [dispatch]
  );

  // Drag and drop handlers
  const handleDragStart = useCallback((e: DragEvent<HTMLDivElement>, cardId: string) => {
    setDraggedId(cardId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", cardId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDropTargetId(null);
    dragCounterRef.current = 0;
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>, cardId: string) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (draggedId && cardId !== draggedId) {
      setDropTargetId(cardId);
    }
  }, [draggedId]);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDropTargetId(null);
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain");

    if (sourceId && sourceId !== targetId) {
      // Reorder cards - move source to target's position
      dispatch({ type: "REORDER_CARDS", sourceId, targetId });
    }

    setDraggedId(null);
    setDropTargetId(null);
    dragCounterRef.current = 0;
  }, [dispatch]);

  if (cards.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        <p>UI components will appear here when the bot renders them</p>
      </div>
    );
  }

  // Find mergeable pairs for showing merge buttons
  const getMergeableTarget = (card: CanvasCard): CanvasCard | undefined => {
    return cards.find(
      (other) => other.id !== card.id && canMergeCards(card, other)
    );
  };

  return (
    <div className="flex-1 overflow-auto p-4">
      {/* Simple responsive grid - cards flow naturally */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-min">
        {cards
          .filter((card) => !card.minimized)
          .map((card) => {
            const mergeTarget = getMergeableTarget(card);

            return (
              <div
                key={card.id}
                draggable
                onDragStart={(e) => handleDragStart(e, card.id)}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDragEnter={(e) => handleDragEnter(e, card.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, card.id)}
                onClick={() => handleFocus(card.id)}
                className={`relative group transition-all cursor-move ${
                  dropTargetId === card.id
                    ? "ring-2 ring-primary scale-[1.02] shadow-lg"
                    : draggedId === card.id
                      ? "opacity-50"
                      : streamingCardIds.has(card.id)
                        ? "ring-1 ring-primary/40 animate-pulse"
                        : card.id === focusedCardId
                          ? "ring-1 ring-primary/30"
                          : "hover:ring-1 hover:ring-border"
                }`}
              >
                {/* Drag handle indicator - top left */}
                <div className="absolute top-1 left-1 z-10 opacity-0 group-hover:opacity-60 transition-opacity pointer-events-none">
                  <GripVertical className="w-4 h-4 text-muted-foreground" />
                </div>

                {/* Minimal controls - top right corner, only on hover */}
                <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {canSplitCard(card) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSplit(card.id);
                      }}
                      className="w-6 h-6 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white/80 hover:text-white transition-colors rounded"
                      title="Split into individual cards"
                    >
                      <Split className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {mergeTarget && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMerge(card.id, mergeTarget.id);
                      }}
                      className="w-6 h-6 flex items-center justify-center bg-green-600/80 hover:bg-green-600 text-white/90 hover:text-white transition-colors rounded"
                      title={`Merge with ${mergeTarget.title || mergeTarget.component}`}
                    >
                      <Merge className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClose(card.id);
                    }}
                    className="w-6 h-6 flex items-center justify-center bg-black/50 hover:bg-red-500/80 text-white/80 hover:text-white transition-colors rounded"
                    title="Close"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Card content - renders at natural size */}
                {renderCard(card)}
              </div>
            );
          })}
      </div>
    </div>
  );
}

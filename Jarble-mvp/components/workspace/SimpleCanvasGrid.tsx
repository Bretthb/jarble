"use client";

import { useCallback, useState, useRef, useEffect, type ReactNode, type DragEvent } from "react";
import { X, Split, Merge, GripVertical, MousePointerClick, Bookmark, Loader2, Check } from "lucide-react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";
import type { CanvasCard, CanvasAction } from "./types";
import { canSplitCard, canMergeCards, DEFAULT_CARD_SIZES, DEFAULT_CARD_SIZE } from "./types";

const MIN_HEIGHT = 100;

/** Check if a card's size differs from its component default (i.e. user resized it). */
function isUserResized(card: CanvasCard): boolean {
  const def = DEFAULT_CARD_SIZES[card.component] || DEFAULT_CARD_SIZE;
  return card.size.width !== def.width || card.size.height !== def.height;
}

interface SimpleCanvasGridProps {
  cards: CanvasCard[];
  dispatch: React.Dispatch<CanvasAction>;
  renderCard: (card: CanvasCard) => ReactNode;
  focusedCardId: string | null;
  streamingCardIds: Set<string>;
  deploymentId: string;
}

export default function SimpleCanvasGrid({
  cards,
  dispatch,
  renderCard,
  focusedCardId,
  streamingCardIds,
  deploymentId,
}: SimpleCanvasGridProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const dragCounterRef = useRef(0);
  const gridRef = useRef<HTMLDivElement>(null);

  // ── Resize state ──────────────────────────────────────────────────────
  const [isResizing, setIsResizing] = useState(false);
  const [resizePreview, setResizePreview] = useState<{
    cardId: string;
    colSpan: number;
    height: number;
  } | null>(null);
  const resizeRef = useRef<{
    cardId: string;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    colWidth: number;
    maxCols: number;
  } | null>(null);

  // ── Save-to-library state ────────────────────────────────────────────
  const [savingCardId, setSavingCardId] = useState<string | null>(null);
  const [saveNameInput, setSaveNameInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<{ cardId: string; status: "saving" | "saved" | "error"; message?: string } | null>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);

  // Focus the save name input when it appears
  useEffect(() => {
    if (savingCardId && saveInputRef.current) {
      saveInputRef.current.focus();
    }
  }, [savingCardId]);

  // Clear save status after 2 seconds
  useEffect(() => {
    if (saveStatus?.status === "saved") {
      const timer = setTimeout(() => setSaveStatus(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [saveStatus]);

  const handleSaveClick = useCallback((card: CanvasCard) => {
    // If already in save-name-input mode for this card, cancel it
    if (savingCardId === card.id) {
      setSavingCardId(null);
      setSaveNameInput("");
      return;
    }
    // Open name input — default to card title or component type
    const defaultName = card.title || card.component.replace(/_/g, " ");
    setSaveNameInput(defaultName);
    setSavingCardId(card.id);
  }, [savingCardId]);

  const handleSaveConfirm = useCallback(async (card: CanvasCard) => {
    const name = saveNameInput.trim() || card.title || card.component;
    // Generate a file-safe ID from the name
    const fileId = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || `card-${Date.now()}`;

    setSaveStatus({ cardId: card.id, status: "saving" });
    setSavingCardId(null);
    setSaveNameInput("");

    try {
      const token = await getAccessTokenSilently();
      const res = await fetch(
        `${API_URL}/api/deployments/${deploymentId}/mcp/invoke`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            tool: "save_canvas_file",
            args: {
              fileId,
              component: card.component,
              props: card.props,
              name,
              description: card.title ? `Saved from canvas: ${card.title}` : "",
              tags: [card.component],
            },
          }),
        }
      );

      if (!res.ok) {
        throw new Error("Save failed");
      }

      const data = await res.json();
      if (data.result?.isError) {
        throw new Error(data.result.text || "Save failed");
      }

      // Mark card as saved in reducer
      dispatch({ type: "SAVE_CARD", id: card.id, savedName: name });
      setSaveStatus({ cardId: card.id, status: "saved" });
      console.log("[Jarble:SaveCard] Saved card", card.id, "as", fileId);
    } catch (err: any) {
      console.error("[Jarble:SaveCard] Failed to save:", err);
      setSaveStatus({ cardId: card.id, status: "error", message: err.message });
      // Clear error after 3 seconds
      setTimeout(() => setSaveStatus(null), 3000);
    }
  }, [saveNameInput, getAccessTokenSilently, deploymentId, dispatch]);

  // ── Existing card action handlers ─────────────────────────────────────
  const handleClose = useCallback(
    (cardId: string) => dispatch({ type: "REMOVE_CARD", id: cardId }),
    [dispatch]
  );

  const handleFocus = useCallback(
    (cardId: string) => dispatch({ type: "FOCUS_CARD", id: cardId }),
    [dispatch]
  );

  const handleSplit = useCallback(
    (cardId: string) => dispatch({ type: "SPLIT_CARD", id: cardId }),
    [dispatch]
  );

  const handleMerge = useCallback(
    (sourceId: string, targetId: string) =>
      dispatch({ type: "MERGE_CARDS", sourceId, targetId }),
    [dispatch]
  );

  const handleSelect = useCallback(
    (card: CanvasCard) => {
      if (card.selected) {
        dispatch({ type: "DESELECT_CARD" });
      } else {
        dispatch({ type: "SELECT_CARD", id: card.id });
      }
    },
    [dispatch]
  );

  // ── Drag-to-reorder handlers ─────────────────────────────────────────
  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>, cardId: string) => {
      setDraggedId(cardId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", cardId);
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDropTargetId(null);
    dragCounterRef.current = 0;
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>, cardId: string) => {
      e.preventDefault();
      dragCounterRef.current++;
      if (draggedId && cardId !== draggedId) {
        setDropTargetId(cardId);
      }
    },
    [draggedId]
  );

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDropTargetId(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>, targetId: string) => {
      e.preventDefault();
      const sourceId = e.dataTransfer.getData("text/plain");
      if (sourceId && sourceId !== targetId) {
        dispatch({ type: "REORDER_CARDS", sourceId, targetId });
      }
      setDraggedId(null);
      setDropTargetId(null);
      dragCounterRef.current = 0;
    },
    [dispatch]
  );

  // ── Resize handlers ──────────────────────────────────────────────────
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, card: CanvasCard) => {
      e.preventDefault();
      e.stopPropagation();

      const cardEl = (e.target as HTMLElement).closest(
        "[data-card-id]"
      ) as HTMLElement | null;
      const rect = cardEl?.getBoundingClientRect();
      const startW = rect?.width ?? card.size.width;
      const startH = rect?.height ?? card.size.height;

      // Measure actual grid column dimensions for accurate snapping
      let colWidth = 300;
      let maxCols = 4;
      if (gridRef.current) {
        const style = getComputedStyle(gridRef.current);
        const cols = style.gridTemplateColumns.split(" ");
        maxCols = cols.length;
        const gap = parseFloat(style.gap) || 16;
        colWidth = (gridRef.current.clientWidth - gap * (maxCols - 1)) / maxCols;
      }

      resizeRef.current = {
        cardId: card.id,
        startX: e.clientX,
        startY: e.clientY,
        startWidth: startW,
        startHeight: startH,
        colWidth,
        maxCols,
      };

      const currentSpan = Math.max(1, Math.min(maxCols, Math.round(startW / colWidth)));
      setResizePreview({ cardId: card.id, colSpan: currentSpan, height: startH });
      setIsResizing(true);
    },
    []
  );

  // Double-click resize handle to reset to default size
  const handleResizeReset = useCallback(
    (e: React.MouseEvent, cardId: string) => {
      e.preventDefault();
      e.stopPropagation();
      dispatch({ type: "RESET_CARD_SIZE", id: cardId });
    },
    [dispatch]
  );

  // Global mouse listeners while resizing
  useEffect(() => {
    if (!isResizing) return;

    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const newW = Math.max(200, r.startWidth + (e.clientX - r.startX));
      const newH = Math.max(MIN_HEIGHT, r.startHeight + (e.clientY - r.startY));
      const colSpan = Math.max(1, Math.min(r.maxCols, Math.round(newW / r.colWidth)));
      setResizePreview({ cardId: r.cardId, colSpan, height: newH });
    };

    const onUp = () => {
      const r = resizeRef.current;
      setResizePreview((prev) => {
        if (prev && r) {
          dispatch({
            type: "RESIZE_CARD",
            id: prev.cardId,
            size: {
              width: prev.colSpan * r.colWidth,
              height: prev.height,
            },
          });
        }
        return null;
      });
      resizeRef.current = null;
      setIsResizing(false);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isResizing, dispatch]);

  // ── Empty state ───────────────────────────────────────────────────────
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

  /** Compute column span from stored pixel width (approximate). */
  const getStoredColSpan = (card: CanvasCard): number => {
    // Approximate: measure grid if available, else use ~320px per col
    let colWidth = 320;
    if (gridRef.current) {
      const style = getComputedStyle(gridRef.current);
      const cols = style.gridTemplateColumns.split(" ");
      const gap = parseFloat(style.gap) || 16;
      colWidth = (gridRef.current.clientWidth - gap * (cols.length - 1)) / cols.length;
    }
    return Math.max(1, Math.min(4, Math.round(card.size.width / colWidth)));
  };

  return (
    <div className="flex-1 overflow-auto p-4">
      <div
        ref={gridRef}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-min"
      >
        {cards
          .filter((card) => !card.minimized)
          .map((card) => {
            const mergeTarget = getMergeableTarget(card);
            const isCardResizing = resizePreview?.cardId === card.id;
            const wasResized = isUserResized(card);

            // Column span: active resize preview > stored size > default (1)
            const colSpan = isCardResizing
              ? resizePreview.colSpan
              : wasResized
                ? getStoredColSpan(card)
                : 1;

            // Explicit height: active resize preview > stored size > natural
            const height = isCardResizing
              ? resizePreview.height
              : wasResized
                ? card.size.height
                : undefined;

            return (
              <div
                key={card.id}
                data-card-id={card.id}
                draggable={!isResizing}
                onDragStart={(e) => handleDragStart(e, card.id)}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDragEnter={(e) => handleDragEnter(e, card.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, card.id)}
                onClick={() => handleFocus(card.id)}
                style={{
                  ...(colSpan > 1 ? { gridColumn: `span ${colSpan}` } : {}),
                  ...(height != null ? { height } : {}),
                }}
                className={`relative group ${
                  isCardResizing ? "select-none" : "transition-all"
                } ${
                  isResizing && isCardResizing
                    ? "cursor-nwse-resize ring-2 ring-primary/50"
                    : "cursor-move"
                } ${
                  card.selected
                    ? "ring-2 ring-blue-500 shadow-md shadow-blue-500/20"
                    : dropTargetId === card.id
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
                {/* Saved indicator — always visible when card is saved */}
                {card.savedName && !savingCardId && saveStatus?.cardId !== card.id && (
                  <div className="absolute top-1 left-7 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 pointer-events-none">
                    <Bookmark className="w-3 h-3 text-amber-400 fill-amber-400" />
                    <span className="text-[10px] text-amber-300 font-medium max-w-[120px] truncate">
                      {card.savedName}
                    </span>
                  </div>
                )}

                {/* Save status toast — shows briefly after save */}
                {saveStatus?.cardId === card.id && (
                  <div className={`absolute top-1 left-7 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded pointer-events-none transition-all duration-300 ${
                    saveStatus.status === "saving"
                      ? "bg-blue-500/15 border border-blue-500/30"
                      : saveStatus.status === "saved"
                        ? "bg-green-500/15 border border-green-500/30"
                        : "bg-red-500/15 border border-red-500/30"
                  }`}>
                    {saveStatus.status === "saving" && <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
                    {saveStatus.status === "saved" && <Check className="w-3 h-3 text-green-400" />}
                    <span className={`text-[10px] font-medium ${
                      saveStatus.status === "saving" ? "text-blue-300" :
                      saveStatus.status === "saved" ? "text-green-300" : "text-red-300"
                    }`}>
                      {saveStatus.status === "saving" ? "Saving..." :
                       saveStatus.status === "saved" ? "Saved!" :
                       saveStatus.message || "Failed"}
                    </span>
                  </div>
                )}

                {/* Drag handle indicator - top left */}
                <div className="absolute top-1 left-1 z-10 opacity-0 group-hover:opacity-60 transition-opacity pointer-events-none">
                  <GripVertical className="w-4 h-4 text-muted-foreground" />
                </div>

                {/* Minimal controls - top right corner, only on hover (select button stays visible when selected) */}
                <div className={`absolute top-1 right-1 z-10 flex items-center gap-0.5 transition-opacity ${
                  card.selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelect(card);
                    }}
                    className={`w-6 h-6 flex items-center justify-center transition-colors rounded ${
                      card.selected
                        ? "bg-blue-500 hover:bg-blue-600 text-white"
                        : "bg-blue-500/60 hover:bg-blue-500/80 text-white/90 hover:text-white"
                    }`}
                    title={card.selected ? "Deselect card" : "Select card to reference in chat"}
                  >
                    <MousePointerClick className="w-3.5 h-3.5" />
                  </button>
                  {/* Save/bookmark button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSaveClick(card);
                    }}
                    className={`w-6 h-6 flex items-center justify-center transition-colors rounded ${
                      card.savedName
                        ? "bg-amber-500/80 hover:bg-amber-500 text-white"
                        : savingCardId === card.id
                          ? "bg-amber-500/80 text-white"
                          : "bg-black/50 hover:bg-amber-500/70 text-white/80 hover:text-white"
                    }`}
                    title={card.savedName ? `Saved as "${card.savedName}"` : "Save to library"}
                  >
                    <Bookmark className={`w-3.5 h-3.5 ${card.savedName ? "fill-current" : ""}`} />
                  </button>
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

                {/* Save name input — appears below controls when saving */}
                {savingCardId === card.id && (
                  <div
                    className="absolute top-8 right-1 z-20 flex items-center gap-1 animate-in fade-in slide-in-from-top-1 duration-150"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      ref={saveInputRef}
                      type="text"
                      value={saveNameInput}
                      onChange={(e) => setSaveNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleSaveConfirm(card);
                        } else if (e.key === "Escape") {
                          setSavingCardId(null);
                          setSaveNameInput("");
                        }
                      }}
                      placeholder="Name this component..."
                      className="w-44 h-7 px-2 text-xs rounded border border-border bg-background/95 backdrop-blur-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSaveConfirm(card);
                      }}
                      className="h-7 px-2 flex items-center justify-center bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium rounded transition-colors"
                    >
                      Save
                    </button>
                  </div>
                )}

                {/* Card content — scrolls if height is constrained */}
                <div className={height != null ? "h-full overflow-auto" : ""}>
                  {renderCard(card)}
                </div>

                {/* Resize handle — bottom right corner */}
                <div
                  onMouseDown={(e) => handleResizeStart(e, card)}
                  onDoubleClick={(e) => handleResizeReset(e, card.id)}
                  draggable={false}
                  className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity z-10"
                  title="Drag to resize (double-click to reset)"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="w-full h-full text-muted-foreground"
                    fill="currentColor"
                  >
                    <circle cx="12" cy="12" r="1.2" />
                    <circle cx="8" cy="12" r="1.2" />
                    <circle cx="12" cy="8" r="1.2" />
                    <circle cx="4" cy="12" r="1.2" />
                    <circle cx="8" cy="8" r="1.2" />
                    <circle cx="12" cy="4" r="1.2" />
                  </svg>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

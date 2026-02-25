"use client";

/**
 * FreeformCanvas — absolute-positioned, draggable, resizable card canvas.
 *
 * Cards are positioned freely (not in a grid). Users drag to move, drag
 * bottom-right handle to resize. Optional grid-snap toggle.
 * Keeps the same export name (SimpleCanvasGrid) so page.tsx doesn't change.
 */

import { useCallback, useState, useRef, useEffect, type ReactNode } from "react";
import { X, GripVertical, MousePointerClick, Bookmark, Loader2, Check, Grid3X3, SplitSquareHorizontal, Group } from "lucide-react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";
import type { CanvasCard, CanvasAction } from "./types";
import { canSplitCard } from "./types";
import ComponentGallery from "./ComponentGallery";

const MIN_WIDTH = 200;
const MIN_HEIGHT = 120;
const SNAP_SIZE = 20; // Grid snap increment in px

interface SimpleCanvasGridProps {
  cards: CanvasCard[];
  dispatch: React.Dispatch<CanvasAction>;
  renderCard: (card: CanvasCard) => ReactNode;
  focusedCardId: string | null;
  streamingCardIds: Set<string>;
  deploymentId: string;
  onHide?: () => void;
}

export default function SimpleCanvasGrid({
  cards,
  dispatch,
  renderCard,
  focusedCardId,
  streamingCardIds,
  deploymentId,
  onHide,
}: SimpleCanvasGridProps) {
  const { getAccessTokenSilently } = useAuth0();
  const canvasRef = useRef<HTMLDivElement>(null);

  // ── Interaction state ──────────────────────────────────────────────
  const [gridSnap, setGridSnap] = useState(false);
  const [dragging, setDragging] = useState<{ cardId: string; offsetX: number; offsetY: number } | null>(null);
  const [resizing, setResizing] = useState<{ cardId: string; startX: number; startY: number; startW: number; startH: number } | null>(null);
  const draggingRef = useRef(dragging);
  draggingRef.current = dragging;
  const resizingRef = useRef(resizing);
  resizingRef.current = resizing;

  // Live preview positions/sizes during drag/resize (avoids dispatching on every pixel)
  const [previewPos, setPreviewPos] = useState<{ x: number; y: number } | null>(null);
  const [previewSize, setPreviewSize] = useState<{ w: number; h: number } | null>(null);
  const previewPosRef = useRef(previewPos);
  previewPosRef.current = previewPos;
  const previewSizeRef = useRef(previewSize);
  previewSizeRef.current = previewSize;

  // ── Save-to-library state ──────────────────────────────────────────
  const [savingCardId, setSavingCardId] = useState<string | null>(null);
  const [saveNameInput, setSaveNameInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<{ cardId: string; status: "saving" | "saved" | "error"; message?: string } | null>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (errorTimerRef.current) clearTimeout(errorTimerRef.current); };
  }, []);

  useEffect(() => {
    if (savingCardId && saveInputRef.current) saveInputRef.current.focus();
  }, [savingCardId]);

  useEffect(() => {
    if (saveStatus?.status === "saved") {
      const t = setTimeout(() => setSaveStatus(null), 2000);
      return () => clearTimeout(t);
    }
  }, [saveStatus]);

  // ── Snap helper ────────────────────────────────────────────────────
  const snap = useCallback((v: number) => gridSnap ? Math.round(v / SNAP_SIZE) * SNAP_SIZE : v, [gridSnap]);

  // ── Drag handlers (pointer events for iframe reliability) ──────────
  const handleDragStart = useCallback((e: React.PointerEvent, card: CanvasCard) => {
    // Only start drag from the grip handle or card background, not buttons
    if ((e.target as HTMLElement).closest("button, input, a")) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging({ cardId: card.id, offsetX: e.clientX - card.position.x, offsetY: e.clientY - card.position.y });
    setPreviewPos(null);
    dispatch({ type: "BRING_TO_FRONT", id: card.id });
  }, [dispatch]);

  useEffect(() => {
    if (!dragging) return;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    const onMove = (e: PointerEvent) => {
      const d = draggingRef.current;
      if (!d) return;
      const x = snap(Math.max(0, e.clientX - d.offsetX));
      const y = snap(Math.max(0, e.clientY - d.offsetY));
      setPreviewPos({ x, y });
    };
    const onUp = () => {
      const d = draggingRef.current;
      const pos = previewPosRef.current;
      if (d && pos) {
        dispatch({ type: "MOVE_CARD", id: d.cardId, position: pos });
      }
      setDragging(null);
      setPreviewPos(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("blur", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("blur", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, dispatch, snap]);

  // ── Resize handlers ────────────────────────────────────────────────
  const handleResizeStart = useCallback((e: React.PointerEvent, card: CanvasCard) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setResizing({ cardId: card.id, startX: e.clientX, startY: e.clientY, startW: card.size.width, startH: card.size.height });
    setPreviewSize(null);
    dispatch({ type: "BRING_TO_FRONT", id: card.id });
  }, [dispatch]);

  useEffect(() => {
    if (!resizing) return;
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
    const onMove = (e: PointerEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      const w = snap(Math.max(MIN_WIDTH, r.startW + (e.clientX - r.startX)));
      const h = snap(Math.max(MIN_HEIGHT, r.startH + (e.clientY - r.startY)));
      setPreviewSize({ w, h });
    };
    const onUp = () => {
      const r = resizingRef.current;
      const size = previewSizeRef.current;
      if (r && size) {
        dispatch({ type: "RESIZE_CARD", id: r.cardId, size: { width: size.w, height: size.h } });
      }
      setResizing(null);
      setPreviewSize(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    const onBlur = () => onUp();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("blur", onBlur);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resizing, dispatch, snap]);

  // ── Card action handlers ───────────────────────────────────────────
  const handleClose = useCallback((id: string) => dispatch({ type: "REMOVE_CARD", id }), [dispatch]);
  const handleSelect = useCallback((card: CanvasCard) => {
    dispatch({ type: "TOGGLE_SELECT_CARD", id: card.id });
  }, [dispatch]);
  const handleSplit = useCallback((card: CanvasCard) => {
    dispatch({ type: "SPLIT_CARD", id: card.id });
  }, [dispatch]);
  const handleGroup = useCallback(() => {
    const selectedIds = cards.filter((c) => c.selected).map((c) => c.id);
    if (selectedIds.length >= 2) {
      dispatch({ type: "GROUP_CARDS", cardIds: selectedIds });
    }
  }, [cards, dispatch]);

  const handleSaveClick = useCallback((card: CanvasCard) => {
    if (savingCardId === card.id) { setSavingCardId(null); setSaveNameInput(""); return; }
    setSaveNameInput(card.title || card.component.replace(/_/g, " "));
    setSavingCardId(card.id);
  }, [savingCardId]);

  const handleSaveConfirm = useCallback(async (card: CanvasCard) => {
    const name = saveNameInput.trim() || card.title || card.component;
    const fileId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || `card-${Date.now()}`;
    setSaveStatus({ cardId: card.id, status: "saving" });
    setSavingCardId(null);
    setSaveNameInput("");
    try {
      const token = await getAccessTokenSilently();
      const res = await fetch(`${API_URL}/api/deployments/${deploymentId}/mcp/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tool: "save_canvas_file", args: { fileId, component: card.component, props: card.props, name, description: card.title ? `Saved from canvas: ${card.title}` : "", tags: [card.component] } }),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json();
      if (data.result?.isError) throw new Error(data.result.text || "Save failed");
      dispatch({ type: "SAVE_CARD", id: card.id, savedName: name });
      setSaveStatus({ cardId: card.id, status: "saved" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Save failed";
      setSaveStatus({ cardId: card.id, status: "error", message });
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setSaveStatus(null), 3000);
    }
  }, [saveNameInput, getAccessTokenSilently, deploymentId, dispatch]);

  // ── Empty state ────────────────────────────────────────────────────
  if (cards.length === 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar — always visible */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-background z-10 relative">
          {onHide && (
            <button onClick={onHide} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors" title="Hide canvas">
              <X className="w-3.5 h-3.5" />
              Hide
            </button>
          )}
          <ComponentGallery deploymentId={deploymentId} cards={cards} dispatch={dispatch} />
          <span className="text-[10px] text-muted-foreground/50 ml-auto">0 components</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
          <div className="w-12 h-12 rounded-xl bg-secondary/50 border border-border/40 flex items-center justify-center">
            <Grid3X3 className="w-6 h-6 text-muted-foreground/50" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-foreground/70">Canvas</p>
            <p className="text-xs text-muted-foreground/60">Components will appear here when the bot renders them.</p>
            <p className="text-xs text-muted-foreground/60">Or load saved components from your <strong>Library</strong> above.</p>
          </div>
        </div>
      </div>
    );
  }

  const isInteracting = !!dragging || !!resizing;
  const selectedCards = cards.filter((c) => c.selected);
  const selectedCount = selectedCards.length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-background z-10 relative">
        {onHide && (
          <button onClick={onHide} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors" title="Hide canvas">
            <X className="w-3.5 h-3.5" />
            Hide
          </button>
        )}
        <button
          onClick={() => setGridSnap((v) => !v)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
            gridSnap ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          }`}
          title={`Grid snap: ${gridSnap ? "ON" : "OFF"} (${SNAP_SIZE}px)`}
        >
          <Grid3X3 className="w-3.5 h-3.5" />
          Snap
        </button>
        <ComponentGallery deploymentId={deploymentId} cards={cards} dispatch={dispatch} />

        {/* Multi-select group action */}
        {selectedCount >= 2 && (
          <>
            <div className="w-px h-4 bg-border/50" />
            <span className="text-[11px] text-blue-400 font-medium">{selectedCount} selected</span>
            <button
              onClick={handleGroup}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors"
              title="Group selected cards into a layout"
            >
              <Group className="w-3.5 h-3.5" />
              Group
            </button>
            <button
              onClick={() => dispatch({ type: "DESELECT_CARD" })}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              title="Deselect all"
            >
              <X className="w-3 h-3" />
            </button>
          </>
        )}

        <span className="text-[10px] text-muted-foreground/50 ml-auto">{cards.length} component{cards.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Canvas area */}
      <div
        ref={canvasRef}
        className="flex-1 overflow-auto relative"
        style={{
          // Dot grid background
          backgroundImage: gridSnap
            ? `radial-gradient(circle, hsl(var(--border) / 0.3) 1px, transparent 1px)`
            : `radial-gradient(circle, hsl(var(--border) / 0.15) 1px, transparent 1px)`,
          backgroundSize: `${SNAP_SIZE}px ${SNAP_SIZE}px`,
        }}
      >
        {/* Spacer to make the canvas scrollable beyond the last card */}
        <div style={{ width: Math.max(1200, ...cards.map(c => c.position.x + c.size.width + 100)), height: Math.max(800, ...cards.map(c => c.position.y + c.size.height + 100)) }} />

        {cards.filter(c => !c.minimized).map((card) => {
          const isDragging = dragging?.cardId === card.id;
          const isResizingCard = resizing?.cardId === card.id;

          // Use preview position/size during interaction, otherwise stored values
          const x = isDragging && previewPos ? previewPos.x : card.position.x;
          const y = isDragging && previewPos ? previewPos.y : card.position.y;
          const w = isResizingCard && previewSize ? previewSize.w : card.size.width;
          const h = isResizingCard && previewSize ? previewSize.h : card.size.height;

          return (
            <div
              key={card.id}
              data-card-id={card.id}
              onPointerDown={(e) => handleDragStart(e, card)}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: w,
                height: h,
                zIndex: card.zIndex,
              }}
              className={`group rounded-lg border bg-background/95 backdrop-blur-sm shadow-sm overflow-hidden flex flex-col ${
                isInteracting && (isDragging || isResizingCard) ? "select-none" : "transition-shadow"
              } ${
                card.selected
                  ? "ring-2 ring-blue-500 shadow-md shadow-blue-500/20 border-blue-500/40"
                  : isDragging
                    ? "shadow-xl border-primary/40 cursor-grabbing"
                    : streamingCardIds.has(card.id)
                      ? "ring-1 ring-primary/40 animate-pulse border-primary/30"
                      : card.id === focusedCardId
                        ? "ring-1 ring-primary/30 border-primary/20"
                        : "border-border/60 hover:shadow-md hover:border-border cursor-grab"
              }`}
            >
              {/* Card header — drag handle + controls */}
              <div className="shrink-0 flex items-center justify-between px-2 py-1 border-b border-border/30 bg-secondary/20">
                <div className="flex items-center gap-1.5 min-w-0">
                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 cursor-grab" />
                  <span className="text-[11px] text-muted-foreground truncate">
                    {card.title || card.component.replace(/_/g, " ")}
                  </span>
                  {/* Saved badge */}
                  {card.savedName && (
                    <span className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-amber-500/15 border border-amber-500/30">
                      <Bookmark className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                      <span className="text-[9px] text-amber-300 font-medium max-w-[80px] truncate">{card.savedName}</span>
                    </span>
                  )}
                  {/* Save status */}
                  {saveStatus?.cardId === card.id && (
                    <span className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium ${
                      saveStatus.status === "saving" ? "text-blue-300 bg-blue-500/15" :
                      saveStatus.status === "saved" ? "text-green-300 bg-green-500/15" : "text-red-300 bg-red-500/15"
                    }`}>
                      {saveStatus.status === "saving" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                      {saveStatus.status === "saved" && <Check className="w-2.5 h-2.5" />}
                      {saveStatus.status === "saving" ? "Saving..." : saveStatus.status === "saved" ? "Saved!" : saveStatus.message || "Failed"}
                    </span>
                  )}
                </div>

                {/* Controls */}
                <div className={`flex items-center gap-0.5 shrink-0 transition-opacity ${
                  card.selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}>
                  <button onClick={(e) => { e.stopPropagation(); handleSelect(card); }}
                    className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
                      card.selected ? "bg-blue-500 text-white" : "hover:bg-blue-500/60 text-muted-foreground hover:text-white"
                    }`} title={card.selected ? "Deselect" : "Select (multi-select to group)"}>
                    <MousePointerClick className="w-3 h-3" />
                  </button>
                  {canSplitCard(card) && (
                    <button onClick={(e) => { e.stopPropagation(); handleSplit(card); }}
                      className="w-5 h-5 flex items-center justify-center rounded transition-colors hover:bg-violet-500/60 text-muted-foreground hover:text-white"
                      title="Split into individual cards">
                      <SplitSquareHorizontal className="w-3 h-3" />
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); handleSaveClick(card); }}
                    className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
                      card.savedName ? "bg-amber-500/80 text-white" : "hover:bg-amber-500/60 text-muted-foreground hover:text-white"
                    }`} title={card.savedName ? `Saved as "${card.savedName}"` : "Save to library"}>
                    <Bookmark className={`w-3 h-3 ${card.savedName ? "fill-current" : ""}`} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleClose(card.id); }}
                    className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:bg-red-500/60 hover:text-white transition-colors"
                    title="Close">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Save name input */}
              {savingCardId === card.id && (
                <div className="shrink-0 flex items-center gap-1 px-2 py-1 bg-secondary/30 border-b border-border/30"
                  onPointerDown={(e) => e.stopPropagation()}>
                  <input ref={saveInputRef} type="text" value={saveNameInput}
                    onChange={(e) => setSaveNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveConfirm(card);
                      else if (e.key === "Escape") { setSavingCardId(null); setSaveNameInput(""); }
                    }}
                    placeholder="Name this component..."
                    className="flex-1 h-6 px-2 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  <button onClick={(e) => { e.stopPropagation(); handleSaveConfirm(card); }}
                    className="h-6 px-2 text-xs font-medium rounded bg-amber-500 hover:bg-amber-600 text-white transition-colors">
                    Save
                  </button>
                </div>
              )}

              {/* Card content — fills remaining space */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {renderCard(card)}
              </div>

              {/* Resize handle — bottom right */}
              <div
                onPointerDown={(e) => handleResizeStart(e, card)}
                className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity z-10"
                title="Drag to resize"
              >
                <svg viewBox="0 0 16 16" className="w-full h-full text-muted-foreground" fill="currentColor">
                  <circle cx="12" cy="12" r="1.2" />
                  <circle cx="8" cy="12" r="1.2" />
                  <circle cx="12" cy="8" r="1.2" />
                </svg>
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}

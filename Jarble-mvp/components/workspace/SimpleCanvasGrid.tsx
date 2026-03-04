"use client";

/**
 * FreeformCanvas — absolute-positioned, draggable, resizable card canvas.
 *
 * Cards are positioned freely (not in a grid). Users drag to move, drag
 * bottom-right handle to resize. Optional grid-snap toggle.
 * Keeps the same export name (SimpleCanvasGrid) so page.tsx doesn't change.
 */

import { memo, useCallback, useState, useRef, useEffect, type ReactNode, type KeyboardEvent } from "react";
import { X, GripVertical, MousePointerClick, Bookmark, Loader2, Check, Grid3X3, SplitSquareHorizontal, Group, LayoutGrid, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";
import type { CanvasCard, CanvasAction, CanvasState } from "./types";
import { canSplitCard } from "./types";
import ComponentGallery from "./ComponentGallery";
import CanvasToolbar from "./CanvasToolbar";

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
  dashboardGroups: CanvasState["dashboardGroups"];
}

function SimpleCanvasGridInner({
  cards,
  dispatch,
  renderCard,
  focusedCardId,
  streamingCardIds,
  deploymentId,
  onHide,
  dashboardGroups,
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

  // ── Keyboard navigation state ────────────────────────────────────
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // ── Card entrance animation tracking ──────────────────────────────
  // Cards already "seen" should not animate in (e.g. after RESTORE_STATE or initial mount).
  // We seed the set with current card IDs on mount so restored cards appear instantly.
  const seenCardIdsRef = useRef<Set<string>>(new Set(cards.map((c) => c.id)));

  // On every render, mark all current card IDs as seen (so only the first
  // render of a card can trigger an entrance animation).
  useEffect(() => {
    for (const c of cards) {
      seenCardIdsRef.current.add(c.id);
    }
  });

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

  // ── Keyboard navigation handler ───────────────────────────────────
  const visibleCards = cards.filter(c => !c.minimized);
  const handleGridKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const count = visibleCards.length;
    if (count === 0) return;

    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown": {
        e.preventDefault();
        const next = focusedIndex < count - 1 ? focusedIndex + 1 : 0;
        setFocusedIndex(next);
        const card = visibleCards[next];
        if (card) cardRefs.current.get(card.id)?.focus();
        break;
      }
      case "ArrowLeft":
      case "ArrowUp": {
        e.preventDefault();
        const prev = focusedIndex > 0 ? focusedIndex - 1 : count - 1;
        setFocusedIndex(prev);
        const card = visibleCards[prev];
        if (card) cardRefs.current.get(card.id)?.focus();
        break;
      }
      case "Escape": {
        e.preventDefault();
        setFocusedIndex(-1);
        canvasRef.current?.focus();
        break;
      }
    }
  }, [focusedIndex, visibleCards]);

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
        const movedCard = cards.find(c => c.id === d.cardId);
        if (movedCard) {
          setLiveAnnouncement(`Card "${movedCard.title || movedCard.component.replace(/_/g, " ")}" moved to position ${Math.round(pos.x)}, ${Math.round(pos.y)}`);
        }
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
        <CanvasToolbar
          cards={cards}
          dispatch={dispatch}
          deploymentId={deploymentId}
          mode="freeform"
          onHide={onHide}
          gridSnap={gridSnap}
          onToggleGridSnap={() => setGridSnap((v) => !v)}
        />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
          <div className="w-12 h-12 rounded-xl bg-secondary/50 border border-border/40 flex items-center justify-center">
            <Grid3X3 className="w-6 h-6 text-muted-foreground/50" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-foreground/70">Canvas</p>
            <p className="text-xs text-muted-foreground-subtle">Components will appear here when the bot renders them.</p>
            <p className="text-xs text-muted-foreground-subtle">Or load saved components from your <strong>Library</strong> above.</p>
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
      {/* Streaming card glow animation (CSS for performance) */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes canvas-streaming-glow {
          0%, 100% { box-shadow: 0 0 6px 0 hsl(var(--primary) / 0.2); }
          50% { box-shadow: 0 0 14px 2px hsl(var(--primary) / 0.35); }
        }
        .canvas-card-streaming {
          animation: canvas-streaming-glow 2s ease-in-out infinite;
        }
      `}} />
      {/* Toolbar */}
      <CanvasToolbar
        cards={cards}
        dispatch={dispatch}
        deploymentId={deploymentId}
        mode="freeform"
        onHide={onHide}
        gridSnap={gridSnap}
        onToggleGridSnap={() => setGridSnap((v) => !v)}
        onOrganize={() => {
          const w = canvasRef.current?.clientWidth ?? window.innerWidth - 400;
          dispatch({ type: "TIDY_LAYOUT", containerWidth: w });
        }}
      />

      {/* Aria live region for reorder announcements */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnouncement}
      </div>

      {/* Canvas area */}
      <div
        ref={canvasRef}
        role="grid"
        aria-label="Canvas cards"
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
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

        {/* Dashboard group frames — rendered behind cards */}
        {Object.entries(dashboardGroups).map(([groupId, meta]) => {
          const groupCards = meta.cardIds
            .map(id => cards.find(c => c.id === id))
            .filter((c): c is CanvasCard => !!c && !c.minimized);
          if (groupCards.length === 0) return null;
          const PAD = 12;
          const TITLE_H = 28;
          const minX = Math.min(...groupCards.map(c => c.position.x)) - PAD;
          const minY = Math.min(...groupCards.map(c => c.position.y)) - PAD - TITLE_H;
          const maxX = Math.max(...groupCards.map(c => c.position.x + c.size.width)) + PAD;
          const maxY = Math.max(...groupCards.map(c => c.position.y + c.size.height)) + PAD;
          return (
            <div
              key={`group-${groupId}`}
              className="absolute border border-border/40 rounded-lg overflow-hidden pointer-events-none"
              style={{ left: minX, top: minY, width: maxX - minX, height: maxY - minY, zIndex: 0 }}
            >
              <div className="flex items-center justify-between px-3 py-1 bg-muted/30 border-b border-border/30 pointer-events-auto">
                <span className="text-xs font-medium text-foreground/80">{meta.title}</span>
                <button
                  onClick={() => dispatch({ type: "UNGROUP_DASHBOARD", groupId })}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Ungroup
                </button>
              </div>
            </div>
          );
        })}

        <AnimatePresence>
        {cards.filter(c => !c.minimized).map((card) => {
          const isDragging = dragging?.cardId === card.id;
          const isResizingCard = resizing?.cardId === card.id;

          // Use preview position/size during interaction, otherwise stored values
          const x = isDragging && previewPos ? previewPos.x : card.position.x;
          const y = isDragging && previewPos ? previewPos.y : card.position.y;
          const w = isResizingCard && previewSize ? previewSize.w : card.size.width;
          const h = isResizingCard && previewSize ? previewSize.h : card.size.height;

          // Only animate entrance for cards not yet "seen" (new ADD_CARD cards).
          // Cards from RESTORE_STATE or already present at mount appear instantly.
          const isNew = !seenCardIdsRef.current.has(card.id);
          const isStreaming = streamingCardIds.has(card.id);

          const cardIndex = visibleCards.indexOf(card);

          return (
            <motion.div
              key={card.id}
              layout="position"
              ref={(el) => { if (el) cardRefs.current.set(card.id, el); else cardRefs.current.delete(card.id); }}
              role="gridcell"
              aria-label={card.title || card.component.replace(/_/g, " ")}
              aria-grabbed={isDragging}
              aria-dropeffect={dragging && !isDragging ? "move" : undefined}
              tabIndex={cardIndex === focusedIndex ? 0 : -1}
              onFocus={() => setFocusedIndex(cardIndex)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  dispatch({ type: "TOGGLE_SELECT_CARD", id: card.id });
                }
              }}
              initial={isNew ? { opacity: 0, scale: 0.95 } : false}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
              transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
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
              className={`group rounded-lg overflow-hidden flex flex-col ${
                isInteracting && (isDragging || isResizingCard) ? "select-none" : "transition-shadow"
              } ${
                card.selected
                  ? "ring-2 ring-blue-500 shadow-md shadow-blue-500/20"
                  : isDragging
                    ? "shadow-xl ring-1 ring-primary/40 cursor-grabbing"
                    : isStreaming
                      ? "ring-1 ring-primary/50 shadow-md canvas-card-streaming"
                      : card.id === focusedCardId
                        ? "ring-1 ring-primary/20"
                        : "hover:ring-1 hover:ring-border/50 cursor-grab"
              }`}
            >
              {/* Card header — always partially visible, full on hover/focus */}
              <div className="shrink-0 flex items-center justify-between px-2 py-0.5 opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity absolute top-0 left-0 right-0 z-20 bg-background/80 backdrop-blur-sm">
                <div className="flex items-center gap-1.5 min-w-0">
                  <GripVertical className="w-3 h-3 text-muted-foreground/40 shrink-0 cursor-grab" />
                  <span className="text-[10px] text-muted-foreground-subtle truncate">
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
                  card.selected ? "opacity-100" : "opacity-40 group-hover:opacity-100 group-focus-within:opacity-100"
                }`}>
                  <button onClick={(e) => { e.stopPropagation(); handleSelect(card); }}
                    className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                      card.selected ? "bg-blue-500 text-white" : "hover:bg-blue-500/60 text-muted-foreground hover:text-white"
                    }`} aria-label={card.selected ? "Deselect" : "Select (multi-select to group)"} title={card.selected ? "Deselect" : "Select (multi-select to group)"}>
                    <MousePointerClick className="w-3.5 h-3.5" />
                  </button>
                  {canSplitCard(card) && (
                    <button onClick={(e) => { e.stopPropagation(); handleSplit(card); }}
                      className="w-7 h-7 flex items-center justify-center rounded transition-colors hover:bg-violet-500/60 text-muted-foreground hover:text-white"
                      aria-label="Split into individual cards" title="Split into individual cards">
                      <SplitSquareHorizontal className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); handleSaveClick(card); }}
                    className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                      card.savedName ? "bg-amber-500/80 text-white" : "hover:bg-amber-500/60 text-muted-foreground hover:text-white"
                    }`} aria-label={card.savedName ? `Saved as "${card.savedName}"` : "Save to library"} title={card.savedName ? `Saved as "${card.savedName}"` : "Save to library"}>
                    <Bookmark className={`w-3.5 h-3.5 ${card.savedName ? "fill-current" : ""}`} />
                  </button>
                  {/* Pin / Unpin */}
                  <button
                    className="w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-accent text-muted-foreground-subtle hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({
                        type: card.pinned ? "UNPIN_CARD" : "PIN_CARD",
                        id: card.id,
                      });
                    }}
                    title={card.pinned ? "Unpin card" : "Pin card"}
                    aria-label={card.pinned ? "Unpin card" : "Pin card"}
                  >
                    <Pin className={cn("w-4 h-4", card.pinned && "fill-current")} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleClose(card.id); }}
                    className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:bg-red-500/60 hover:text-white transition-colors"
                    aria-label="Close card" title="Close">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Save name input — overlay below header */}
              {savingCardId === card.id && (
                <div className="absolute top-6 left-0 right-0 z-20 flex items-center gap-1 px-2 py-1 bg-background/90 backdrop-blur-sm border-b border-border/20"
                  onPointerDown={(e) => e.stopPropagation()}>
                  <input ref={saveInputRef} type="text" value={saveNameInput}
                    onChange={(e) => setSaveNameInput(e.target.value)}
                    aria-label="Component name"
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

              {/* Props-lost banner — shown for cards whose data was stripped during persistence */}
              {card.propsLost && (
                <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs">
                  <span>Data lost on reload</span>
                  <button
                    className="ml-auto text-xs underline hover:no-underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: "REMOVE_CARD", id: card.id });
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}

              {/* Card content — fills entire card */}
              <div className="flex-1 min-h-0 overflow-hidden rounded-lg">
                {renderCard(card)}
              </div>

              {/* Resize handle — bottom right */}
              <div
                onPointerDown={(e) => handleResizeStart(e, card)}
                role="slider"
                aria-label="Resize card"
                aria-valuemin={MIN_WIDTH}
                aria-valuemax={2000}
                aria-valuenow={w}
                tabIndex={-1}
                className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize opacity-40 group-hover:opacity-60 group-focus-within:opacity-60 hover:!opacity-80 transition-opacity z-10"
                title="Drag to resize"
              >
                <svg viewBox="0 0 16 16" className="w-full h-full text-muted-foreground" fill="currentColor">
                  <circle cx="12" cy="12" r="1" />
                  <circle cx="8" cy="12" r="1" />
                  <circle cx="12" cy="8" r="1" />
                </svg>
              </div>

            </motion.div>
          );
        })}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default memo(SimpleCanvasGridInner);

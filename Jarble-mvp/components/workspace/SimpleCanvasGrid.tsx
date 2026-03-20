"use client";

/**
 * FreeformCanvas — absolute-positioned, draggable, resizable card canvas.
 *
 * Cards are positioned freely (not in a grid). Users drag to move, drag
 * bottom-right handle to resize. Optional grid-snap toggle.
 * Keeps the same export name (SimpleCanvasGrid) so page.tsx doesn't change.
 */

import { memo, useCallback, useState, useRef, useEffect, type ReactNode, type KeyboardEvent } from "react";
import { X, MousePointerClick, Bookmark, Loader2, Check, Grid3X3, SplitSquareHorizontal, Ungroup, Upload, ZoomIn, ZoomOut, Sparkles, SendHorizontal, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";
import type { CanvasCard, CanvasAction, CanvasState } from "./types";
import { canSplitCard } from "./types";
import CanvasToolbar from "./CanvasToolbar";
import DrawingLayer from "./drawing/DrawingLayer";
import { useDrawing } from "./drawing/useDrawing";
import SelectionBranch from "./SelectionBranch";
import PromptOverlay from "./PromptOverlay";

const MIN_WIDTH = 200;
const MIN_HEIGHT = 120;
const SNAP_SIZE = 20; // Grid snap increment in px
const MIN_CARD_Y = 8; // Keep cards below toolbar edge
const AUTO_HEIGHT_PADDING = 16; // Extra padding below content for auto-height

interface SimpleCanvasGridProps {
  cards: CanvasCard[];
  dispatch: React.Dispatch<CanvasAction>;
  renderCard: (card: CanvasCard) => ReactNode;
  focusedCardId: string | null;
  streamingCardIds: Set<string>;
  deploymentId: string;
  onHide?: () => void;
  dashboardGroups: CanvasState["dashboardGroups"];
  zoom?: number;
  /** Optional: send a message from inline card chat */
  onSendMessage?: (text: string, displayText?: string, mode?: "edit" | "branch") => Promise<void>;
  /** Whether the chat is currently streaming */
  isChatStreaming?: boolean;
  /** Drawing strokes persisted in canvas state */
  strokes?: CanvasState["strokes"];
}

function SimpleCanvasGridInner({
  cards,
  dispatch,
  renderCard,
  focusedCardId,
  streamingCardIds,
  deploymentId,
  onHide,
  dashboardGroups = {},
  zoom = 1,
  onSendMessage,
  isChatStreaming = false,
  strokes = [],
}: SimpleCanvasGridProps) {
  const { getAccessTokenSilently } = useAuth0();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  // ── Drawing state ────────────────────────────────────────────────
  const drawing = useDrawing(dispatch);

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

  // ── Inline card chat state ────────────────────────────────────────
  const [inlineChatCardId, setInlineChatCardId] = useState<string | null>(null);
  const [inlineChatInput, setInlineChatInput] = useState("");
  const inlineChatRef = useRef<HTMLInputElement>(null);

  // ── Save-to-library state ──────────────────────────────────────────
  const [savingCardId, setSavingCardId] = useState<string | null>(null);
  const [saveNameInput, setSaveNameInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<{ cardId: string; status: "saving" | "saved" | "error"; message?: string } | null>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [unsavingCardId, setUnsavingCardId] = useState<string | null>(null);

  // ── Card context menu state ──────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{ cardId: string; x: number; y: number } | null>(null);

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("contextmenu", close); };
  }, [contextMenu]);

  // ── Keyboard navigation state ────────────────────────────────────
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // ── Auto-height: single ResizeObserver for content-driven card sizing ────
  // Uses a single observer instance + data attributes to avoid callback ref churn.
  const autoHeightObserverRef = useRef<ResizeObserver | null>(null);
  const lastAutoHeightRef = useRef<Map<string, number>>(new Map());
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // Create the single observer once on mount
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const cardId = el.dataset.autoHeightId;
        if (!cardId) continue;

        // Measure the first child's height to avoid flex feedback loop
        const firstChild = el.firstElementChild as HTMLElement | null;
        const contentH = (firstChild?.offsetHeight ?? el.scrollHeight) + AUTO_HEIGHT_PADDING;

        // Deduplicate: skip if we already dispatched this height
        const lastH = lastAutoHeightRef.current.get(cardId) ?? 0;
        if (Math.abs(contentH - lastH) < 16) continue;
        lastAutoHeightRef.current.set(cardId, contentH);

        dispatchRef.current({ type: "AUTO_HEIGHT_CARD", id: cardId, height: contentH });
      }
    });
    autoHeightObserverRef.current = observer;
    return () => { observer.disconnect(); autoHeightObserverRef.current = null; };
  }, []);

  // Track observed elements so we can unobserve when they unmount
  const observedElementsRef = useRef(new Map<string, HTMLDivElement>());

  // Stable callback ref for content divs — uses data attribute instead of closure
  const autoHeightRefCallback = useCallback((el: HTMLDivElement | null) => {
    const observer = autoHeightObserverRef.current;
    if (!observer) return;
    if (el) {
      const cardId = el.dataset.autoHeightId;
      if (cardId) {
        // Unobserve previous element for this card if it changed
        const prev = observedElementsRef.current.get(cardId);
        if (prev && prev !== el) observer.unobserve(prev);
        observedElementsRef.current.set(cardId, el);
      }
      observer.observe(el);
    }
  }, []);

  // ── Streaming viewport tracking ────────────────────────────────────
  const prevStreamingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (dragging || resizing) return; // Don't auto-scroll during interaction

    // Find newly streaming cards (weren't streaming before)
    const newlyStreaming = [...streamingCardIds].filter(id => !prevStreamingRef.current.has(id));
    prevStreamingRef.current = new Set(streamingCardIds);

    if (newlyStreaming.length === 0) return;

    // Scroll to the last newly streaming card
    const targetId = newlyStreaming[newlyStreaming.length - 1];
    const targetCard = cards.find(c => c.id === targetId);
    if (!targetCard || !canvasRef.current) return;

    const container = canvasRef.current;
    const scrollTarget = {
      left: targetCard.position.x * zoom - container.clientWidth / 2 + (targetCard.size.width * zoom) / 2,
      top: targetCard.position.y * zoom - container.clientHeight / 2 + (targetCard.size.height * zoom) / 2,
    };
    container.scrollTo({ left: Math.max(0, scrollTarget.left), top: Math.max(0, scrollTarget.top), behavior: "smooth" });
  }, [streamingCardIds, cards, zoom, dragging, resizing]);

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

  // ── Pointer → canvas-space helper ────────────────────────────────────
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pointerToCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const sl = canvasRef.current?.scrollLeft ?? 0;
    const st = canvasRef.current?.scrollTop ?? 0;
    const ox = rect?.left ?? 0;
    const oy = rect?.top ?? 0;
    const z = zoomRef.current;
    return {
      x: (clientX - ox + sl) / z,
      y: (clientY - oy + st) / z,
    };
  }, []);

  // ── Drag handlers (pointer events for iframe reliability) ──────────
  const handleDragStart = useCallback((e: React.PointerEvent, card: CanvasCard) => {
    // Only start drag from the grip handle or card background, not buttons
    if ((e.target as HTMLElement).closest("button, input, a")) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = pointerToCanvas(e.clientX, e.clientY);
    setDragging({ cardId: card.id, offsetX: p.x - card.position.x, offsetY: p.y - card.position.y });
    setPreviewPos(null);
    dispatch({ type: "BRING_TO_FRONT", id: card.id });
  }, [dispatch, pointerToCanvas]);

  useEffect(() => {
    if (!dragging) return;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    const onMove = (e: PointerEvent) => {
      const d = draggingRef.current;
      if (!d) return;
      const p = pointerToCanvas(e.clientX, e.clientY);
      const x = snap(Math.max(0, p.x - d.offsetX));
      const y = snap(Math.max(MIN_CARD_Y, p.y - d.offsetY));
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
    const p = pointerToCanvas(e.clientX, e.clientY);
    setResizing({ cardId: card.id, startX: p.x, startY: p.y, startW: card.size.width, startH: card.size.height });
    setPreviewSize(null);
    dispatch({ type: "BRING_TO_FRONT", id: card.id });
  }, [dispatch, pointerToCanvas]);

  useEffect(() => {
    if (!resizing) return;
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
    const onMove = (e: PointerEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      const p = pointerToCanvas(e.clientX, e.clientY);
      const w = snap(Math.max(MIN_WIDTH, r.startW + (p.x - r.startX)));
      const h = snap(Math.max(MIN_HEIGHT, r.startH + (p.y - r.startY)));
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

  // ── Undo-close toast state ───────────────────────────────────────
  const [undoToast, setUndoToast] = useState<{ card: CanvasCard; timer: ReturnType<typeof setTimeout> } | null>(null);

  // ── Card action handlers ───────────────────────────────────────────
  const handleClose = useCallback((id: string) => {
    const card = cards.find(c => c.id === id);
    dispatch({ type: "REMOVE_CARD", id });
    // Clean up ResizeObserver for removed card
    const prevEl = observedElementsRef.current.get(id);
    if (prevEl && autoHeightObserverRef.current) {
      autoHeightObserverRef.current.unobserve(prevEl);
    }
    observedElementsRef.current.delete(id);
    if (card && !card.pinned) {
      // Show undo toast for 5 seconds
      if (undoToast?.timer) clearTimeout(undoToast.timer);
      const timer = setTimeout(() => setUndoToast(null), 5000);
      setUndoToast({ card, timer });
    }
  }, [dispatch, cards, undoToast]);
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

  // ── Inline chat handlers ──────────────────────────────────────────
  const handleInlineChatOpen = useCallback((card: CanvasCard) => {
    // Select the card so [EDITING ...] context is prepended automatically
    dispatch({ type: "SELECT_CARD", id: card.id });
    setInlineChatCardId(prev => prev === card.id ? null : card.id);
    setInlineChatInput("");
    setTimeout(() => inlineChatRef.current?.focus(), 50);
  }, [dispatch]);

  const handleInlineChatSubmit = useCallback(async (card: CanvasCard) => {
    const text = inlineChatInput.trim();
    if (!text || !onSendMessage || isChatStreaming) return;
    setInlineChatInput("");
    setInlineChatCardId(null);
    await onSendMessage(text, undefined, "edit");
  }, [inlineChatInput, onSendMessage, isChatStreaming]);

  const handlePublishClick = useCallback(async (card: CanvasCard) => {
    if (!onSendMessage || isChatStreaming) return;
    const componentInfo = JSON.stringify({
      component: card.component,
      title: card.title || card.component.replace(/_/g, " "),
      props: card.props,
    });
    const message = `[PUBLISH_SERVICE] ${componentInfo}\nI want to publish this component as a marketplace service.`;
    const displayText = `Publish "${card.title || card.component}" as service`;
    await onSendMessage(message, displayText);
  }, [onSendMessage, isChatStreaming]);

  const handleSaveClick = useCallback((card: CanvasCard) => {
    if (card.savedName) {
      // Already saved — toggle unsave confirmation
      setUnsavingCardId(prev => prev === card.id ? null : card.id);
      setSavingCardId(null); setSaveNameInput("");
      return;
    }
    if (savingCardId === card.id) { setSavingCardId(null); setSaveNameInput(""); return; }
    setUnsavingCardId(null);
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
      dispatch({ type: "SAVE_CARD", id: card.id, savedName: name, fileId });
      setSaveStatus({ cardId: card.id, status: "saved" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Save failed";
      setSaveStatus({ cardId: card.id, status: "error", message });
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setSaveStatus(null), 3000);
    }
  }, [saveNameInput, getAccessTokenSilently, deploymentId, dispatch]);

  const handleUnsave = useCallback(async (card: CanvasCard) => {
    const fileId = card.fileId || (card.savedName || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
    if (!fileId) return;
    setUnsavingCardId(null);
    setSaveStatus({ cardId: card.id, status: "saving" });
    try {
      const token = await getAccessTokenSilently();
      const res = await fetch(`${API_URL}/api/deployments/${deploymentId}/mcp/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tool: "delete_canvas_file", args: { fileId } }),
      });
      if (!res.ok) throw new Error("Delete failed");
      const data = await res.json();
      if (data.result?.isError) throw new Error(data.result.text || "Delete failed on pod");
      dispatch({ type: "UNSAVE_CARD", id: card.id });
      setRefetchTrigger((n) => n + 1);
      setSaveStatus(null);
    } catch (err: unknown) {
      console.error("[Jarble:Unsave] Failed:", err);
      const message = err instanceof Error ? err.message : "Remove failed";
      setSaveStatus({ cardId: card.id, status: "error", message });
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setSaveStatus(null), 3000);
    }
  }, [getAccessTokenSilently, deploymentId, dispatch]);

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
          refetchTrigger={refetchTrigger}
          drawing={drawing}
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
        refetchTrigger={refetchTrigger}
        drawing={drawing}
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
        data-jarble-canvas="true"
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        className="flex-1 overflow-auto relative"
        style={{
          // Dot grid background — adjust for zoom
          backgroundImage: gridSnap
            ? `radial-gradient(circle, hsl(var(--border) / 0.3) 1px, transparent 1px)`
            : `radial-gradient(circle, hsl(var(--border) / 0.15) 1px, transparent 1px)`,
          backgroundSize: `${SNAP_SIZE * zoom}px ${SNAP_SIZE * zoom}px`,
        }}
      >
        {/* Zoom wrapper — scales all canvas content */}
        <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: `${100 / zoom}%` }}>
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

        {/* Drawing layer — strokes rendered below cards */}
        <DrawingLayer
          strokes={strokes}
          activePoints={drawing.activePoints}
          isDrawing={drawing.isDrawing}
          activeTool={drawing.activeTool}
          penColor={drawing.penColor}
          penWidth={drawing.penWidth}
          onDeleteStroke={drawing.deleteStroke}
        />

        {/* Drawing capture div — intercepts pointer events when drawing tool is active */}
        {drawing.activeTool && drawing.activeTool !== "eraser" && (
          <div
            className="absolute inset-0"
            style={{ zIndex: 5, cursor: "crosshair" }}
            onPointerDown={(e) => {
              e.preventDefault();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              const p = pointerToCanvas(e.clientX, e.clientY);
              drawing.handleDrawStart(p.x, p.y);
            }}
            onPointerMove={(e) => {
              if (!drawing.isDrawing) return;
              const p = pointerToCanvas(e.clientX, e.clientY);
              drawing.handleDrawMove(p.x, p.y);
            }}
            onPointerUp={(e) => {
              (e.target as HTMLElement).releasePointerCapture(e.pointerId);
              drawing.handleDrawEnd();
            }}
            onPointerCancel={(e) => {
              (e.target as HTMLElement).releasePointerCapture(e.pointerId);
              drawing.handleDrawEnd();
            }}
          />
        )}

        {/* Provenance arrows — connect child cards to their parent */}
        <svg className="absolute inset-0 pointer-events-none" style={{ zIndex: 0, overflow: "visible" }}>
          <defs>
            <marker id="arrow-head" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6" fill="none" stroke="hsl(var(--muted-foreground) / 0.3)" strokeWidth="1.5" />
            </marker>
          </defs>
          {cards.filter(c => !c.minimized && c.parentCardId).map((child) => {
            const parent = cards.find(c => c.id === child.parentCardId);
            if (!parent || parent.minimized) return null;
            // Draw from parent's right edge center to child's left edge center
            const x1 = parent.position.x + parent.size.width;
            const y1 = parent.position.y + parent.size.height / 2;
            const x2 = child.position.x;
            const y2 = child.position.y + child.size.height / 2;
            // Bezier control points for a smooth curve
            const dx = Math.abs(x2 - x1) * 0.4;
            return (
              <path
                key={`arrow-${parent.id}-${child.id}`}
                d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`}
                fill="none"
                stroke="hsl(var(--muted-foreground) / 0.25)"
                strokeWidth="1.5"
                strokeDasharray="6 4"
                markerEnd="url(#arrow-head)"
              />
            );
          })}
        </svg>

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
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({ cardId: card.id, x: e.clientX, y: e.clientY });
              }}
              onPointerDown={(e) => handleDragStart(e, card)}
              onDoubleClick={() => {
                if (card.component === "page") {
                  dispatch({ type: "OPEN_PAGE_FULLSCREEN", id: card.id });
                }
              }}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: w,
                height: h,
                zIndex: card.zIndex,
                pointerEvents: drawing.activeTool ? "none" : "auto",
              }}
              className={`group rounded-lg overflow-hidden flex flex-col ${
                isInteracting && (isDragging || isResizingCard) ? "select-none" : "transition-shadow"
              } ${
                card.selected
                  ? "ring-2 ring-blue-500 shadow-md shadow-blue-500/20"
                  : isDragging
                    ? "shadow-xl ring-1 ring-primary/40 cursor-grabbing"
                    : isStreaming
                      ? "shadow-md canvas-card-streaming"
                      : "cursor-grab"
              }`}
            >
              {/* Page badge — always visible on page-type cards */}
              {card.component === "page" && (
                <div className="absolute top-1 left-1 z-20 pointer-events-none">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 text-[9px] font-semibold uppercase tracking-wider backdrop-blur-sm border border-purple-500/20">
                    Page
                  </span>
                </div>
              )}

              {/* Card menu trigger — small ... button, top-right corner */}
              <div
                className="absolute top-1 right-1 z-20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
                onContextMenu={(e) => e.stopPropagation()}
              >
                {/* Save status badge */}
                {saveStatus?.cardId === card.id && (
                  <span className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium backdrop-blur-sm ${
                    saveStatus.status === "saving" ? "text-blue-300 bg-blue-500/20" :
                    saveStatus.status === "saved" ? "text-green-300 bg-green-500/20" : "text-red-300 bg-red-500/20"
                  }`}>
                    {saveStatus.status === "saving" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                    {saveStatus.status === "saved" && <Check className="w-2.5 h-2.5" />}
                    {saveStatus.status === "saving" ? "Saving..." : saveStatus.status === "saved" ? "Saved!" : saveStatus.message || "Failed"}
                  </span>
                )}
                {card.savedName && (
                  <span className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-amber-500/20 backdrop-blur-sm">
                    <Bookmark className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setContextMenu({ cardId: card.id, x: rect.right, y: rect.bottom + 4 });
                  }}
                  className="w-6 h-6 flex items-center justify-center rounded bg-background/70 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-background/90 transition-colors border border-border/30"
                  aria-label="Card menu"
                  title="Card menu (or right-click)"
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
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

              {/* Unsave confirmation — overlay below header */}
              {unsavingCardId === card.id && (
                <div className="absolute top-6 left-0 right-0 z-20 flex items-center gap-1.5 px-2 py-1 bg-background/90 backdrop-blur-sm border-b border-border/20"
                  onPointerDown={(e) => e.stopPropagation()}>
                  <span className="text-xs text-foreground truncate">Remove from library?</span>
                  <button onClick={(e) => { e.stopPropagation(); handleUnsave(card); }}
                    className="h-6 px-2 text-xs font-medium rounded bg-red-500 hover:bg-red-600 text-white transition-colors shrink-0">
                    Yes
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setUnsavingCardId(null); }}
                    className="h-6 px-2 text-xs font-medium rounded bg-secondary hover:bg-secondary/80 text-foreground transition-colors shrink-0">
                    No
                  </button>
                </div>
              )}

              {/* Inline chat input — appears when card is selected and has the sparkle button */}
              {inlineChatCardId === card.id && onSendMessage && (
                <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center gap-1 px-2 py-1.5 bg-background/95 backdrop-blur-sm border-t border-primary/30 rounded-b-lg"
                  onPointerDown={(e) => e.stopPropagation()}>
                  <Sparkles className="w-3.5 h-3.5 text-primary/60 shrink-0" />
                  <input
                    ref={inlineChatRef}
                    type="text"
                    value={inlineChatInput}
                    onChange={(e) => setInlineChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleInlineChatSubmit(card);
                      else if (e.key === "Escape") { setInlineChatCardId(null); setInlineChatInput(""); }
                    }}
                    placeholder="Ask about this card..."
                    disabled={isChatStreaming}
                    className="flex-1 h-7 px-2 text-xs rounded border border-border/60 bg-secondary/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleInlineChatSubmit(card); }}
                    disabled={!inlineChatInput.trim() || isChatStreaming}
                    className="h-7 w-7 flex items-center justify-center rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-30 shrink-0"
                  >
                    {isChatStreaming ? <Loader2 className="w-3 h-3 animate-spin" /> : <SendHorizontal className="w-3 h-3" />}
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

              {/* Card content — fills entire card, auto-height measured */}
              <div
                ref={card.autoHeight !== false ? autoHeightRefCallback : undefined}
                data-auto-height-id={card.autoHeight !== false ? card.id : undefined}
                className="flex-1 min-h-0 overflow-hidden rounded-lg"
              >
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
        </div>{/* /zoom wrapper */}

        {/* Selection branch prompt — appears when a card is selected */}
        {onSendMessage && (() => {
          const selected = cards.find(c => c.selected);
          return selected ? (
            <SelectionBranch
              selectedCard={selected}
              zoom={zoom}
              onSendMessage={onSendMessage}
              isChatStreaming={isChatStreaming}
            />
          ) : null;
        })()}

        {/* Cmd+K prompt overlay */}
        {onSendMessage && (
          <PromptOverlay
            hasCards={cards.length > 0}
            onSendMessage={onSendMessage}
            isChatStreaming={isChatStreaming}
          />
        )}

        {/* Undo-close toast */}
        {undoToast && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-2 rounded-lg bg-foreground text-background text-xs font-medium shadow-lg animate-fade-in-up-fast">
            <span>Card removed</span>
            <button
              onClick={() => {
                dispatch({ type: "ADD_CARD", card: undoToast.card });
                clearTimeout(undoToast.timer);
                setUndoToast(null);
              }}
              className="px-2 py-0.5 rounded bg-background/20 hover:bg-background/30 text-background font-semibold transition-colors"
            >
              Undo
            </button>
            <button
              onClick={() => { clearTimeout(undoToast.timer); setUndoToast(null); }}
              className="text-background/60 hover:text-background transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Card context menu — rendered at canvas root to avoid transform issues */}
        {contextMenu && (() => {
          const card = cards.find(c => c.id === contextMenu.cardId);
          if (!card) return null;
          return (
            <div
              className="fixed z-[100] min-w-[180px] rounded-lg bg-popover border border-border shadow-xl py-1 text-sm animate-in fade-in-0 zoom-in-95 duration-100"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              {onSendMessage && (
                <button onClick={() => { setContextMenu(null); handleInlineChatOpen(card); }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-secondary/60 transition-colors">
                  <Sparkles className="w-3.5 h-3.5 text-primary" /> Ask about this card
                </button>
              )}
              <button onClick={() => { setContextMenu(null); handleSelect(card); }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-secondary/60 transition-colors">
                <MousePointerClick className="w-3.5 h-3.5 text-blue-400" /> {card.selected ? "Deselect" : "Select"}
              </button>
              {canSplitCard(card) && (
                <button onClick={() => { setContextMenu(null); handleSplit(card); }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-secondary/60 transition-colors">
                  <SplitSquareHorizontal className="w-3.5 h-3.5 text-violet-400" /> Split
                </button>
              )}
              {card.component === "layout" && Array.isArray(card.props?.children) && (card.props.children as unknown[]).length >= 2 && (
                <button onClick={() => { setContextMenu(null); dispatch({ type: "UNGROUP_CARD", id: card.id }); }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-secondary/60 transition-colors">
                  <Ungroup className="w-3.5 h-3.5 text-violet-400" /> Ungroup
                </button>
              )}
              <div className="h-px bg-border/40 my-1" />
              <button onClick={() => { setContextMenu(null); handleSaveClick(card); }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-secondary/60 transition-colors">
                <Bookmark className={`w-3.5 h-3.5 text-amber-400 ${card.savedName ? "fill-amber-400" : ""}`} /> {card.savedName ? "Saved" : "Save to library"}
              </button>
              <button onClick={() => { setContextMenu(null); handlePublishClick(card); }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-secondary/60 transition-colors">
                <Upload className="w-3.5 h-3.5 text-primary" /> Publish as service
              </button>
              <div className="h-px bg-border/40 my-1" />
              <button onClick={() => { setContextMenu(null); handleClose(card.id); }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-red-400 hover:bg-red-500/10 transition-colors">
                <X className="w-3.5 h-3.5" /> Close
              </button>
            </div>
          );
        })()}

        {/* Zoom controls — bottom right of canvas */}
        <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1 rounded-lg border border-border/60 bg-background/90 backdrop-blur-sm px-1 py-0.5 shadow-sm">
          <button
            onClick={() => dispatch({ type: "SET_ZOOM", zoom: zoom - 0.1 })}
            disabled={zoom <= 0.5}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Zoom out"
            aria-label="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => dispatch({ type: "SET_ZOOM", zoom: 1 })}
            onDoubleClick={() => {
              // Double-click: zoom to fit all cards in view
              if (cards.length === 0 || !canvasRef.current) return;
              const cw = canvasRef.current.clientWidth;
              const ch = canvasRef.current.clientHeight;
              const maxX = Math.max(...cards.filter(c => !c.minimized).map(c => c.position.x + c.size.width));
              const maxY = Math.max(...cards.filter(c => !c.minimized).map(c => c.position.y + c.size.height));
              if (maxX <= 0 || maxY <= 0) return;
              const fitZoom = Math.min(1.5, Math.max(0.25, Math.min(cw / (maxX + 40), ch / (maxY + 40))));
              dispatch({ type: "SET_ZOOM", zoom: Math.round(fitZoom * 20) / 20 }); // Snap to 5% increments
              canvasRef.current.scrollTo({ left: 0, top: 0, behavior: "smooth" });
            }}
            className="px-1.5 h-6 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 rounded transition-colors min-w-[36px]"
            title="Click: reset zoom / Double-click: fit all"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => dispatch({ type: "SET_ZOOM", zoom: zoom + 0.1 })}
            disabled={zoom >= 1.5}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Zoom in"
            aria-label="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(SimpleCanvasGridInner);

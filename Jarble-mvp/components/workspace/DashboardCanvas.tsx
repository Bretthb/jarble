"use client";

/**
 * DashboardCanvas — CSS Grid-based auto-layout for canvas cards.
 *
 * Cards flow into a responsive grid (3 cols at 900px+, 2 at 600-900, 1 under 600).
 * Sort order is type-priority based (header → KPIs → charts → tables → detail).
 * Column span is computed per-card from component type + layoutHint.
 */

import { memo, useCallback, useState, useRef, useEffect, type ReactNode, type KeyboardEvent } from "react";
import { X, GripVertical, MousePointerClick, Bookmark, Loader2, Check, SplitSquareHorizontal, Grid3X3 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";
import type { CanvasCard, CanvasAction } from "./types";
import { canSplitCard } from "./types";
import { computeSpan, TYPE_ORDER } from "./autoLayout";
import CanvasToolbar from "./CanvasToolbar";

/**
 * Immersive components need guaranteed height because they contain iframes
 * or widgets that use flex:1 / height:100% and collapse without a concrete parent size.
 */
const IMMERSIVE_COMPONENTS = new Set([
  "sandbox", "map", "video", "code_editor", "spreadsheet", "audio",
]);

/** Preferred heights for immersive components — used as minHeight so they always get space. */
const PREFERRED_HEIGHTS: Record<string, number> = {
  sandbox: 800,
  map: 600,
  video: 500,
  code_editor: 550,
  spreadsheet: 550,
  audio: 120,
};

/** Max heights for content-based components (safety cap to prevent unbounded growth). */
const MAX_HEIGHTS: Record<string, number> = {
  header: 80,
  divider: 50,
  metric_card: 180,
  badge: 60,
  progress: 100,
  alert: 180,
  button_group: 80,
  chart: 500,
  data_table: 600,
  list: 500,
  timeline: 500,
  card: 400,
  text_message: 400,
  stat_grid: 350,
  result: 250,
  statistic: 160,
  blockquote: 250,
  code_block: 500,
  image: 500,
  layout: 700,
  steps: 200,
  descriptions: 400,
  tag_cloud: 300,
  tree: 500,
  carousel: 450,
  accordion: 600,
  tabs: 600,
  form: 500,
  key_value: 400,
  image_gallery: 600,
  avatar: 100,
};
const DEFAULT_MAX_HEIGHT = 400;

interface DashboardCanvasProps {
  cards: CanvasCard[];
  dispatch: React.Dispatch<CanvasAction>;
  renderCard: (card: CanvasCard) => ReactNode;
  focusedCardId: string | null;
  streamingCardIds: Set<string>;
  deploymentId: string;
  onHide?: () => void;
}

function DashboardCanvasInner({
  cards,
  dispatch,
  renderCard,
  focusedCardId,
  streamingCardIds,
  deploymentId,
  onHide,
}: DashboardCanvasProps) {
  const { getAccessTokenSilently } = useAuth0();
  const containerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(3);

  // ── Responsive column count via ResizeObserver ──────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w < 600) setColumns(1);
        else if (w < 900) setColumns(2);
        else setColumns(3);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ── Card entrance animation tracking ──────────────────────────────
  const seenCardIdsRef = useRef<Set<string>>(new Set(cards.map((c) => c.id)));
  useEffect(() => {
    for (const c of cards) seenCardIdsRef.current.add(c.id);
  });

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

  useEffect(() => { return () => { if (errorTimerRef.current) clearTimeout(errorTimerRef.current); }; }, []);
  useEffect(() => { if (savingCardId && saveInputRef.current) saveInputRef.current.focus(); }, [savingCardId]);
  useEffect(() => {
    if (saveStatus?.status === "saved") {
      const t = setTimeout(() => setSaveStatus(null), 2000);
      return () => clearTimeout(t);
    }
  }, [saveStatus]);

  // ── Card action handlers ───────────────────────────────────────────
  const handleClose = useCallback((id: string) => dispatch({ type: "REMOVE_CARD", id }), [dispatch]);
  const handleSelect = useCallback((card: CanvasCard) => dispatch({ type: "TOGGLE_SELECT_CARD", id: card.id }), [dispatch]);
  const handleSplit = useCallback((card: CanvasCard) => dispatch({ type: "SPLIT_CARD", id: card.id }), [dispatch]);

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

  // ── Sort cards by type priority for dashboard flow ─────────────────
  const sortedCards = [...cards]
    .filter((c) => !c.minimized)
    .sort((a, b) => {
      const oa = TYPE_ORDER[a.component] ?? 10;
      const ob = TYPE_ORDER[b.component] ?? 10;
      if (oa !== ob) return oa - ob;
      return a.createdAt - b.createdAt;
    });

  // ── Keyboard navigation handler ───────────────────────────────────
  const handleGridKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const count = sortedCards.length;
    if (count === 0) return;

    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown": {
        e.preventDefault();
        const next = focusedIndex < count - 1 ? focusedIndex + 1 : 0;
        setFocusedIndex(next);
        const card = sortedCards[next];
        if (card) cardRefs.current.get(card.id)?.focus();
        break;
      }
      case "ArrowLeft":
      case "ArrowUp": {
        e.preventDefault();
        const prev = focusedIndex > 0 ? focusedIndex - 1 : count - 1;
        setFocusedIndex(prev);
        const card = sortedCards[prev];
        if (card) cardRefs.current.get(card.id)?.focus();
        break;
      }
      case "Escape": {
        e.preventDefault();
        setFocusedIndex(-1);
        containerRef.current?.focus();
        break;
      }
    }
  }, [focusedIndex, sortedCards]);

  // ── Empty state ────────────────────────────────────────────────────
  if (cards.length === 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <CanvasToolbar
          cards={cards}
          dispatch={dispatch}
          deploymentId={deploymentId}
          mode="dashboard"
          onHide={onHide}
        />
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

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Streaming card glow animation */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes canvas-streaming-glow {
          0%, 100% { box-shadow: 0 0 6px 0 hsl(var(--primary) / 0.2); }
          50% { box-shadow: 0 0 14px 2px hsl(var(--primary) / 0.35); }
        }
        .canvas-card-streaming {
          animation: canvas-streaming-glow 2s ease-in-out infinite;
        }
      `}} />

      <CanvasToolbar
        cards={cards}
        dispatch={dispatch}
        deploymentId={deploymentId}
        mode="dashboard"
        onHide={onHide}
      />

      {/* Aria live region for announcements */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnouncement}
      </div>

      {/* Dashboard grid */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-4"
      >
        <div
          role="grid"
          aria-label="Dashboard cards"
          tabIndex={0}
          onKeyDown={handleGridKeyDown}
          className="gap-4"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
          }}
        >
          <AnimatePresence mode="popLayout">
            {sortedCards.map((card) => {
              const span = Math.min(computeSpan(card, columns), columns);
              const isNew = !seenCardIdsRef.current.has(card.id);
              const isStreaming = streamingCardIds.has(card.id);
              const isImmersive = IMMERSIVE_COMPONENTS.has(card.component);
              const preferredH = PREFERRED_HEIGHTS[card.component];
              const maxH = MAX_HEIGHTS[card.component] ?? DEFAULT_MAX_HEIGHT;

              const cardIndex = sortedCards.indexOf(card);

              return (
                <motion.div
                  key={card.id}
                  layout
                  ref={(el) => { if (el) cardRefs.current.set(card.id, el); else cardRefs.current.delete(card.id); }}
                  role="gridcell"
                  aria-label={card.title || card.component.replace(/_/g, " ")}
                  tabIndex={cardIndex === focusedIndex ? 0 : -1}
                  onFocus={() => setFocusedIndex(cardIndex)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      dispatch({ type: "TOGGLE_SELECT_CARD", id: card.id });
                    }
                  }}
                  data-card-id={card.id}
                  initial={isNew ? { opacity: 0, scale: 0.95, y: 12 } : false}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                  transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                  style={{ gridColumn: `span ${span}`, alignSelf: "start" }}
                  className={`group rounded-lg overflow-hidden flex flex-col relative transition-shadow ${
                    card.selected
                      ? "ring-2 ring-blue-500 shadow-md shadow-blue-500/20"
                      : isStreaming
                        ? "ring-1 ring-primary/50 shadow-md canvas-card-streaming"
                        : card.id === focusedCardId
                          ? "ring-1 ring-primary/20"
                          : "hover:ring-1 hover:ring-border/50"
                  }`}
                >
                  {/* Card header — always partially visible, full on hover/focus */}
                  <div className="shrink-0 flex items-center justify-between px-2 py-0.5 opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity absolute top-0 left-0 right-0 z-20 bg-background/80 backdrop-blur-sm">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <GripVertical className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                      <span className="text-[10px] text-muted-foreground/60 truncate">
                        {card.title || card.component.replace(/_/g, " ")}
                      </span>
                      {card.savedName && (
                        <span className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-amber-500/15 border border-amber-500/30">
                          <Bookmark className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                          <span className="text-[9px] text-amber-300 font-medium max-w-[80px] truncate">{card.savedName}</span>
                        </span>
                      )}
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

                    <div className={`flex items-center gap-0.5 shrink-0 transition-opacity ${
                      card.selected ? "opacity-100" : "opacity-40 group-hover:opacity-100 group-focus-within:opacity-100"
                    }`}>
                      <button onClick={(e) => { e.stopPropagation(); handleSelect(card); }}
                        className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                          card.selected ? "bg-blue-500 text-white" : "hover:bg-blue-500/60 text-muted-foreground hover:text-white"
                        }`} aria-label={card.selected ? "Deselect" : "Select"} title={card.selected ? "Deselect" : "Select"}>
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
                      <button onClick={(e) => { e.stopPropagation(); handleClose(card.id); }}
                        className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:bg-red-500/60 hover:text-white transition-colors"
                        aria-label="Close card" title="Close">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Save name input */}
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

                  {/* Card content */}
                  <div
                    className={`overflow-auto rounded-lg ${isImmersive ? "flex-1 min-h-0" : ""}`}
                    style={isImmersive
                      ? { minHeight: preferredH, height: preferredH }
                      : { maxHeight: maxH }
                    }
                  >
                    {renderCard(card)}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default memo(DashboardCanvasInner);

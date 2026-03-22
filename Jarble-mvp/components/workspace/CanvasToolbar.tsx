"use client";

/**
 * CanvasToolbar — shared toolbar for both Dashboard and Freeform canvas modes.
 *
 * Renders: Hide button, mode toggle, grid-snap (freeform only), organize,
 * library, multi-select group action, and component count.
 */

import { memo } from "react";
import { X, Grid3X3, LayoutGrid, Group, LayoutDashboard, Move, Trash2 } from "lucide-react";
import type { CanvasCard, CanvasAction, CanvasMode } from "./types";
import ComponentGallery from "./ComponentGallery";
import DrawingTools from "./drawing/DrawingTools";
import type { useDrawing } from "./drawing/useDrawing";

interface CanvasToolbarProps {
  cards: CanvasCard[];
  dispatch: React.Dispatch<CanvasAction>;
  deploymentId: string;
  mode: CanvasMode;
  onHide?: () => void;
  /** Freeform-only: grid snap state */
  gridSnap?: boolean;
  onToggleGridSnap?: () => void;
  /** Freeform-only: tidy layout trigger */
  onOrganize?: () => void;
  /** Incremented each time an unsave happens — triggers gallery refetch */
  refetchTrigger?: number;
  /** Drawing state (freeform only) */
  drawing?: ReturnType<typeof useDrawing>;
}

function CanvasToolbarInner({
  cards,
  dispatch,
  deploymentId,
  mode,
  onHide,
  gridSnap,
  onToggleGridSnap,
  onOrganize,
  refetchTrigger,
  drawing,
}: CanvasToolbarProps) {
  const selectedCards = cards.filter((c) => c.selected);
  const selectedCount = selectedCards.length;

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-background z-10 relative">
      {onHide && (
        <button
          onClick={onHide}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          title="Hide canvas"
        >
          <X className="w-3.5 h-3.5" />
          Hide
        </button>
      )}

      {/* Mode toggle */}
      <div className="flex items-center rounded-md border border-border/60 overflow-hidden">
        <button
          onClick={() => dispatch({ type: "SET_CANVAS_MODE", mode: "dashboard" })}
          className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
            mode === "dashboard"
              ? "bg-primary/15 text-primary font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          }`}
          title="Dashboard mode — auto-arranged grid"
        >
          <LayoutDashboard className="w-3.5 h-3.5" />
          Dashboard
        </button>
        <div className="w-px h-4 bg-border/60" />
        <button
          onClick={() => dispatch({ type: "SET_CANVAS_MODE", mode: "freeform" })}
          className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
            mode === "freeform"
              ? "bg-primary/15 text-primary font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          }`}
          title="Freeform mode — drag & resize freely"
        >
          <Move className="w-3.5 h-3.5" />
          Freeform
        </button>
      </div>

      {/* Freeform-only: Grid snap */}
      {mode === "freeform" && onToggleGridSnap && (
        <button
          onClick={onToggleGridSnap}
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
            gridSnap
              ? "bg-primary/20 text-primary border border-primary/30"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          }`}
          title={`Grid snap: ${gridSnap ? "ON" : "OFF"}`}
        >
          <Grid3X3 className="w-3.5 h-3.5" />
          Snap
        </button>
      )}

      {/* Freeform-only: Organize */}
      {mode === "freeform" && onOrganize && (
        <button
          onClick={onOrganize}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          title="Organize cards into a clean layout"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          Organize
        </button>
      )}

      {/* Clear canvas */}
      {cards.length > 0 && (
        <button
          onClick={() => dispatch({ type: "CLEAR_CANVAS" })}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Clear all components from canvas"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear
        </button>
      )}

      {/* Drawing tools (freeform only) */}
      {mode === "freeform" && drawing && (
        <DrawingTools
          activeTool={drawing.activeTool}
          penColor={drawing.penColor}
          penWidth={drawing.penWidth}
          onSetTool={drawing.setTool}
          onSetColor={drawing.setColor}
          onSetWidth={drawing.setWidth}
          onUndo={drawing.undo}
          onRedo={drawing.redo}
        />
      )}

      <ComponentGallery deploymentId={deploymentId} cards={cards} dispatch={dispatch} refetchTrigger={refetchTrigger} />

      {/* Multi-select group action */}
      {selectedCount >= 2 && (
        <>
          <div className="w-px h-4 bg-border/50" />
          <span className="text-[11px] text-blue-400 font-medium">{selectedCount} selected</span>
          <button
            onClick={() => {
              const selectedIds = cards.filter((c) => c.selected).map((c) => c.id);
              if (selectedIds.length >= 2) dispatch({ type: "GROUP_CARDS", cardIds: selectedIds });
            }}
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

      <span className="text-[10px] text-muted-foreground-subtle ml-auto">
        {cards.length} component{cards.length !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

export default memo(CanvasToolbarInner);

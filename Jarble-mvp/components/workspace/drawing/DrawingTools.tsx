"use client";

/**
 * DrawingTools - toolbar segment for drawing tool selection,
 * color picker, and width picker.
 */

import { memo, useMemo } from "react";
import { MousePointer2, Pencil, Highlighter, Eraser, Undo2, Redo2 } from "lucide-react";
import type { DrawingTool } from "./useDrawing";
import { DRAWING_COLORS, PEN_WIDTHS } from "./drawingUtils";

interface DrawingToolsProps {
  activeTool: DrawingTool;
  penColor: string;
  penWidth: number;
  onSetTool: (tool: DrawingTool) => void;
  onSetColor: (color: string) => void;
  onSetWidth: (width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
}

const tools: Array<{ tool: DrawingTool; icon: typeof MousePointer2; label: string; shortcut: string }> = [
  { tool: null, icon: MousePointer2, label: "Pointer", shortcut: "V" },
  { tool: "pen", icon: Pencil, label: "Pen", shortcut: "P" },
  { tool: "highlighter", icon: Highlighter, label: "Highlighter", shortcut: "H" },
  { tool: "eraser", icon: Eraser, label: "Eraser", shortcut: "E" },
];

/** Human-readable color names for accessibility */
const COLOR_NAMES: Record<string, string> = {
  "#1a1a1a": "Black", "#c45050": "Red", "#6a8ab0": "Blue",
  "#5a9a7a": "Green", "#d4a574": "Bronze", "#b0804a": "Amber",
  "#f0e6d2": "White",
};

function DrawingToolsInner({
  activeTool,
  penColor,
  penWidth,
  onSetTool,
  onSetColor,
  onSetWidth,
  onUndo,
  onRedo,
}: DrawingToolsProps) {
  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const colors = useMemo(() => isDark ? DRAWING_COLORS.dark : DRAWING_COLORS.light, [isDark]);

  const isDrawingTool = activeTool === "pen" || activeTool === "highlighter";

  return (
    <>
      {/* Divider */}
      <div className="w-px h-4 bg-border/50" />

      {/* Tool buttons */}
      {tools.map(({ tool, icon: Icon, label, shortcut }) => (
        <button
          key={label}
          onClick={() => onSetTool(tool)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
            activeTool === tool
              ? "bg-primary/20 text-primary border border-primary/30"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          }`}
          title={`${label} (${shortcut})`}
          aria-label={`${label} tool`}
          aria-pressed={activeTool === tool}
        >
          <Icon className="w-3.5 h-3.5" />
        </button>
      ))}

      {/* Color + Width pickers (only when pen/highlighter active) */}
      {isDrawingTool && (
        <>
          <div className="w-px h-4 bg-border/50" />

          {/* Color picker */}
          <div className="flex items-center gap-0.5">
            {colors.map((color) => (
              <button
                key={color}
                onClick={() => onSetColor(color)}
                className={`w-5 h-5 rounded-full border-2 transition-transform ${
                  penColor === color ? "border-primary scale-110" : "border-transparent hover:scale-105"
                }`}
                style={{ backgroundColor: color }}
                title={COLOR_NAMES[color] || color}
                aria-label={`${COLOR_NAMES[color] || "Color"} ${penColor === color ? "(selected)" : ""}`}
              />
            ))}
          </div>

          <div className="w-px h-4 bg-border/50" />

          {/* Width picker */}
          <div className="flex items-center gap-1">
            {PEN_WIDTHS.map((w) => (
              <button
                key={w}
                onClick={() => onSetWidth(w)}
                className={`flex items-center justify-center w-6 h-6 rounded transition-colors ${
                  penWidth === w
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                }`}
                title={`Width: ${w}px`}
              >
                <div
                  className="rounded-full bg-current"
                  style={{ width: Math.max(3, w), height: Math.max(3, w) }}
                />
              </button>
            ))}
          </div>
        </>
      )}

      {/* Undo/Redo */}
      <div className="w-px h-4 bg-border/50" />
      <button
        onClick={onUndo}
        className="flex items-center px-1.5 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
        title="Undo stroke"
      >
        <Undo2 className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onRedo}
        className="flex items-center px-1.5 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
        title="Redo stroke"
      >
        <Redo2 className="w-3.5 h-3.5" />
      </button>
    </>
  );
}

export default memo(DrawingToolsInner);

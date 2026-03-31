"use client";

/**
 * DrawingLayer - SVG overlay for rendering strokes on the freeform canvas.
 *
 * - Completed strokes rendered as <path> elements with pre-computed d attribute
 * - Active stroke rendered as <path> (live preview during draw)
 * - Eraser mode: strokes get pointer-events and hover highlight for deletion
 */

import { memo, useState, useCallback, useMemo } from "react";
import type { DrawStroke } from "../types";
import type { DrawingTool } from "./useDrawing";
import { pointsToPathData } from "./drawingUtils";

interface DrawingLayerProps {
  strokes: DrawStroke[];
  activePoints: Array<{ x: number; y: number }>;
  isDrawing: boolean;
  activeTool: DrawingTool;
  penColor: string;
  penWidth: number;
  onDeleteStroke: (id: string) => void;
}

function DrawingLayerInner({
  strokes,
  activePoints,
  isDrawing,
  activeTool,
  penColor,
  penWidth,
  onDeleteStroke,
}: DrawingLayerProps) {
  const [hoveredStrokeId, setHoveredStrokeId] = useState<string | null>(null);
  const isEraser = activeTool === "eraser";

  const handleStrokeClick = useCallback((id: string) => {
    if (isEraser) {
      onDeleteStroke(id);
    }
  }, [isEraser, onDeleteStroke]);

  // Memoize active stroke preview path to avoid O(n) recalculation per frame
  const activePathData = useMemo(
    () => isDrawing && activePoints.length >= 2 ? pointsToPathData(activePoints) : null,
    [isDrawing, activePoints],
  );

  const activeWidth = activeTool === "highlighter" ? penWidth * 3 : penWidth;
  const activeOpacity = activeTool === "highlighter" ? 0.4 : 1.0;

  return (
    <svg
      className="absolute inset-0 overflow-visible"
      aria-hidden="true"
      style={{
        zIndex: 1,
        pointerEvents: isEraser ? "auto" : "none",
      }}
    >
      {/* Completed strokes */}
      {strokes.map((stroke) => (
        <path
          key={stroke.id}
          d={stroke.pathData}
          fill="none"
          stroke={hoveredStrokeId === stroke.id && isEraser ? "#ef4444" : stroke.color}
          strokeWidth={stroke.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={hoveredStrokeId === stroke.id && isEraser ? 0.7 : stroke.opacity}
          style={{
            pointerEvents: isEraser ? "visibleStroke" : "none",
            cursor: isEraser ? "pointer" : undefined,
            transition: isEraser ? "stroke 0.1s, opacity 0.1s" : undefined,
          }}
          onPointerEnter={isEraser ? () => setHoveredStrokeId(stroke.id) : undefined}
          onPointerLeave={isEraser ? () => setHoveredStrokeId(null) : undefined}
          onPointerDown={isEraser ? () => handleStrokeClick(stroke.id) : undefined}
        />
      ))}

      {/* Active stroke preview */}
      {activePathData && (
        <path
          d={activePathData}
          fill="none"
          stroke={penColor}
          strokeWidth={activeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={activeOpacity}
          style={{ pointerEvents: "none" }}
        />
      )}
    </svg>
  );
}

export default memo(DrawingLayerInner);

"use client";

/**
 * useDrawing — hook for freehand drawing state and handlers.
 *
 * Manages active tool, pen settings, stroke collection,
 * RDP simplification on stroke end, and undo/redo.
 */

import { useReducer, useCallback, useRef, useEffect } from "react";
import type { CanvasAction } from "../types";
import type { DrawStroke } from "../types";
import { simplifyPoints, pointsToPathData, DRAWING_COLORS, PEN_WIDTHS } from "./drawingUtils";

export type DrawingTool = "pointer" | "pen" | "highlighter" | "eraser" | null;

/** Minimum distance (px) a stroke must travel to be persisted */
const MIN_STROKE_DISTANCE = 3;

/** Maximum points to accumulate before auto-simplifying */
const MAX_ACTIVE_POINTS = 2000;

interface DrawingState {
  activeTool: DrawingTool;
  penColor: string;
  penWidth: number;
  activePoints: Array<{ x: number; y: number }>;
  isDrawing: boolean;
}

type DrawingAction =
  | { type: "SET_TOOL"; tool: DrawingTool }
  | { type: "SET_COLOR"; color: string }
  | { type: "SET_WIDTH"; width: number }
  | { type: "START_DRAW"; point: { x: number; y: number } }
  | { type: "ADD_POINT"; point: { x: number; y: number } }
  | { type: "END_DRAW" };

function drawingReducer(state: DrawingState, action: DrawingAction): DrawingState {
  switch (action.type) {
    case "SET_TOOL":
      return { ...state, activeTool: action.tool };
    case "SET_COLOR":
      return { ...state, penColor: action.color };
    case "SET_WIDTH":
      return { ...state, penWidth: action.width };
    case "START_DRAW":
      return { ...state, isDrawing: true, activePoints: [action.point] };
    case "ADD_POINT": {
      // Skip duplicate points (same pixel)
      const last = state.activePoints[state.activePoints.length - 1];
      if (last && Math.abs(action.point.x - last.x) < 0.5 && Math.abs(action.point.y - last.y) < 0.5) {
        return state;
      }
      const pts = [...state.activePoints, action.point];
      // Cap at max points to prevent memory issues on very long strokes
      if (pts.length > MAX_ACTIVE_POINTS) {
        const simplified = simplifyPoints(pts, 2.0);
        return { ...state, activePoints: simplified };
      }
      return { ...state, activePoints: pts };
    }
    case "END_DRAW":
      return { ...state, isDrawing: false, activePoints: [] };
    default:
      return state;
  }
}

const isDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");

export function useDrawing(canvasDispatch: React.Dispatch<CanvasAction>) {
  const [state, dispatch] = useReducer(drawingReducer, {
    activeTool: null,
    penColor: DRAWING_COLORS.dark[0],
    penWidth: PEN_WIDTHS[1],
    activePoints: [],
    isDrawing: false,
  });

  // Undo stack: stores full stroke objects so redo works correctly
  const undoStackRef = useRef<DrawStroke[]>([]);
  const redoStackRef = useRef<DrawStroke[]>([]);

  // Sync color with theme on mount and on theme change
  useEffect(() => {
    const syncColor = () => {
      const colors = isDark() ? DRAWING_COLORS.dark : DRAWING_COLORS.light;
      dispatch({ type: "SET_COLOR", color: colors[0] });
    };
    syncColor();

    // Watch for class changes on <html> (dark mode toggle)
    const observer = new MutationObserver(syncColor);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const setTool = useCallback((tool: DrawingTool) => {
    dispatch({ type: "SET_TOOL", tool });
  }, []);

  const setColor = useCallback((color: string) => {
    dispatch({ type: "SET_COLOR", color });
  }, []);

  const setWidth = useCallback((width: number) => {
    dispatch({ type: "SET_WIDTH", width });
  }, []);

  const handleDrawStart = useCallback((x: number, y: number) => {
    dispatch({ type: "START_DRAW", point: { x, y } });
  }, []);

  const handleDrawMove = useCallback((x: number, y: number) => {
    dispatch({ type: "ADD_POINT", point: { x, y } });
  }, []);

  const handleDrawEnd = useCallback(() => {
    const points = state.activePoints;
    if (points.length < 2) {
      dispatch({ type: "END_DRAW" });
      return;
    }

    // Reject degenerate strokes (user clicked without moving)
    const first = points[0];
    const last = points[points.length - 1];
    let maxDist = 0;
    for (const p of points) {
      const d = Math.hypot(p.x - first.x, p.y - first.y);
      if (d > maxDist) maxDist = d;
    }
    if (maxDist < MIN_STROKE_DISTANCE) {
      dispatch({ type: "END_DRAW" });
      return;
    }

    const simplified = simplifyPoints(points, 1.5);
    const pathData = pointsToPathData(simplified);
    const id = `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const stroke: DrawStroke = {
      id,
      points: simplified,
      color: state.penColor,
      width: state.activeTool === "highlighter" ? state.penWidth * 3 : state.penWidth,
      opacity: state.activeTool === "highlighter" ? 0.4 : 1.0,
      pathData,
      createdAt: Date.now(),
    };

    canvasDispatch({ type: "ADD_STROKE", stroke });
    undoStackRef.current.push(stroke); // Store full stroke for undo→redo
    redoStackRef.current = [];
    dispatch({ type: "END_DRAW" });
  }, [state.activePoints, state.penColor, state.penWidth, state.activeTool, canvasDispatch]);

  const deleteStroke = useCallback((id: string) => {
    canvasDispatch({ type: "REMOVE_STROKE", id });
  }, [canvasDispatch]);

  const undo = useCallback(() => {
    const stroke = undoStackRef.current.pop();
    if (!stroke) return;
    canvasDispatch({ type: "REMOVE_STROKE", id: stroke.id });
    redoStackRef.current.push(stroke); // Save for redo
  }, [canvasDispatch]);

  const redo = useCallback(() => {
    const stroke = redoStackRef.current.pop();
    if (!stroke) return;
    canvasDispatch({ type: "ADD_STROKE", stroke });
    undoStackRef.current.push(stroke);
  }, [canvasDispatch]);

  // Keyboard shortcuts — only fire when no modifier keys are held
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs or contenteditable
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.target as HTMLElement).isContentEditable) return;
      // Don't intercept with modifier keys (Cmd+V, Ctrl+E, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case "v":
          dispatch({ type: "SET_TOOL", tool: null });
          break;
        case "p":
          dispatch({ type: "SET_TOOL", tool: "pen" });
          break;
        case "h":
          dispatch({ type: "SET_TOOL", tool: "highlighter" });
          break;
        case "e":
          dispatch({ type: "SET_TOOL", tool: "eraser" });
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []); // Empty deps — handler uses dispatch which is stable from useReducer

  return {
    activeTool: state.activeTool,
    penColor: state.penColor,
    penWidth: state.penWidth,
    activePoints: state.activePoints,
    isDrawing: state.isDrawing,
    setTool,
    setColor,
    setWidth,
    handleDrawStart,
    handleDrawMove,
    handleDrawEnd,
    deleteStroke,
    undo,
    redo,
  };
}

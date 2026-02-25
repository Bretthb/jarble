"use client";

/**
 * MiniMap — 200×150px canvas-rendered overview in the bottom-right corner.
 * Shows all cards as colored rectangles and the viewport as a semi-transparent rect.
 * Click/drag to pan the main canvas.
 */

import { useRef, useEffect, useCallback } from "react";
import type { CanvasState, CanvasAction } from "./types";

const MAP_W = 200;
const MAP_H = 150;
const PAD = 40;

/** Color palette for card rectangles by component type. */
const COMPONENT_COLORS: Record<string, string> = {
  text_message: "#6b7280",   // gray
  sandbox: "#8b5cf6",        // purple
  chart: "#3b82f6",          // blue
  data_table: "#10b981",     // green
  code_editor: "#f59e0b",    // amber
  code_block: "#f59e0b",
  card: "#06b6d4",           // cyan
  stat_grid: "#ec4899",      // pink
  map: "#14b8a6",            // teal
};
const DEFAULT_COLOR = "#64748b"; // slate

interface MiniMapProps {
  state: CanvasState;
  dispatch: React.Dispatch<CanvasAction>;
}

export default function MiniMap({ state, dispatch }: MiniMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDragging = useRef(false);

  // Compute bounds of all cards
  const getBounds = useCallback(() => {
    const { cards } = state;
    if (cards.length === 0) {
      return { minX: -500, minY: -500, maxX: 500, maxY: 500 };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cards) {
      minX = Math.min(minX, c.position.x);
      minY = Math.min(minY, c.position.y);
      maxX = Math.max(maxX, c.position.x + c.size.width);
      maxY = Math.max(maxY, c.position.y + c.size.height);
    }
    // Include viewport origin
    const vx = -state.viewportOffset.x / state.zoom;
    const vy = -state.viewportOffset.y / state.zoom;
    const vw = (typeof window !== "undefined" ? window.innerWidth : 1200) / state.zoom;
    const vh = (typeof window !== "undefined" ? window.innerHeight : 800) / state.zoom;
    minX = Math.min(minX, vx);
    minY = Math.min(minY, vy);
    maxX = Math.max(maxX, vx + vw);
    maxY = Math.max(maxY, vy + vh);
    return { minX: minX - PAD, minY: minY - PAD, maxX: maxX + PAD, maxY: maxY + PAD };
  }, [state]);

  // Draw minimap
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = MAP_W * dpr;
    canvas.height = MAP_H * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, MAP_W, MAP_H);

    const bounds = getBounds();
    const worldW = bounds.maxX - bounds.minX;
    const worldH = bounds.maxY - bounds.minY;
    const scale = Math.min(MAP_W / worldW, MAP_H / worldH);

    const toMapX = (x: number) => (x - bounds.minX) * scale;
    const toMapY = (y: number) => (y - bounds.minY) * scale;

    // Draw cards
    for (const card of state.cards) {
      const x = toMapX(card.position.x);
      const y = toMapY(card.position.y);
      const w = card.size.width * scale;
      const h = card.size.height * scale;

      ctx.fillStyle = COMPONENT_COLORS[card.component] || DEFAULT_COLOR;
      ctx.globalAlpha = card.minimized ? 0.3 : 0.7;
      ctx.fillRect(x, y, Math.max(w, 2), Math.max(h, 2));
    }

    // Draw viewport rectangle
    const vx = -state.viewportOffset.x / state.zoom;
    const vy = -state.viewportOffset.y / state.zoom;
    const vw = (typeof window !== "undefined" ? window.innerWidth : 1200) / state.zoom;
    const vh = (typeof window !== "undefined" ? window.innerHeight : 800) / state.zoom;

    ctx.globalAlpha = 1;
    ctx.strokeStyle = "hsl(var(--primary))";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(toMapX(vx), toMapY(vy), vw * scale, vh * scale);
    ctx.fillStyle = "hsl(var(--primary) / 0.08)";
    ctx.fillRect(toMapX(vx), toMapY(vy), vw * scale, vh * scale);
  }, [state, getBounds]);

  // Click/drag to pan
  const handlePan = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const bounds = getBounds();
      const worldW = bounds.maxX - bounds.minX;
      const worldH = bounds.maxY - bounds.minY;
      const scale = Math.min(MAP_W / worldW, MAP_H / worldH);

      // Convert minimap coordinates to world coordinates
      const worldX = mx / scale + bounds.minX;
      const worldY = my / scale + bounds.minY;

      // Center viewport on this world point
      const vw = (typeof window !== "undefined" ? window.innerWidth : 1200) / state.zoom;
      const vh = (typeof window !== "undefined" ? window.innerHeight : 800) / state.zoom;

      dispatch({
        type: "SET_VIEWPORT",
        offset: {
          x: -(worldX - vw / 2) * state.zoom,
          y: -(worldY - vh / 2) * state.zoom,
        },
      });
    },
    [state.zoom, getBounds, dispatch]
  );

  return (
    <div className="absolute bottom-3 right-3 z-20 rounded-lg border border-border/60 bg-background/90 backdrop-blur-sm shadow-lg overflow-hidden">
      <canvas
        ref={canvasRef}
        width={MAP_W}
        height={MAP_H}
        className="cursor-pointer block"
        style={{ width: MAP_W, height: MAP_H }}
        onMouseDown={(e) => {
          isDragging.current = true;
          handlePan(e);
        }}
        onMouseMove={(e) => {
          if (isDragging.current) handlePan(e);
        }}
        onMouseUp={() => { isDragging.current = false; }}
        onMouseLeave={() => { isDragging.current = false; }}
      />
    </div>
  );
}

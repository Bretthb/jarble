"use client";

import {
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
  type WheelEvent,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import type { CanvasState, CanvasAction, CanvasCard } from "./types";

/** Buffer (px) around viewport — cards within this are still rendered. */
const CULL_BUFFER = 200;

interface InfiniteCanvasProps {
  state: CanvasState;
  dispatch: React.Dispatch<CanvasAction>;
  children: ReactNode;
}

/**
 * Infinite pannable/zoomable canvas.
 * - Wheel → zoom toward cursor
 * - Pointer drag on background → pan
 * - Space+drag → pan (anywhere)
 * - Ctrl+0 → reset zoom, Ctrl±/= → zoom in/out
 * - Delete/Backspace → close focused card
 * - Escape → deselect
 */
export default function InfiniteCanvas({ state, dispatch, children }: InfiniteCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const spaceHeld = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  const { viewportOffset, zoom } = state;

  // ── Zoom toward cursor ──────────────────────────────────────────────────────
  const handleWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      const newZoom = Math.max(0.25, Math.min(2.0, zoom + delta));
      const scale = newZoom / zoom;

      const newOffsetX = cursorX - scale * (cursorX - viewportOffset.x);
      const newOffsetY = cursorY - scale * (cursorY - viewportOffset.y);

      dispatch({ type: "SET_ZOOM", zoom: newZoom });
      dispatch({ type: "SET_VIEWPORT", offset: { x: newOffsetX, y: newOffsetY } });
    },
    [zoom, viewportOffset, dispatch]
  );

  // ── Pan via pointer drag ────────────────────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      // Space+click → pan from anywhere; otherwise only from background
      const isBackground =
        e.target === e.currentTarget || !!(e.target as HTMLElement).dataset.canvasBg;
      if (!spaceHeld.current && !isBackground) return;

      isPanning.current = true;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!isPanning.current) return;
      const dx = e.clientX - lastPointer.current.x;
      const dy = e.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      dispatch({
        type: "SET_VIEWPORT",
        offset: { x: viewportOffset.x + dx, y: viewportOffset.y + dy },
      });
    },
    [viewportOffset, dispatch]
  );

  const handlePointerUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      // Don't capture keys when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        spaceHeld.current = true;
        return;
      }

      // Ctrl+0 → reset zoom & viewport
      if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        dispatch({ type: "SET_ZOOM", zoom: 1 });
        dispatch({ type: "SET_VIEWPORT", offset: { x: 0, y: 0 } });
        return;
      }

      // Ctrl+= / Ctrl++ → zoom in
      if (e.ctrlKey && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        dispatch({ type: "SET_ZOOM", zoom: zoom + 0.1 });
        return;
      }

      // Ctrl+- → zoom out
      if (e.ctrlKey && e.key === "-") {
        e.preventDefault();
        dispatch({ type: "SET_ZOOM", zoom: zoom - 0.1 });
        return;
      }

      // Delete / Backspace → close focused card
      if ((e.key === "Delete" || e.key === "Backspace") && state.focusedCardId) {
        e.preventDefault();
        // Blank sandbox iframes before removal
        const el = document.getElementById(`card-${state.focusedCardId}`);
        const iframe = el?.querySelector("iframe");
        if (iframe) iframe.srcdoc = "";
        dispatch({ type: "REMOVE_CARD", id: state.focusedCardId });
        return;
      }

      // Escape → deselect
      if (e.key === "Escape") {
        dispatch({ type: "FOCUS_CARD", id: null });
        return;
      }
    },
    [zoom, state.focusedCardId, dispatch]
  );

  const handleKeyUp = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.code === "Space") {
      spaceHeld.current = false;
    }
  }, []);

  // Focus container on mount so keyboard shortcuts work immediately
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Click on background → deselect
  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const isBackground =
        e.target === e.currentTarget || !!(e.target as HTMLElement).dataset.canvasBg;
      if (isBackground && state.focusedCardId) {
        dispatch({ type: "FOCUS_CARD", id: null });
      }
    },
    [state.focusedCardId, dispatch]
  );

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden outline-none"
      tabIndex={0}
      style={{
        cursor: spaceHeld.current || isPanning.current ? "grab" : "default",
        backgroundImage:
          "radial-gradient(circle, hsl(var(--border) / 0.3) 1px, transparent 1px)",
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `${viewportOffset.x}px ${viewportOffset.y}px`,
      }}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onClick={handleBackgroundClick}
      data-canvas-bg="true"
    >
      <div
        style={{
          transform: `translate(${viewportOffset.x}px, ${viewportOffset.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
          position: "absolute",
          top: 0,
          left: 0,
          width: "10000px",
          height: "10000px",
        }}
        data-canvas-bg="true"
      >
        {children}
      </div>
    </div>
  );
}

// ── Viewport culling helper (used by parent to filter children) ───────────────

/**
 * Returns true if the card is within the visible viewport + buffer.
 * Cards outside are culled from the DOM to save memory.
 */
export function isCardVisible(
  card: CanvasCard,
  viewportOffset: { x: number; y: number },
  zoom: number,
  containerWidth: number,
  containerHeight: number
): boolean {
  // Card bounds in screen coordinates
  const screenX = card.position.x * zoom + viewportOffset.x;
  const screenY = card.position.y * zoom + viewportOffset.y;
  const screenW = card.size.width * zoom;
  const screenH = card.size.height * zoom;

  // Check intersection with viewport + buffer
  return (
    screenX + screenW > -CULL_BUFFER &&
    screenX < containerWidth + CULL_BUFFER &&
    screenY + screenH > -CULL_BUFFER &&
    screenY < containerHeight + CULL_BUFFER
  );
}

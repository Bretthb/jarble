"use client";

/**
 * useCanvasScreenshot — captures the canvas area or individual cards as base64 PNG images.
 *
 * Uses html2canvas for DOM-to-image conversion. The library is dynamically imported
 * so this hook degrades gracefully if html2canvas is not installed.
 *
 * SETUP: html2canvas must be installed in Jarble-mvp:
 *   npm install html2canvas
 *
 * Returns { captureCanvas, captureCard } — both return Promise<string | null>.
 */

import { useCallback, useRef } from "react";
import type { DrawStroke } from "@/components/workspace/types";
import { renderStrokesToCanvas, compressImage } from "@/lib/canvasImageUtils";

// ── Data attribute used to locate the canvas container in the DOM ─────────────
// SimpleCanvasGrid's outer scrollable <div> has ref={canvasRef} and role="grid".
// We locate it via a data attribute we add, or fall back to role="grid" query.
const CANVAS_SELECTOR = '[data-jarble-canvas="true"]';
const CANVAS_FALLBACK_SELECTOR = '[role="grid"][aria-label="Canvas cards"]';

// ── html2canvas lazy import ──────────────────────────────────────────────────

type Html2CanvasFn = (
  element: HTMLElement,
  options?: Record<string, unknown>,
) => Promise<HTMLCanvasElement>;

let _html2canvas: Html2CanvasFn | null = null;
let _loadAttempted = false;

async function getHtml2Canvas(): Promise<Html2CanvasFn | null> {
  if (_html2canvas) return _html2canvas;
  if (_loadAttempted) return null;

  _loadAttempted = true;
  try {
    const mod = await import("html2canvas");
    _html2canvas = (mod.default ?? mod) as Html2CanvasFn;
    return _html2canvas;
  } catch {
    console.warn(
      "[useCanvasScreenshot] html2canvas not available. Install it: npm install html2canvas",
    );
    return null;
  }
}

// ── Shared capture options ───────────────────────────────────────────────────

const CAPTURE_OPTIONS = {
  useCORS: true,
  allowTaint: false,
  scale: 0.5, // Half resolution to keep image small for LLM context
  logging: false,
  // Ignore iframes (sandboxes) that may block capture due to cross-origin
  ignoreElements: (el: Element) => {
    // Skip cross-origin iframes that would taint the canvas
    if (el.tagName === "IFRAME") {
      const src = (el as HTMLIFrameElement).src || "";
      if (src && !src.startsWith("about:") && !src.startsWith("blob:")) {
        return true;
      }
    }
    return false;
  },
};

// ── Hook ─────────────────────────────────────────────────────────────────────

interface UseCanvasScreenshotOptions {
  /** Strokes from canvas state, used to overlay drawings onto the capture */
  strokes?: DrawStroke[];
}

export function useCanvasScreenshot(options: UseCanvasScreenshotOptions = {}) {
  const { strokes = [] } = options;
  const capturingRef = useRef(false);

  /**
   * Finds the canvas grid container element in the DOM.
   */
  const findCanvasElement = useCallback((): HTMLElement | null => {
    return (
      document.querySelector<HTMLElement>(CANVAS_SELECTOR) ||
      document.querySelector<HTMLElement>(CANVAS_FALLBACK_SELECTOR)
    );
  }, []);

  /**
   * Finds a specific card element by its card ID.
   */
  const findCardElement = useCallback((cardId: string): HTMLElement | null => {
    // Cards are identified by data-card-id attribute or id
    return (
      document.querySelector<HTMLElement>(`[data-card-id="${cardId}"]`) ||
      document.getElementById(`canvas-card-${cardId}`)
    );
  }, []);

  /**
   * Composites drawing strokes onto a captured canvas image.
   * Returns the merged base64 PNG or the original if no strokes exist.
   */
  const overlayStrokes = useCallback(
    async (
      capturedBase64: string,
      containerWidth: number,
      containerHeight: number,
    ): Promise<string> => {
      if (strokes.length === 0) return capturedBase64;

      const strokeImage = renderStrokesToCanvas(strokes, containerWidth, containerHeight);
      if (!strokeImage) return capturedBase64;

      // Merge: draw captured image first, then stroke overlay on top
      return new Promise<string>((resolve) => {
        const baseImg = new Image();
        baseImg.onload = () => {
          const strokeImg = new Image();
          strokeImg.onload = () => {
            try {
              const canvas = document.createElement("canvas");
              canvas.width = baseImg.width;
              canvas.height = baseImg.height;
              const ctx = canvas.getContext("2d");
              if (!ctx) {
                resolve(capturedBase64);
                return;
              }

              // Draw captured DOM
              ctx.drawImage(baseImg, 0, 0);

              // Draw strokes on top, scaled to match the captured image dimensions
              // (capture was at scale 0.5, strokes are at full resolution)
              ctx.drawImage(strokeImg, 0, 0, canvas.width, canvas.height);

              resolve(canvas.toDataURL("image/png"));
            } catch {
              resolve(capturedBase64);
            }
          };
          strokeImg.onerror = () => resolve(capturedBase64);
          strokeImg.src = strokeImage;
        };
        baseImg.onerror = () => resolve(capturedBase64);
        baseImg.src = capturedBase64;
      });
    },
    [strokes],
  );

  /**
   * Captures the entire canvas grid area as a base64 PNG data URL.
   * Includes drawing strokes if present.
   * Returns null on failure.
   */
  const captureCanvas = useCallback(async (): Promise<string | null> => {
    // Prevent concurrent captures
    if (capturingRef.current) return null;
    capturingRef.current = true;

    try {
      const html2canvas = await getHtml2Canvas();
      if (!html2canvas) return null;

      const canvasEl = findCanvasElement();
      if (!canvasEl) {
        console.warn("[useCanvasScreenshot] Canvas container element not found");
        return null;
      }

      const result = await html2canvas(canvasEl, {
        ...CAPTURE_OPTIONS,
        // Capture the full scrollable area, not just the viewport
        scrollX: 0,
        scrollY: 0,
        windowWidth: canvasEl.scrollWidth,
        windowHeight: canvasEl.scrollHeight,
        width: canvasEl.scrollWidth,
        height: canvasEl.scrollHeight,
      });

      let base64 = result.toDataURL("image/png");

      // Overlay drawing strokes
      base64 = await overlayStrokes(
        base64,
        canvasEl.scrollWidth,
        canvasEl.scrollHeight,
      );

      // Compress to keep under ~1MB
      base64 = await compressImage(base64, 1024, 0.7);

      return base64;
    } catch (err) {
      console.warn("[useCanvasScreenshot] captureCanvas failed:", err);
      return null;
    } finally {
      capturingRef.current = false;
    }
  }, [findCanvasElement, overlayStrokes]);

  /**
   * Captures a specific card element as a base64 PNG data URL.
   * Returns null on failure or if the card is not found.
   */
  const captureCard = useCallback(
    async (cardId: string): Promise<string | null> => {
      // Prevent concurrent captures
      if (capturingRef.current) return null;
      capturingRef.current = true;

      try {
        const html2canvas = await getHtml2Canvas();
        if (!html2canvas) return null;

        const cardEl = findCardElement(cardId);
        if (!cardEl) {
          console.warn(`[useCanvasScreenshot] Card element not found: ${cardId}`);
          return null;
        }

        const result = await html2canvas(cardEl, CAPTURE_OPTIONS);

        let base64 = result.toDataURL("image/png");

        // Compress to keep under ~1MB
        base64 = await compressImage(base64, 1024, 0.7);

        return base64;
      } catch (err) {
        console.warn(`[useCanvasScreenshot] captureCard failed for ${cardId}:`, err);
        return null;
      } finally {
        capturingRef.current = false;
      }
    },
    [findCardElement],
  );

  return { captureCanvas, captureCard };
}

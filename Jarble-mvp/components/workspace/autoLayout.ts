import type { CanvasCard } from "./types";
import { DEFAULT_CARD_SIZES, DEFAULT_CARD_SIZE } from "./types";

/**
 * Pure function: find a non-overlapping position for a new card.
 * Starts at viewport center, spirals outward.
 */
export function findOpenPosition(
  cards: CanvasCard[],
  viewport: { x: number; y: number },
  zoom: number,
  containerWidth: number,
  containerHeight: number,
  cardSize: { width: number; height: number }
): { x: number; y: number } {
  // Center of visible viewport in canvas coordinates
  const cx = (-viewport.x + containerWidth / 2) / zoom - cardSize.width / 2;
  const cy = (-viewport.y + containerHeight / 2) / zoom - cardSize.height / 2;

  // If no cards, place at center
  if (cards.length === 0) return { x: cx, y: cy };

  // Spiral outward to find non-overlapping position
  const step = 40;
  for (let ring = 0; ring < 20; ring++) {
    for (let angle = 0; angle < 360; angle += 30) {
      const rad = (angle * Math.PI) / 180;
      const x = cx + Math.cos(rad) * step * ring;
      const y = cy + Math.sin(rad) * step * ring;

      const overlaps = cards.some(
        (c) =>
          x < c.position.x + c.size.width &&
          x + cardSize.width > c.position.x &&
          y < c.position.y + c.size.height &&
          y + cardSize.height > c.position.y
      );

      if (!overlaps) return { x, y };
    }
  }

  // Fallback: offset from last card
  const last = cards[cards.length - 1];
  return { x: last.position.x + 50, y: last.position.y + 50 };
}

/** Get the default size for a component type. */
export function getDefaultSize(component: string): { width: number; height: number } {
  return DEFAULT_CARD_SIZES[component] || DEFAULT_CARD_SIZE;
}

/** Get the current viewport container dimensions. */
export function getContainerSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 1200, height: 800 };
  return { width: window.innerWidth, height: window.innerHeight - 120 };
}

/**
 * Drawing utilities - RDP simplification, SVG path generation, color presets.
 */

interface Point {
  x: number;
  y: number;
}

/** Maximum recursion depth for RDP to prevent stack overflow on huge strokes */
const MAX_RDP_DEPTH = 20;

/** Ramer-Douglas-Peucker simplification (iterative-safe with depth limit) */
export function simplifyPoints(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2 || epsilon <= 0) return points;
  return rdp(points, epsilon, 0);
}

function rdp(points: Point[], epsilon: number, depth: number): Point[] {
  if (points.length <= 2 || depth >= MAX_RDP_DEPTH) return points;

  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = rdp(points.slice(0, maxIdx + 1), epsilon, depth + 1);
    const right = rdp(points.slice(maxIdx), epsilon, depth + 1);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  const t = Math.max(0, Math.min(1, ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq));
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

/** Convert points to a smooth SVG path using quadratic bezier curves */
export function pointsToPathData(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  if (points.length === 2) {
    // Check for degenerate (zero-length) line
    if (points[0].x === points[1].x && points[0].y === points[1].y) return "";
    return `M${points[0].x},${points[0].y}L${points[1].x},${points[1].y}`;
  }

  let d = `M${points[0].x},${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += `Q${points[i].x},${points[i].y},${midX},${midY}`;
  }

  // End at the last point
  const last = points[points.length - 1];
  d += `L${last.x},${last.y}`;

  return d;
}

/** Get bounding box of points (for optional culling) */
export function strokeBoundingBox(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Theme-aware drawing color presets */
export const DRAWING_COLORS = {
  light: ["#1a1a1a", "#dc2626", "#2563eb", "#16a34a", "#ea580c", "#9333ea"],
  dark: ["#e8e4df", "#f87171", "#60a5fa", "#4ade80", "#fb923c", "#c084fc"],
};

/** Pen width presets */
export const PEN_WIDTHS = [2, 4, 8] as const;

"use client";

import { memo } from "react";
import CanvasRenderer from "../CanvasRenderer";

export interface LayoutChild {
  component: string;
  /** Props as JSON string or raw object (from bot) */
  propsJson?: string;
  props?: Record<string, unknown>;
}

export interface CanvasLayoutProps {
  title?: string;
  children: LayoutChild[];
  /** Number of grid columns (1-4). Default: auto-detect from child count. */
  columns?: number;
  /** Layout direction: "grid" (default), "vertical" for stacking, or "horizontal" for row. */
  direction?: "grid" | "vertical" | "horizontal";
  /** Gap between children in pixels. Default: 12. */
  gap?: number;
}

const GRID_CLASSES: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

/** Pick a sensible column count based on child count and types. */
function autoColumns(children: LayoutChild[]): number {
  const n = children.length;
  if (n <= 1) return 1;
  // Check if all children are compact types (metric cards, stats, badges, progress)
  const compactTypes = new Set(["metric_card", "stat_grid", "progress", "alert", "badge", "header"]);
  const allCompact = children.every((c) => compactTypes.has(c.component));
  if (allCompact) {
    if (n <= 2) return 2;
    if (n <= 3) return 3;
    return 4;
  }
  if (n === 2) return 2;
  if (n <= 4) return 2;
  return 3;
}

function CanvasLayoutInner({
  children,
  columns,
  direction = "grid",
  gap = 12,
}: CanvasLayoutProps) {
  if (!Array.isArray(children) || children.length === 0) {
    return null;
  }

  const isVertical = direction === "vertical";
  const isHorizontal = direction === "horizontal";
  const cols = isVertical || isHorizontal ? children.length : (columns ?? autoColumns(children));
  const gridClass = GRID_CLASSES[Math.min(Math.max(cols, 1), 4)] || "grid-cols-2";

  const layoutClass = isVertical
    ? "flex flex-col"
    : isHorizontal
      ? "flex flex-row"
      : `grid ${gridClass}`;

  return (
    <div
      role="region"
      aria-label="Layout"
      className={`${layoutClass} h-full min-h-0`}
      style={{ gap }}
    >
      {children.map((child, i) => {
        // Support both propsJson (string) and props (object)
        let resolvedProps: Record<string, unknown> = {};
        if (child.props) {
          resolvedProps = child.props;
        } else if (child.propsJson) {
          try { resolvedProps = JSON.parse(child.propsJson); } catch { /* empty */ }
        }
        return (
          <div key={`child-${i}`} className={isVertical ? "flex-1 min-h-0" : isHorizontal ? "flex-1 min-w-0" : "min-h-0"}>
            <CanvasRenderer
              block={{
                id: `child-${i}`,
                component: child.component,
                props: resolvedProps,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

export default memo(CanvasLayoutInner);

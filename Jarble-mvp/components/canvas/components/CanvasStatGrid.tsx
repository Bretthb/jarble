"use client";

import { memo } from "react";
import { useCanvasAction } from "../CanvasActionContext";

export interface StatItem {
  label: string;
  value: string | number;
  change?: string;
  icon?: string;
}

export interface CanvasStatGridProps {
  stats: StatItem[];
  /** Show a pulsing live indicator dot in the top-right corner */
  live?: boolean;
  /** Small timestamp displayed in the top-right corner */
  lastUpdated?: string;
}

/** Determine trend direction from the change string. */
function getTrend(change?: string): "up" | "down" | "neutral" {
  if (!change) return "neutral";
  if (change.startsWith("+") || change.startsWith("\u2191")) return "up";
  if (change.startsWith("-") || change.startsWith("\u2193")) return "down";
  return "neutral";
}

/** Map trend to gradient border accent classes. */
const BORDER_GRADIENT: Record<string, string> = {
  up: "from-emerald-400 to-teal-500",
  down: "from-red-400 to-rose-500",
  neutral: "from-zinc-300 to-zinc-400 dark:from-zinc-600 dark:to-zinc-500",
};

/** Map trend to badge background/text color. */
const BADGE_CLASSES: Record<string, string> = {
  up: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-inset ring-emerald-500/20",
  down: "bg-red-500/15 text-red-600 dark:text-red-400 ring-1 ring-inset ring-red-500/20",
  neutral: "bg-zinc-500/10 text-muted-foreground ring-1 ring-inset ring-border/30",
};

/** Map trend to the icon background gradient. */
const ICON_BG: Record<string, string> = {
  up: "bg-gradient-to-br from-emerald-100 to-emerald-50 dark:from-emerald-500/20 dark:to-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  down: "bg-gradient-to-br from-red-100 to-red-50 dark:from-red-500/20 dark:to-red-500/10 text-red-600 dark:text-red-400",
  neutral: "bg-gradient-to-br from-zinc-100 to-zinc-50 dark:from-zinc-500/20 dark:to-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

/** Tile background tint by trend */
const TILE_BG: Record<string, string> = {
  up: "bg-gradient-to-br from-emerald-50/30 via-transparent to-transparent dark:from-emerald-950/10 dark:via-transparent dark:to-transparent",
  down: "bg-gradient-to-br from-red-50/30 via-transparent to-transparent dark:from-red-950/10 dark:via-transparent dark:to-transparent",
  neutral: "",
};

function CanvasStatGridInner({
  stats = [],
  live,
  lastUpdated,
}: CanvasStatGridProps) {
  let dispatch: ReturnType<typeof useCanvasAction>["dispatch"] | null = null;
  try {
    const ctx = useCanvasAction();
    dispatch = ctx.dispatch;
  } catch {
    // Not inside CanvasActionProvider -- interactivity disabled
  }

  const handleStatClick = (stat: StatItem, index: number) => {
    if (!dispatch) return;
    dispatch({
      action: "stat_click",
      payload: { label: stat.label, value: stat.value, change: stat.change, index },
    });
  };

  return (
    <div className="relative p-4 h-full">
      {/* Header row: live indicator + timestamp */}
      {(live || lastUpdated) && (
        <div className="flex items-center justify-end gap-2 mb-3">
          {lastUpdated && (
            <span className="text-[10px] text-muted-foreground/60 font-mono tracking-tight">
              {lastUpdated}
            </span>
          )}
          {live && (
            <span className="relative flex h-2.5 w-2.5" aria-label="Live data">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" aria-hidden="true" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
          )}
        </div>
      )}

      {/* Stats grid */}
      <div role="list" aria-label="Statistics" className="grid grid-cols-2 gap-3">
        {stats.map((stat, i) => {
          const trend = getTrend(stat.change);

          return (
            <div
              role="button"
              tabIndex={0}
              aria-label={`${stat.label}: ${stat.value}${stat.change ? `, ${stat.change}` : ""}`}
              key={`${stat.label}-${i}`}
              onClick={() => handleStatClick(stat, i)}
              onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleStatClick(stat, i); } }}
              className="group relative cursor-pointer overflow-hidden"
            >
              {/* Gradient left border accent */}
              <div className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-full bg-gradient-to-b ${BORDER_GRADIENT[trend]}`} />

              {/* Tile content */}
              <div
                className={[
                  "ml-[3px] rounded-r-xl p-3.5",
                  "bg-card/60 dark:bg-white/[0.03] backdrop-blur-sm",
                  "border border-border/30 border-l-0",
                  "shadow-sm dark:shadow-black/10",
                  "transition-all duration-250 ease-out",
                  "hover:shadow-md hover:scale-[1.02] dark:hover:shadow-black/20",
                  "hover:bg-card/80 dark:hover:bg-white/[0.06]",
                  TILE_BG[trend],
                ].join(" ")}
              >
                {/* Icon + Label row */}
                <div className="flex items-center gap-2 mb-2">
                  {stat.icon && (
                    <span
                      className={[
                        "inline-flex items-center justify-center h-8 w-8 rounded-full text-sm",
                        "shadow-sm",
                        ICON_BG[trend],
                      ].join(" ")}
                    >
                      {stat.icon}
                    </span>
                  )}
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {stat.label}
                  </span>
                </div>

                {/* Value */}
                <div className="text-2xl font-bold tracking-tight tabular-nums text-foreground leading-none mb-2">
                  {String(stat.value)}
                </div>

                {/* Change badge */}
                {stat.change && (
                  <span
                    className={[
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      BADGE_CLASSES[trend],
                    ].join(" ")}
                  >
                    {stat.change}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(CanvasStatGridInner);

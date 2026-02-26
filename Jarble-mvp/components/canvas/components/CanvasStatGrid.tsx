"use client";

import { motion } from "framer-motion";
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

/** Map trend to Tailwind color tokens for the left-border accent. */
const BORDER_COLOR: Record<string, string> = {
  up: "border-l-emerald-500",
  down: "border-l-red-500",
  neutral: "border-l-zinc-400 dark:border-l-zinc-600",
};

/** Map trend to badge background/text color. */
const BADGE_CLASSES: Record<string, string> = {
  up: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  down: "bg-red-500/15 text-red-600 dark:text-red-400",
  neutral: "bg-zinc-500/10 text-muted-foreground",
};

/** Map trend to the soft icon background color. */
const ICON_BG: Record<string, string> = {
  up: "bg-emerald-500/10",
  down: "bg-red-500/10",
  neutral: "bg-zinc-500/10",
};

export default function CanvasStatGrid({
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
    <div className="relative p-3 h-full">
      {/* Header row: live indicator + timestamp */}
      {(live || lastUpdated) && (
        <div className="flex items-center justify-end gap-2 mb-2">
          {lastUpdated && (
            <span className="text-[10px] text-muted-foreground/70 font-mono tracking-tight">
              {lastUpdated}
            </span>
          )}
          {live && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
          )}
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat, i) => {
          const trend = getTrend(stat.change);

          return (
            <motion.div
              key={`${stat.label}-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.35,
                delay: i * 0.06,
                ease: [0.25, 0.46, 0.45, 0.94],
              }}
              onClick={() => handleStatClick(stat, i)}
              className={[
                "group cursor-pointer rounded-lg border-l-[3px] p-3",
                "bg-card/60 backdrop-blur-sm",
                "transition-all duration-200",
                "hover:shadow-md hover:shadow-black/5 hover:-translate-y-0.5",
                "dark:hover:shadow-black/20",
                BORDER_COLOR[trend],
              ].join(" ")}
            >
              {/* Icon + Label row */}
              <div className="flex items-center gap-2 mb-1.5">
                {stat.icon && (
                  <span
                    className={[
                      "inline-flex items-center justify-center h-7 w-7 rounded-full text-sm",
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
              <div className="text-2xl font-bold tracking-tight text-foreground leading-none mb-1.5">
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
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

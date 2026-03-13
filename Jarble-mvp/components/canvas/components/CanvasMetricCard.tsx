"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  YAxis,
} from "recharts";
import { motion, useInView } from "framer-motion";

export interface CanvasMetricCardProps {
  label?: string;
  title?: string;    // Alias for label (bots often use title)
  value: string | number;
  change?: string;
  changeLabel?: string;
  subtitle?: string;  // Alias for changeLabel
  trend?: "up" | "down" | "neutral";
  icon?: string;
  sparkline?: number[];
  live?: boolean;
  lastUpdated?: string;
}

// ---------------------------------------------------------------------------
// Animated count-up hook for numeric values
// ---------------------------------------------------------------------------

function useCountUp(target: number, duration = 1200) {
  const [current, setCurrent] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true });

  useEffect(() => {
    if (!isInView) return;
    const startTime = performance.now();
    let raf: number;

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(target * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, isInView]);

  return { current, ref };
}

// ---------------------------------------------------------------------------
// Trend arrow component
// ---------------------------------------------------------------------------

function TrendArrow({ positive }: { positive: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className={`inline-block ${positive ? "" : "rotate-180"}`}
    >
      <path
        d="M6 2.5L10 7.5H2L6 2.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Pulsing live indicator
// ---------------------------------------------------------------------------

function LiveDot() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <span className="text-[10px] font-medium text-emerald-400">Live</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Background accent gradients
// ---------------------------------------------------------------------------

const TREND_BG: Record<string, string> = {
  positive: "from-emerald-50/40 to-transparent dark:from-emerald-950/15 dark:to-transparent",
  negative: "from-red-50/40 to-transparent dark:from-red-950/15 dark:to-transparent",
  neutral: "from-zinc-50/40 to-transparent dark:from-zinc-800/10 dark:to-transparent",
};

const TREND_ICON_BG: Record<string, string> = {
  positive: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  negative: "bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400",
  neutral: "bg-zinc-100 dark:bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

const TREND_BORDER: Record<string, string> = {
  positive: "border-l-emerald-500",
  negative: "border-l-red-500",
  neutral: "border-l-zinc-400 dark:border-l-zinc-600",
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function CanvasMetricCardInner({
  label: labelProp,
  title,
  value,
  change,
  changeLabel,
  subtitle,
  trend,
  icon,
  sparkline,
  live,
  lastUpdated,
}: CanvasMetricCardProps) {
  // Resolve aliases: title -> label, subtitle -> changeLabel
  const label = labelProp || title || "Metric";
  const resolvedChangeLabel = changeLabel || subtitle;

  const isPositive = trend === "up" || change?.startsWith("+") || change?.startsWith("up") || change?.includes("\u2191");
  const isNegative = trend === "down" || change?.startsWith("-") || change?.startsWith("down") || change?.includes("\u2193");

  const trendKey = isPositive ? "positive" : isNegative ? "negative" : "neutral";

  // Strip leading symbol for a clean percentage display
  const cleanChange = change
    ?.replace(/^[+\-\u2191\u2193]\s*/, "")
    .trim();

  // Sparkline colour tokens
  const sparkStroke = isNegative ? "#ef4444" : "#10b981";
  const sparkFillId = `metric-spark-${label?.replace(/\s/g, "-") ?? "default"}`;

  // Animated count-up for pure numeric values
  const numericValue = typeof value === "number" ? value : null;
  const isWholeNumber = numericValue !== null && Number.isInteger(numericValue);
  const countUp = useCountUp(isWholeNumber ? numericValue! : 0, 1400);

  return (
    <motion.div
      role="article"
      aria-label={`${label}: ${value}${change ? `, ${change}` : ""}`}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={[
        "relative overflow-hidden p-4 h-full rounded-xl",
        "border-l-[3px]",
        TREND_BORDER[trendKey],
        "bg-gradient-to-br",
        TREND_BG[trendKey],
        "border border-border/40 border-l-[3px]",
        "shadow-sm dark:shadow-md dark:shadow-black/15",
      ].join(" ")}
    >
      {/* -- Top row: label + icon + live indicator -- */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {icon && (
            <span
              className={[
                "inline-flex items-center justify-center h-7 w-7 rounded-full text-sm shadow-sm",
                TREND_ICON_BG[trendKey],
              ].join(" ")}
            >
              {icon}
            </span>
          )}
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {label}
          </span>
        </div>
        {live ? (
          <LiveDot />
        ) : lastUpdated ? (
          <span className="text-[10px] text-muted-foreground/60">
            Snapshot {lastUpdated}
          </span>
        ) : null}
      </div>

      {/* -- Value + sparkline row -- */}
      <div className="flex items-end justify-between mt-1">
        <div className="space-y-1">
          {/* Value with optional count-up animation */}
          <div
            ref={countUp.ref}
            className="text-3xl font-bold tracking-tight tabular-nums text-foreground leading-none"
          >
            {isWholeNumber ? countUp.current.toLocaleString() : String(value)}
          </div>

          {/* Trend indicator */}
          {change && (
            <div className="flex items-center gap-1.5 mt-2">
              <span
                className={[
                  "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  "ring-1 ring-inset",
                  isPositive
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20"
                    : isNegative
                      ? "bg-red-500/15 text-red-600 dark:text-red-400 ring-red-500/20"
                      : "bg-muted text-muted-foreground ring-border/50",
                ].join(" ")}
              >
                {(isPositive || isNegative) && (
                  <TrendArrow positive={!!isPositive} />
                )}
                {cleanChange || change}
              </span>
              {resolvedChangeLabel && (
                <span className="text-[10px] text-muted-foreground/60">
                  {resolvedChangeLabel}
                </span>
              )}
            </div>
          )}
        </div>

        {/* -- Sparkline with gradient fill -- */}
        {sparkline && sparkline.length > 1 && (
          <div className="w-28 h-14 -mr-1 -mb-1 opacity-90">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={sparkline.map((v, i) => ({ v, i }))}
                margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id={sparkFillId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparkStroke} stopOpacity={0.4} />
                    <stop offset="50%" stopColor={sparkStroke} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={sparkStroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis domain={["dataMin", "dataMax"]} hide />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={sparkStroke}
                  strokeWidth={2}
                  fill={`url(#${sparkFillId})`}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default memo(CanvasMetricCardInner);

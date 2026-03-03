"use client";

import { memo } from "react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  YAxis,
} from "recharts";
import { motion } from "framer-motion";

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
  // Resolve aliases: title → label, subtitle → changeLabel
  const label = labelProp || title || "Metric";
  const resolvedChangeLabel = changeLabel || subtitle;

  const isPositive = trend === "up" || change?.startsWith("+") || change?.startsWith("up") || change?.includes("↑");
  const isNegative = trend === "down" || change?.startsWith("-") || change?.startsWith("down") || change?.includes("↓");

  // Strip leading symbol for a clean percentage display
  const cleanChange = change
    ?.replace(/^[+\-↑↓]\s*/, "")
    .trim();

  // Accent border color based on trend
  const accentBorderClass = isPositive
    ? "border-l-emerald-500"
    : isNegative
      ? "border-l-red-500"
      : "border-l-zinc-400 dark:border-l-zinc-600";

  // Sparkline colour tokens
  const sparkStroke = isNegative ? "#ef4444" : "#10b981";
  const sparkFillId = `metric-spark-${label?.replace(/\s/g, "-") ?? "default"}`;

  return (
    <motion.div
      role="article"
      aria-label={`${label}: ${value}${change ? `, ${change}` : ""}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`relative overflow-hidden p-4 h-full border-l-[3px] ${accentBorderClass}`}
    >
      {/* ── Top row: label + live indicator ── */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          {icon && <span className="text-sm">{icon}</span>}
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {label}
          </span>
        </div>
        {live ? (
          <LiveDot />
        ) : lastUpdated ? (
          <span className="text-[10px] text-muted-foreground-subtle">
            Snapshot {lastUpdated}
          </span>
        ) : null}
      </div>

      {/* ── Value + sparkline row ── */}
      <div className="flex items-end justify-between mt-1">
        <div className="space-y-1">
          {/* Value */}
          <div className="text-3xl font-bold tracking-tight tabular-nums text-foreground leading-none">
            {String(value)}
          </div>

          {/* Trend indicator */}
          {change && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  isPositive
                    ? "bg-emerald-500/15 text-emerald-400"
                    : isNegative
                      ? "bg-red-500/15 text-red-400"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {(isPositive || isNegative) && (
                  <TrendArrow positive={!!isPositive} />
                )}
                {cleanChange || change}
              </span>
              {resolvedChangeLabel && (
                <span className="text-[10px] text-muted-foreground-subtle">
                  {resolvedChangeLabel}
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Sparkline with gradient fill ── */}
        {sparkline && sparkline.length > 1 && (
          <div className="w-24 h-12 -mr-1 -mb-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={sparkline.map((v, i) => ({ v, i }))}
                margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id={sparkFillId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparkStroke} stopOpacity={0.35} />
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

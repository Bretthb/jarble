"use client";

import { memo, useEffect, useRef, useState } from "react";
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
// Animated number counter hook
// Counts from 0 to the target over `duration` ms on mount.
// Only animates pure numeric values; mixed strings render immediately.
// ---------------------------------------------------------------------------

function useAnimatedNumber(
  target: string | number,
  duration = 800
): string {
  const numericTarget =
    typeof target === "number" ? target : parseFloat(target);
  const isNumeric = !isNaN(numericTarget) && String(numericTarget) === String(target).trim();

  const [display, setDisplay] = useState(isNumeric ? "0" : String(target));
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isNumeric) {
      setDisplay(String(target));
      return;
    }

    // Determine decimal places to preserve formatting
    const parts = String(target).split(".");
    const decimals = parts.length > 1 ? parts[1].length : 0;

    startRef.current = null;

    const animate = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = eased * numericTarget;
      setDisplay(current.toFixed(decimals));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return display;
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

  const animatedValue = useAnimatedNumber(value);

  // Sparkline colour tokens
  const sparkStroke = isNegative ? "#ef4444" : "#10b981";
  const sparkFillId = `metric-spark-${label?.replace(/\s/g, "-") ?? "default"}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="relative overflow-hidden rounded-xl p-4 h-full
        bg-gradient-to-br from-[var(--metric-from)] to-[var(--metric-to)]
        border border-border/40"
      style={
        {
          "--metric-from": isPositive
            ? "rgba(16,185,129,0.12)"
            : isNegative
              ? "rgba(239,68,68,0.12)"
              : "rgba(99,102,241,0.08)",
          "--metric-to": "transparent",
        } as React.CSSProperties
      }
    >
      {/* ── Ambient glow (top-right) ── */}
      <div
        className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full blur-2xl opacity-20"
        style={{
          background: isPositive
            ? "radial-gradient(circle, #10b981 0%, transparent 70%)"
            : isNegative
              ? "radial-gradient(circle, #ef4444 0%, transparent 70%)"
              : "radial-gradient(circle, #6366f1 0%, transparent 70%)",
        }}
      />

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
          <span className="text-[10px] text-muted-foreground/60">
            Snapshot {lastUpdated}
          </span>
        ) : null}
      </div>

      {/* ── Value + sparkline row ── */}
      <div className="flex items-end justify-between mt-1">
        <div className="space-y-1">
          {/* Animated number */}
          <div className="text-3xl font-bold tracking-tight tabular-nums text-foreground leading-none">
            {animatedValue}
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
                <span className="text-[10px] text-muted-foreground/70">
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

"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface ServiceMetricsBadgeProps {
  latencyP50?: number;
  uptimePercent?: number;
  errorRate?: number;
  className?: string;
}

function latencyColor(ms: number): string {
  if (ms <= 200) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
  if (ms <= 500) return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20";
  return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20";
}

function uptimeColor(pct: number): string {
  if (pct >= 99.9) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
  if (pct >= 99) return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20";
  return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20";
}

function errorRateColor(rate: number): string {
  if (rate <= 0.5) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
  if (rate <= 2) return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20";
  return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20";
}

export function ServiceMetricsBadge({
  latencyP50,
  uptimePercent,
  errorRate,
  className,
}: ServiceMetricsBadgeProps) {
  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
      {latencyP50 !== undefined && (
        <Badge variant="outline" className={cn("text-[11px]", latencyColor(latencyP50))}>
          p50: {latencyP50}ms
        </Badge>
      )}
      {uptimePercent !== undefined && (
        <Badge variant="outline" className={cn("text-[11px]", uptimeColor(uptimePercent))}>
          {uptimePercent.toFixed(1)}% uptime
        </Badge>
      )}
      {errorRate !== undefined && (
        <Badge variant="outline" className={cn("text-[11px]", errorRateColor(errorRate))}>
          {errorRate.toFixed(2)}% errors
        </Badge>
      )}
    </div>
  );
}

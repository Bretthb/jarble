"use client";

import { Progress } from "@/components/ui/progress";
import { HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";

interface StorageMeterProps {
  usedGb: number;
  totalGb: number;
  percentUsed: number;
  /** Compact mode for dashboard cards (no label, smaller) */
  compact?: boolean;
  className?: string;
}

/**
 * Visual storage usage meter with color-coded progress bar.
 * Green < 70%, Amber 70-90%, Red > 90%.
 */
export function StorageMeter({ usedGb, totalGb, percentUsed, compact = false, className }: StorageMeterProps) {
  // Color thresholds
  const colorClass =
    percentUsed >= 90
      ? "text-red-500"
      : percentUsed >= 70
        ? "text-amber-500"
        : "text-primary";

  const barClass =
    percentUsed >= 90
      ? "[&_[data-slot=progress-indicator]]:bg-red-500"
      : percentUsed >= 70
        ? "[&_[data-slot=progress-indicator]]:bg-amber-500"
        : "";

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2 min-w-0", className)}>
        <HardDrive className={cn("w-3 h-3 shrink-0", colorClass)} />
        <div className="flex-1 min-w-0">
          <Progress value={percentUsed} className={cn("h-1.5", barClass)} />
        </div>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {formatGb(usedGb)}/{formatGb(totalGb)} GB
        </span>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className={cn("w-4 h-4", colorClass)} />
          <span className="text-sm font-medium">Storage</span>
        </div>
        <span className={cn("text-sm font-mono", colorClass)}>
          {percentUsed}%
        </span>
      </div>
      <Progress value={percentUsed} className={cn("h-2", barClass)} />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatGb(usedGb)} GB used</span>
        <span>{formatGb(totalGb)} GB total</span>
      </div>
      {percentUsed >= 90 && (
        <p className="text-xs text-red-500 font-medium">
          Storage almost full - consider upgrading your plan.
        </p>
      )}
    </div>
  );
}

/** Format GB values: show 2 decimals for < 1GB, 1 decimal otherwise */
function formatGb(gb: number): string {
  if (gb < 1) return gb.toFixed(2);
  if (gb < 10) return gb.toFixed(1);
  return Math.round(gb).toString();
}

/**
 * Skeleton placeholder for loading state.
 */
export function StorageMeterSkeleton({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 animate-pulse">
        <div className="w-3 h-3 rounded bg-secondary" />
        <div className="flex-1 h-1.5 rounded-full bg-secondary" />
        <div className="w-16 h-3 rounded bg-secondary" />
      </div>
    );
  }

  return (
    <div className="space-y-2 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-secondary" />
          <div className="w-16 h-4 rounded bg-secondary" />
        </div>
        <div className="w-8 h-4 rounded bg-secondary" />
      </div>
      <div className="h-2 rounded-full bg-secondary" />
      <div className="flex items-center justify-between">
        <div className="w-20 h-3 rounded bg-secondary" />
        <div className="w-20 h-3 rounded bg-secondary" />
      </div>
    </div>
  );
}

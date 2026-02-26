/**
 * Shared StatusBadge component — displays deployment status with colored dot + text.
 * Uses warm charcoal-friendly tones. Compact design with subtle animations.
 * Used by Dashboard.tsx, Deployments.tsx, and workspace header.
 */

import { cn } from "@/lib/utils";

interface StatusConfig {
  dot: string;
  text: string;
  label: string;
  animate?: string;
}

// Warm-toned status palette for charcoal aesthetic
export const STATUS_CONFIG: Record<string, StatusConfig> = {
  running: {
    dot: "bg-emerald-400",
    text: "text-emerald-400",
    label: "Running",
    animate: "animate-pulse",
  },
  creating: {
    dot: "bg-amber-400",
    text: "text-amber-400",
    label: "Starting",
    animate: "animate-pulse",
  },
  restarting: {
    dot: "bg-amber-400",
    text: "text-amber-400",
    label: "Restarting",
    animate: "animate-pulse",
  },
  reloading: {
    dot: "bg-sky-400",
    text: "text-sky-400",
    label: "Reloading",
    animate: "animate-pulse",
  },
  stopping: {
    dot: "bg-orange-400",
    text: "text-orange-400",
    label: "Stopping",
    animate: "animate-pulse",
  },
  stopped: {
    dot: "bg-stone-400",
    text: "text-stone-400",
    label: "Stopped",
  },
  pending: {
    dot: "bg-stone-500",
    text: "text-stone-400",
    label: "Pending",
  },
  failed: {
    dot: "bg-red-400",
    text: "text-red-400",
    label: "Failed",
  },
};

const DEFAULT_CONFIG: StatusConfig = {
  dot: "bg-stone-500",
  text: "text-stone-400",
  label: "Unknown",
};

export function StatusBadge({
  status,
  compact = false,
}: {
  status: string;
  compact?: boolean;
}) {
  const config = STATUS_CONFIG[status] || {
    ...DEFAULT_CONFIG,
    label: status,
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5",
        !compact && "px-2 py-0.5 rounded-md bg-secondary/40"
      )}
    >
      {/* Status dot with optional glow for running state */}
      <span className="relative flex h-2 w-2">
        {config.animate && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full rounded-full opacity-40",
              config.dot,
              config.animate
            )}
          />
        )}
        <span
          className={cn("relative inline-flex h-2 w-2 rounded-full", config.dot)}
        />
      </span>
      <span
        className={cn(
          "text-xs font-medium leading-none",
          config.text
        )}
      >
        {config.label}
      </span>
    </div>
  );
}

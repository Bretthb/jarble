"use client";

/**
 * FlowExecutionTimeline -- bottom panel showing live execution progress
 * during flow runs in the Bot Team Builder.
 *
 * Displays a horizontal timeline with step dots, animated connectors,
 * and an expandable detail view for the selected step.
 */

import { memo, useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  X,
  ChevronUp,
  ChevronDown,
  Check,
  AlertCircle,
  Clock,
  Coins,
  SkipForward,
  ArrowRight,
  Loader2,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FlowExecutionStep {
  nodeId: string;
  label: string;
  role?: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  type?: "delegation" | "direct";
  task?: string;
  result?: string;
  durationMs?: number;
  credits?: number;
  startedAt?: string;
}

export interface FlowExecutionTimelineProps {
  steps: FlowExecutionStep[];
  totalCredits: number;
  status: "idle" | "running" | "completed" | "failed" | "paused";
  onClose: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = ((ms % 60_000) / 1000).toFixed(0);
  return `${mins}m ${secs}s`;
}

function formatCredits(credits: number): string {
  if (credits < 0.01) return "<0.01";
  return credits.toFixed(2);
}

// ── Step dot icon ────────────────────────────────────────────────────────────

const STEP_STYLES: Record<
  FlowExecutionStep["status"],
  {
    dotClass: string;
    ringClass: string;
    icon: React.ReactNode;
  }
> = {
  completed: {
    dotClass: "bg-emerald-500",
    ringClass: "ring-emerald-500/20",
    icon: <Check className="h-3 w-3 text-white" />,
  },
  running: {
    dotClass: "bg-primary",
    ringClass: "ring-primary/30",
    icon: <Loader2 className="h-3 w-3 text-white animate-spin" />,
  },
  failed: {
    dotClass: "bg-red-500",
    ringClass: "ring-red-500/20",
    icon: <AlertCircle className="h-3 w-3 text-white" />,
  },
  skipped: {
    dotClass: "bg-zinc-600",
    ringClass: "ring-zinc-600/20",
    icon: <SkipForward className="h-3 w-3 text-zinc-300" />,
  },
  pending: {
    dotClass: "bg-zinc-700 border border-zinc-500/40",
    ringClass: "",
    icon: null,
  },
};

function StepDot({
  step,
  isSelected,
  onClick,
}: {
  step: FlowExecutionStep;
  isSelected: boolean;
  onClick: () => void;
}) {
  const style = STEP_STYLES[step.status];

  return (
    <button
      onClick={onClick}
      className={`group relative flex flex-col items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-md px-1 py-1 transition-colors ${
        isSelected ? "bg-secondary/40" : "hover:bg-secondary/20"
      }`}
      aria-label={`${step.label} - ${step.status}`}
      title={step.task ?? step.label}
    >
      {/* Dot */}
      <div className="relative">
        {step.status === "running" && (
          <div className="absolute inset-0 -m-1 rounded-full bg-primary/20 animate-ping" />
        )}
        <div
          className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full ring-2 ${style.dotClass} ${style.ringClass} transition-all ${
            isSelected ? "scale-110 ring-primary/40" : ""
          }`}
        >
          {style.icon}
        </div>
      </div>

      {/* Label */}
      <div className="flex flex-col items-center max-w-[80px]">
        <span className="text-[11px] font-medium text-foreground/90 truncate max-w-full leading-tight">
          {step.label}
        </span>
        {step.role && (
          <span className="text-[10px] text-muted-foreground truncate max-w-full leading-tight">
            {step.role}
          </span>
        )}
        {step.status === "completed" && step.durationMs != null && (
          <span className="text-[10px] text-emerald-400/80 tabular-nums">
            {formatDuration(step.durationMs)}
          </span>
        )}
        {step.status === "running" && (
          <span className="text-[10px] text-primary/80 font-medium">
            running...
          </span>
        )}
        {step.status === "failed" && (
          <span className="text-[10px] text-red-400/80 font-medium">
            failed
          </span>
        )}
      </div>
    </button>
  );
}

// ── Connector line between steps ─────────────────────────────────────────────

function StepConnector({
  leftStatus,
  rightStatus,
}: {
  leftStatus: FlowExecutionStep["status"];
  rightStatus: FlowExecutionStep["status"];
}) {
  const isActive =
    leftStatus === "completed" &&
    (rightStatus === "running" || rightStatus === "completed");
  const isCompleted =
    leftStatus === "completed" && rightStatus === "completed";

  return (
    <div className="flex items-center self-start mt-[18px] -mx-0.5">
      <div className="relative h-[2px] w-8 sm:w-12">
        {/* Base line */}
        <div className="absolute inset-0 bg-zinc-700/60 rounded-full" />
        {/* Active overlay */}
        {(isActive || isCompleted) && (
          <div
            className={`absolute inset-0 rounded-full transition-all duration-500 ${
              isCompleted
                ? "bg-emerald-500/60"
                : "bg-primary/60"
            }`}
          />
        )}
        {/* Animated pulse for active connection */}
        {isActive && !isCompleted && (
          <div className="absolute inset-0 rounded-full bg-primary/40 animate-pulse" />
        )}
      </div>
    </div>
  );
}

// ── Overall status badge ─────────────────────────────────────────────────────

function FlowStatusBadge({
  status,
}: {
  status: FlowExecutionTimelineProps["status"];
}) {
  const config: Record<
    typeof status,
    { label: string; className: string }
  > = {
    idle: {
      label: "Idle",
      className: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    },
    running: {
      label: "Running",
      className: "bg-primary/20 text-primary border-primary/30",
    },
    completed: {
      label: "Completed",
      className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    },
    failed: {
      label: "Failed",
      className: "bg-red-500/20 text-red-400 border-red-500/30",
    },
    paused: {
      label: "Paused",
      className: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    },
  };

  const c = config[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${c.className}`}
    >
      {status === "running" && (
        <Loader2 className="h-3 w-3 animate-spin" />
      )}
      {c.label}
    </span>
  );
}

// ── Expanded detail panel ────────────────────────────────────────────────────

function StepDetailPanel({ step }: { step: FlowExecutionStep }) {
  const [showFullResult, setShowFullResult] = useState(false);

  const truncatedResult =
    step.result && step.result.length > 200 && !showFullResult
      ? step.result.slice(0, 200) + "..."
      : step.result;

  return (
    <div className="border-t border-border/30 bg-secondary/10 px-4 py-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-150">
      <div className="flex items-start gap-4">
        {/* Left: Bot info */}
        <div className="shrink-0 space-y-1">
          <div className="text-xs font-semibold text-foreground/90">
            {step.label}
          </div>
          {step.role && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {step.role}
            </Badge>
          )}
          {step.type && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <ArrowRight className="h-3 w-3" />
              {step.type === "delegation" ? "Delegated" : "Direct"}
            </div>
          )}
        </div>

        {/* Middle: Task + Result */}
        <div className="flex-1 min-w-0 space-y-2">
          {step.task && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-0.5">
                Task
              </div>
              <p className="text-xs text-foreground/80 leading-relaxed">
                {step.task}
              </p>
            </div>
          )}
          {step.result && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-0.5">
                Response
              </div>
              <p className="text-xs text-foreground/70 leading-relaxed whitespace-pre-wrap">
                {truncatedResult}
              </p>
              {step.result.length > 200 && (
                <button
                  onClick={() => setShowFullResult((p) => !p)}
                  className="mt-1 text-[11px] text-primary hover:text-primary/80 font-medium transition-colors"
                >
                  {showFullResult ? "Show less" : "Show full response"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right: Stats */}
        <div className="shrink-0 flex flex-col items-end gap-1.5 text-right">
          {step.durationMs != null && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
              <Clock className="h-3 w-3" />
              {formatDuration(step.durationMs)}
            </div>
          )}
          {step.credits != null && (
            <div className="flex items-center gap-1 text-[11px] text-amber-400/80 tabular-nums">
              <Coins className="h-3 w-3" />
              {formatCredits(step.credits)}
            </div>
          )}
          {step.startedAt && (
            <div className="text-[10px] text-muted-foreground/50">
              {new Date(step.startedAt).toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

function FlowExecutionTimelineInner({
  steps,
  totalCredits,
  status,
  onClose,
}: FlowExecutionTimelineProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedStepIdx, setSelectedStepIdx] = useState<number | null>(null);

  // Auto-select running step
  const activeIdx = useMemo(() => {
    const idx = steps.findIndex((s) => s.status === "running");
    return idx >= 0 ? idx : null;
  }, [steps]);

  const effectiveSelectedIdx = selectedStepIdx ?? activeIdx;
  const selectedStep =
    effectiveSelectedIdx != null ? steps[effectiveSelectedIdx] : null;

  const toggleExpanded = useCallback(() => {
    setIsExpanded((p) => !p);
  }, []);

  const completedCount = steps.filter((s) => s.status === "completed").length;
  const totalDuration = steps.reduce(
    (sum, s) => sum + (s.durationMs ?? 0),
    0
  );

  return (
    <div
      className={`shrink-0 border-t border-border/60 bg-background/95 backdrop-blur-xl flex flex-col transition-[height] duration-200 ease-out ${
        isExpanded ? "h-[300px]" : "h-[120px]"
      }`}
    >
      {/* ── Header bar ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border/30">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleExpanded}
            className="flex items-center gap-1.5 text-xs font-semibold text-foreground/90 hover:text-foreground transition-colors"
            aria-label={isExpanded ? "Collapse timeline" : "Expand timeline"}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
            Execution Timeline
          </button>
          <FlowStatusBadge status={status} />
          {status !== "idle" && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {completedCount}/{steps.length} steps
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Total duration */}
          {totalDuration > 0 && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
              <Clock className="h-3 w-3" />
              {formatDuration(totalDuration)}
            </div>
          )}
          {/* Total credits */}
          {totalCredits > 0 && (
            <div className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400 tabular-nums">
              <Coins className="h-3 w-3" />
              {formatCredits(totalCredits)} credits
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-6 w-6 p-0 rounded-md hover:bg-secondary/80 transition-colors"
            aria-label="Close timeline"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Timeline strip ────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-4 py-2 overflow-x-auto custom-scrollbar">
          <div className="flex items-start justify-center min-w-fit gap-0">
            {steps.map((step, i) => (
              <div key={step.nodeId} className="flex items-start">
                <StepDot
                  step={step}
                  isSelected={effectiveSelectedIdx === i}
                  onClick={() =>
                    setSelectedStepIdx(
                      selectedStepIdx === i ? null : i
                    )
                  }
                />
                {i < steps.length - 1 && (
                  <StepConnector
                    leftStatus={step.status}
                    rightStatus={steps[i + 1].status}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Expanded detail ───────────────────────────────────────── */}
        {isExpanded && selectedStep && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <StepDetailPanel step={selectedStep} />
          </div>
        )}

        {/* Empty state when expanded but nothing selected */}
        {isExpanded && !selectedStep && (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/50">
            Click a step to view details
          </div>
        )}
      </div>
    </div>
  );
}

export const FlowExecutionTimeline = memo(FlowExecutionTimelineInner);
export default FlowExecutionTimeline;

"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Clock, Zap, AlertCircle, SkipForward, CheckCircle2 } from "lucide-react";
import type { FlowStepStatus } from "@/hooks/useFlowExecution";

interface FlowTimeTravelProps {
  steps: Map<string, FlowStepStatus>;
  totalCredits: number;
  status: string;
}

function statusIcon(status: string) {
  switch (status) {
    case "completed": return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case "failed": return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
    case "skipped": return <SkipForward className="w-3.5 h-3.5 text-muted-foreground" />;
    case "running": return <Zap className="w-3.5 h-3.5 text-blue-400 animate-pulse" />;
    default: return <Clock className="w-3.5 h-3.5 text-muted-foreground/50" />;
  }
}

function statusColor(status: string) {
  switch (status) {
    case "completed": return "border-emerald-500/30 bg-emerald-500/5";
    case "failed": return "border-red-500/30 bg-red-500/5";
    case "skipped": return "border-muted-foreground/20 bg-muted/30";
    case "running": return "border-blue-500/30 bg-blue-500/5";
    default: return "border-border bg-card";
  }
}

function JsonPreview({ data, label }: { data: unknown; label: string }) {
  const [expanded, setExpanded] = useState(false);
  if (data === undefined || data === null) return null;
  const json = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const isLong = json.length > 120;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {label}
      </button>
      {expanded && (
        <pre className="mt-1 p-2 rounded bg-secondary/50 text-[10px] font-mono overflow-x-auto max-h-[200px] overflow-y-auto border border-border/40">
          {isLong ? json : json}
        </pre>
      )}
      {!expanded && isLong && (
        <span className="text-[9px] text-muted-foreground/60 ml-4">
          {json.slice(0, 80)}...
        </span>
      )}
    </div>
  );
}

/**
 * Time-travel debugging panel for completed flow executions.
 *
 * Shows each step's input/output pair, condition evaluations, visit count,
 * duration, and credits. Steps are listed in the order they appear in the
 * Map (insertion order = execution order).
 *
 * Renders below the flow canvas when an execution has completed/failed.
 * Collapsible per-step details with JSON preview for input snapshots
 * and results.
 */
export default function FlowTimeTravel({ steps, totalCredits, status }: FlowTimeTravelProps) {
  const stepEntries = [...steps.entries()];
  if (stepEntries.length === 0) return null;

  const completedCount = stepEntries.filter(([, s]) => s.status === "completed").length;
  const failedCount = stepEntries.filter(([, s]) => s.status === "failed").length;
  const totalDuration = stepEntries.reduce((sum, [, s]) => sum + (s.durationMs ?? 0), 0);

  return (
    <div className="border-t border-border/60 bg-card/50 backdrop-blur-sm">
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-border/40">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Execution Timeline
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>{completedCount}/{stepEntries.length} steps</span>
          {failedCount > 0 && <span className="text-red-400">{failedCount} failed</span>}
          <span>{(totalDuration / 1000).toFixed(1)}s</span>
          {totalCredits > 0 && <span>{totalCredits} credits</span>}
        </div>
      </div>

      {/* Step list */}
      <div className="max-h-[300px] overflow-y-auto divide-y divide-border/30">
        {stepEntries.map(([nodeId, step], idx) => (
          <StepRow key={nodeId} step={step} index={idx + 1} />
        ))}
      </div>
    </div>
  );
}

function StepRow({ step, index }: { step: FlowStepStatus; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`${statusColor(step.status)}`}>
      {/* Step header — always visible */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-secondary/30 transition-colors"
      >
        <span className="text-[10px] font-mono text-muted-foreground/60 w-4 shrink-0">
          {index}
        </span>
        {statusIcon(step.status)}
        <span className="text-xs font-medium text-foreground truncate flex-1">
          {step.label || step.nodeId}
        </span>
        {step.visitCount && step.visitCount > 1 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
            iter {step.visitCount}
          </span>
        )}
        {step.durationMs != null && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {step.durationMs < 1000
              ? `${step.durationMs}ms`
              : `${(step.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
        {step.credits != null && step.credits > 0 && (
          <span className="text-[10px] text-muted-foreground">{step.credits}cr</span>
        )}
        {open ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
      </button>

      {/* Expanded detail — input, output, conditions */}
      {open && (
        <div className="px-3 pb-2 pl-9 space-y-1">
          {/* Error */}
          {step.error && (
            <div className="text-[10px] text-red-400 bg-red-500/5 rounded px-2 py-1 border border-red-500/20">
              {step.error}
            </div>
          )}

          {/* Condition evaluations */}
          {step.conditionEvaluations && step.conditionEvaluations.length > 0 && (
            <div className="space-y-0.5">
              <span className="text-[10px] font-medium text-muted-foreground">Conditions:</span>
              {step.conditionEvaluations.map((ce, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px] ml-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${ce.result ? "bg-emerald-400" : "bg-red-400"}`} />
                  <code className="font-mono text-muted-foreground">{ce.condition}</code>
                  <span className="text-muted-foreground/60">→</span>
                  <span className={ce.result ? "text-emerald-400" : "text-red-400"}>
                    {ce.result ? "true" : "false"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Input snapshot */}
          <JsonPreview data={step.inputSnapshot} label="Input (resolved args)" />

          {/* Output/result */}
          <JsonPreview data={step.result} label="Output (result)" />
        </div>
      )}
    </div>
  );
}

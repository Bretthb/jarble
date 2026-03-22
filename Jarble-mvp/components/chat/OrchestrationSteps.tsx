"use client";

/**
 * OrchestrationSteps — Shows real-time agent orchestration progress in chat.
 *
 * Displays a step-by-step view of what internal agents are doing:
 * - Planning dashboard layout
 * - Generating components in parallel
 * - Running QA checks
 * - Delegating to linked agents
 *
 * Similar to Perplexity's search/reasoning display.
 */

import { memo } from "react";
import { cn } from "@/lib/utils";
import {
  Brain,
  Sparkles,
  Shield,
  CheckCircle2,
  Loader2,
  Zap,
  Bug,
  Layout,
  Clock,
} from "lucide-react";

export interface OrchestrationStep {
  id: string;
  label: string;
  status: "pending" | "running" | "complete" | "error";
  /** Agent type: planner, component, qa, debug, external */
  agent: "planner" | "component" | "qa" | "debug" | "external" | "tool";
  /** Optional sub-label (e.g. component intent) */
  detail?: string;
  /** Duration in ms (set on complete) */
  duration?: number;
}

interface OrchestrationStepsProps {
  steps: OrchestrationStep[];
  title?: string;
}

const AGENT_ICONS: Record<OrchestrationStep["agent"], typeof Brain> = {
  planner: Brain,
  component: Sparkles,
  qa: Shield,
  debug: Bug,
  external: Zap,
  tool: Layout,
};

const AGENT_COLORS: Record<OrchestrationStep["agent"], string> = {
  planner: "text-blue-500",
  component: "text-violet-500",
  qa: "text-emerald-500",
  debug: "text-amber-500",
  external: "text-cyan-500",
  tool: "text-indigo-500",
};

function OrchestrationStepsInner({ steps, title }: OrchestrationStepsProps) {
  if (steps.length === 0) return null;

  const completedCount = steps.filter((s) => s.status === "complete").length;
  const allDone = completedCount === steps.length;

  return (
    <div className="flex flex-col gap-1 px-4 py-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Header */}
      {title && (
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            {title}
          </span>
          {!allDone && (
            <span className="text-[10px] text-muted-foreground/40">
              {completedCount}/{steps.length}
            </span>
          )}
        </div>
      )}

      {/* Steps */}
      <div className="flex flex-col gap-0.5">
        {steps.map((step, i) => {
          const Icon = AGENT_ICONS[step.agent];
          const color = AGENT_COLORS[step.agent];

          return (
            <div
              key={step.id}
              className={cn(
                "flex items-center gap-2 py-1 px-2 rounded-md transition-all duration-300",
                step.status === "running" && "bg-primary/5",
                step.status === "complete" && "opacity-60",
                step.status === "pending" && "opacity-40",
              )}
              style={{
                animationDelay: `${i * 50}ms`,
              }}
            >
              {/* Status indicator */}
              {step.status === "running" && (
                <Loader2 className={cn("w-3 h-3 animate-spin shrink-0", color)} />
              )}
              {step.status === "complete" && (
                <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
              )}
              {step.status === "pending" && (
                <Clock className="w-3 h-3 text-muted-foreground/30 shrink-0" />
              )}
              {step.status === "error" && (
                <div className="w-3 h-3 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                  <span className="text-[8px] text-red-500">!</span>
                </div>
              )}

              {/* Agent icon */}
              <Icon className={cn("w-3 h-3 shrink-0", step.status === "running" ? color : "text-muted-foreground/40")} />

              {/* Label */}
              <span className={cn(
                "text-xs font-medium truncate",
                step.status === "running" ? "text-foreground/80" : "text-muted-foreground/60",
              )}>
                {step.label}
              </span>

              {/* Detail */}
              {step.detail && (
                <span className="text-[10px] text-muted-foreground/40 truncate hidden sm:inline">
                  {step.detail}
                </span>
              )}

              {/* Duration */}
              {step.status === "complete" && step.duration && (
                <span className="text-[10px] text-muted-foreground/30 ml-auto shrink-0">
                  {step.duration < 1000 ? `${step.duration}ms` : `${(step.duration / 1000).toFixed(1)}s`}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(OrchestrationStepsInner);

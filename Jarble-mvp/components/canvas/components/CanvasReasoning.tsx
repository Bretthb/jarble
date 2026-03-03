"use client";

import React, { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Brain, Check, Loader2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CanvasReasoningProps {
  title?: string;
  content: string;
  collapsed?: boolean;
  duration?: number;
  steps?: Array<{
    label: string;
    description?: string;
    status?: "complete" | "active" | "pending";
  }>;
}

const STATUS_ICON = {
  complete: <Check className="w-3.5 h-3.5 text-emerald-500" />,
  active: <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />,
  pending: <Circle className="w-3.5 h-3.5 text-muted-foreground-subtle" />,
} as const;

function CanvasReasoningInner({
  title = "Thinking...",
  content,
  collapsed = true,
  duration,
  steps,
}: CanvasReasoningProps) {
  const [open, setOpen] = useState(!collapsed);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="p-3 h-full"
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full text-left group"
        aria-expanded={open}
      >
        <Brain className="w-4 h-4 text-muted-foreground-subtle shrink-0" />
        <span className="text-sm font-medium text-foreground/80">{title}</span>
        {duration != null && (
          <span className="text-xs text-muted-foreground-subtle tabular-nums">
            {duration.toFixed(1)}s
          </span>
        )}
        <ChevronRight
          className={cn(
            "w-3.5 h-3.5 ml-auto text-muted-foreground-subtle transition-transform",
            open && "rotate-90"
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 pl-6 border-l-2 border-muted text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {content}
            </div>

            {steps && steps.length > 0 && (
              <div className="mt-3 pl-6 space-y-1.5">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0">
                      {STATUS_ICON[step.status || "pending"]}
                    </span>
                    <div>
                      <span className="text-sm font-medium text-foreground/80">
                        {step.label}
                      </span>
                      {step.description && (
                        <p className="text-xs text-muted-foreground-subtle">
                          {step.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default memo(CanvasReasoningInner);

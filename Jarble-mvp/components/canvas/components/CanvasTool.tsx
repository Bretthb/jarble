"use client";

import React, { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Wrench, Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FadeIn } from "../FadeIn";

export interface CanvasToolProps {
  name: string;
  description?: string;
  status: "running" | "complete" | "error";
  inputs?: Record<string, unknown>;
  output?: string | Record<string, unknown>;
  error?: string;
  duration?: number;
}

const STATUS_CONFIG = {
  running: { icon: Loader2, label: "Running", color: "text-blue-500", bg: "bg-blue-500/10", spin: true },
  complete: { icon: Check, label: "Complete", color: "text-emerald-500", bg: "bg-emerald-500/10", spin: false },
  error: { icon: X, label: "Error", color: "text-red-500", bg: "bg-red-500/10", spin: false },
} as const;

function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre className="text-xs bg-muted/50 rounded-md p-2 overflow-x-auto max-h-48 font-mono text-foreground/80">
      {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
    </pre>
  );
}

function Section({ title, open: defaultOpen, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground-subtle hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <ChevronRight className={cn("w-3 h-3 transition-transform", open && "rotate-90")} />
        {title}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mt-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CanvasToolInner({ name, description, status, inputs, output, error, duration }: CanvasToolProps) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.running;
  const Icon = cfg.icon;

  return (
    <FadeIn className="p-3 h-full space-y-2">
      <div className="flex items-center gap-2">
        <Wrench className="w-4 h-4 text-muted-foreground-subtle shrink-0" />
        <code className="text-sm font-medium font-mono text-foreground/90">{name}</code>
        <span className={cn("inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full", cfg.bg, cfg.color)}>
          <Icon className={cn("w-3 h-3", cfg.spin && "animate-spin")} />
          {cfg.label}
        </span>
        {duration != null && (
          <span className="text-xs text-muted-foreground-subtle tabular-nums ml-auto">
            {duration.toFixed(1)}s
          </span>
        )}
      </div>

      {description && (
        <p className="text-xs text-muted-foreground-subtle pl-6">{description}</p>
      )}

      {inputs && Object.keys(inputs).length > 0 && (
        <div className="pl-6">
          <Section title="Inputs" open={status === "running"}>
            <JsonBlock data={inputs} />
          </Section>
        </div>
      )}

      {status === "error" && error && (
        <div className="pl-6">
          <Section title="Error" open>
            <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
          </Section>
        </div>
      )}

      {status === "complete" && output != null && (
        <div className="pl-6">
          <Section title="Output" open={false}>
            <JsonBlock data={output} />
          </Section>
        </div>
      )}
    </FadeIn>
  );
}

export default memo(CanvasToolInner);

"use client";

import { memo } from "react";
import { motion } from "framer-motion";

export interface CanvasProgressProps {
  label?: string;
  value: number;
  variant?: "default" | "success" | "warning" | "error";
}

const BAR_GRADIENT: Record<string, string> = {
  default: "from-primary/80 to-primary",
  success: "from-emerald-400 to-emerald-500",
  warning: "from-amber-400 to-amber-500",
  error: "from-red-400 to-red-500",
};

function CanvasProgressInner({ label, value, variant = "default" }: CanvasProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const gradient = BAR_GRADIENT[variant] || BAR_GRADIENT.default;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="p-4 h-full flex flex-col justify-center gap-2"
    >
      <div className="flex items-center justify-between">
        {label && (
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
        )}
        <span className="text-xl font-bold tabular-nums text-foreground ml-auto tracking-tight">
          {clamped}
          <span className="text-sm font-semibold text-muted-foreground">%</span>
        </span>
      </div>
      <div className="relative h-2.5 rounded-full bg-secondary/60 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
          className={`h-full rounded-full bg-gradient-to-r ${gradient}`}
        />
      </div>
    </motion.div>
  );
}

export default memo(CanvasProgressInner);

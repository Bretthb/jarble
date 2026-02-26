"use client";

import { motion } from "framer-motion";

export interface CanvasProgressProps {
  label?: string;
  value: number;
  variant?: "default" | "success" | "warning" | "error";
}

const BAR_CLASSES: Record<string, string> = {
  default: "bg-primary",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

export default function CanvasProgress({ label, value, variant = "default" }: CanvasProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className="p-3 h-full flex flex-col justify-center gap-2">
      <div className="flex items-center justify-between">
        {label && (
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        )}
        <span className="text-sm font-semibold tabular-nums text-foreground ml-auto">
          {clamped}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
          className={`h-full rounded-full ${BAR_CLASSES[variant] || BAR_CLASSES.default}`}
        />
      </div>
    </div>
  );
}

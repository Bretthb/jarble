"use client";

import { memo, useEffect, useRef, useState } from "react";
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

const GLOW_COLOR: Record<string, string> = {
  default: "shadow-primary/40",
  success: "shadow-emerald-500/40",
  warning: "shadow-amber-500/40",
  error: "shadow-red-500/40",
};

function useAnimatedNumber(target: number, duration = 700): string {
  const [display, setDisplay] = useState("0");
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    startRef.current = null;
    const animate = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * target).toString());
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return display;
}

function CanvasProgressInner({ label, value, variant = "default" }: CanvasProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const animatedValue = useAnimatedNumber(clamped);
  const gradient = BAR_GRADIENT[variant] || BAR_GRADIENT.default;
  const glow = GLOW_COLOR[variant] || GLOW_COLOR.default;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="p-3 h-full flex flex-col justify-center gap-2"
    >
      <div className="flex items-center justify-between">
        {label && (
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
        )}
        <span className="text-xl font-bold tabular-nums text-foreground ml-auto tracking-tight">
          {animatedValue}
          <span className="text-sm font-semibold text-muted-foreground">%</span>
        </span>
      </div>
      <div className="relative h-2.5 rounded-full bg-secondary/60 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
          className={`h-full rounded-full bg-gradient-to-r ${gradient} shadow-lg ${glow}`}
        />
        {/* Glow highlight at the fill edge */}
        <motion.div
          initial={{ left: "0%" }}
          animate={{ left: `${clamped}%` }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-5 w-5 rounded-full blur-md opacity-50 bg-gradient-to-r ${gradient}`}
        />
      </div>
    </motion.div>
  );
}

export default memo(CanvasProgressInner);

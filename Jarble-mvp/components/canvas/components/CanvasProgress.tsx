"use client";

import { memo, useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { FadeIn } from "../FadeIn";

export interface CanvasProgressProps {
  label?: string;
  value: number;
  variant?: "default" | "success" | "warning" | "error";
}

// ---------------------------------------------------------------------------
// Animated count-up hook for the percentage display
// ---------------------------------------------------------------------------

function useCountUp(target: number, duration = 1200) {
  const [current, setCurrent] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true });

  useEffect(() => {
    if (!isInView) return;
    const startTime = performance.now();
    let raf: number;

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(target * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, isInView]);

  return { current, ref };
}

// ---------------------------------------------------------------------------
// Variant style maps
// ---------------------------------------------------------------------------

const BAR_GRADIENT: Record<string, string> = {
  default: "from-primary/80 to-primary",
  success: "from-emerald-400 to-emerald-500",
  warning: "from-amber-400 to-amber-500",
  error: "from-red-400 to-red-500",
};

const BORDER_ACCENT: Record<string, string> = {
  default: "from-primary/70 to-primary",
  success: "from-emerald-400 to-teal-500",
  warning: "from-amber-400 to-orange-500",
  error: "from-red-400 to-rose-500",
};

const BG_TINT: Record<string, string> = {
  default: "",
  success: "bg-gradient-to-br from-emerald-50/30 to-transparent dark:from-emerald-950/10 dark:to-transparent",
  warning: "bg-gradient-to-br from-amber-50/30 to-transparent dark:from-amber-950/10 dark:to-transparent",
  error: "bg-gradient-to-br from-red-50/30 to-transparent dark:from-red-950/10 dark:to-transparent",
};

const GLOW_COLOR: Record<string, string> = {
  default: "bg-primary/40",
  success: "bg-emerald-500/40",
  warning: "bg-amber-500/40",
  error: "bg-red-500/40",
};

function CanvasProgressInner({ label, value, variant = "default" }: CanvasProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const gradient = BAR_GRADIENT[variant] || BAR_GRADIENT.default;
  const borderGradient = BORDER_ACCENT[variant] || BORDER_ACCENT.default;
  const bgTint = BG_TINT[variant] || "";
  const glowColor = GLOW_COLOR[variant] || GLOW_COLOR.default;
  const countUp = useCountUp(clamped, 1400);

  return (
    <FadeIn
      className={[
        "relative overflow-hidden p-4 h-full flex flex-col justify-center gap-3",
        "rounded-xl border border-border/40",
        "shadow-sm dark:shadow-md dark:shadow-black/15",
        bgTint,
      ].join(" ")}
    >
      {/* Gradient left border accent */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl bg-gradient-to-b ${borderGradient}`} />

      {/* Label + animated percentage */}
      <div className="flex items-end justify-between pl-2">
        {label && (
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
        )}
        <div ref={countUp.ref} className="ml-auto">
          <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground leading-none">
            {countUp.current}
          </span>
          <span className="text-sm font-semibold text-muted-foreground ml-0.5">%</span>
        </div>
      </div>

      {/* Progress bar with glow */}
      <div className="pl-2">
        <div
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label || "Progress"}
          className="relative h-2.5 rounded-full bg-secondary/60 dark:bg-white/[0.06] overflow-hidden"
        >
          {/* Glow layer (blurred duplicate) */}
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${clamped}%` }}
            transition={{ duration: 1, ease: [0.25, 0.46, 0.45, 0.94] }}
            className={`absolute inset-0 h-full rounded-full ${glowColor}`}
            style={{ filter: "blur(6px)" }}
          />
          {/* Actual progress bar */}
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${clamped}%` }}
            transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
            className={`relative h-full rounded-full bg-gradient-to-r ${gradient}`}
          />
        </div>
      </div>
    </FadeIn>
  );
}

export default memo(CanvasProgressInner);

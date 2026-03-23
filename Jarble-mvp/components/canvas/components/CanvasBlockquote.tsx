"use client";

import { memo } from "react";
import { FadeIn } from "../FadeIn";

export interface CanvasBlockquoteProps {
  text: string;
  attribution?: string;
  variant?: "default" | "info" | "warning";
}

const VARIANT_GRADIENT: Record<string, string> = {
  default: "from-muted-foreground/60 to-muted-foreground/30",
  info: "from-blue-400 to-blue-600",
  warning: "from-amber-400 to-amber-600",
};

const VARIANT_BG: Record<string, string> = {
  default: "from-muted/20 to-transparent dark:from-white/[0.02] dark:to-transparent",
  info: "from-blue-50/30 to-transparent dark:from-blue-950/10 dark:to-transparent",
  warning: "from-amber-50/30 to-transparent dark:from-amber-950/10 dark:to-transparent",
};

function CanvasBlockquoteInner({ text, attribution, variant = "default" }: CanvasBlockquoteProps) {
  const borderGradient = VARIANT_GRADIENT[variant] || VARIANT_GRADIENT.default;
  const bgTint = VARIANT_BG[variant] || VARIANT_BG.default;

  return (
    <FadeIn
      className={[
        "relative overflow-hidden rounded-xl",
        "border border-border/40",
        "shadow-sm dark:shadow-md dark:shadow-black/15",
        "bg-gradient-to-br",
        bgTint,
      ].join(" ")}
    >
      {/* Gradient left border accent */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl bg-gradient-to-b ${borderGradient}`} />

      {/* Decorative open-quote mark */}
      <svg
        className="absolute top-3 left-5 text-muted-foreground/[0.07] dark:text-white/[0.04]"
        width="40"
        height="32"
        viewBox="0 0 40 32"
        fill="currentColor"
        aria-hidden
      >
        <path d="M12.5 16c-1.4 0-2.7-.3-3.8-.8.3-3.2 1.5-6 3.5-8.4 1-1.2.8-3-.4-4s-3-.8-4 .4C4.6 7 2.5 11.8 2.5 17.5 2.5 24.4 6.6 28 11 28c3.3 0 6-2.7 6-6s-2-6-4.5-6zm18 0c-1.4 0-2.7-.3-3.8-.8.3-3.2 1.5-6 3.5-8.4 1-1.2.8-3-.4-4s-3-.8-4 .4C22.6 7 20.5 11.8 20.5 17.5c0 6.9 4.1 10.5 8.5 10.5 3.3 0 6-2.7 6-6s-2-6-4.5-6z" />
      </svg>

      <blockquote className="relative p-5 pl-6">
        <p className="text-base leading-relaxed text-foreground/90 italic">
          {text}
        </p>
        {attribution && (
          <>
            <div className="mt-3 h-px w-12 bg-gradient-to-r from-border/60 to-transparent" />
            <footer className="mt-2 text-xs font-medium text-muted-foreground/70">
              — {attribution}
            </footer>
          </>
        )}
      </blockquote>
    </FadeIn>
  );
}

export default memo(CanvasBlockquoteInner);

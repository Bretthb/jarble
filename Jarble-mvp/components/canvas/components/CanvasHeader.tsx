"use client";

import { memo } from "react";
import { motion } from "framer-motion";

export interface CanvasHeaderProps {
  title: string;
  subtitle?: string;
  level?: 1 | 2 | 3;
  divider?: boolean;
}

const LEVEL_STYLES: Record<number, string> = {
  1: "text-xl font-bold tracking-tight",
  2: "text-base font-semibold tracking-tight",
  3: "text-sm font-semibold",
};

function CanvasHeaderInner({ title, subtitle, level = 2, divider = false }: CanvasHeaderProps) {
  const headingStyle = LEVEL_STYLES[level] || LEVEL_STYLES[2];
  const isH1 = level === 1;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
      className="space-y-1"
    >
      <h3
        className={`${headingStyle} ${
          isH1
            ? "bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent"
            : "text-foreground"
        }`}
      >
        {title}
      </h3>
      {subtitle && (
        <p className="text-xs text-muted-foreground/80 leading-relaxed">{subtitle}</p>
      )}
      {(divider || isH1) && (
        <div className="h-0.5 w-12 rounded-full bg-gradient-to-r from-primary/60 to-transparent mt-1" />
      )}
    </motion.div>
  );
}

export default memo(CanvasHeaderInner);

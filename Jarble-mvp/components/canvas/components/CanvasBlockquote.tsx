"use client";

import { memo } from "react";
import { motion } from "framer-motion";

export interface CanvasBlockquoteProps {
  text: string;
  attribution?: string;
  variant?: "default" | "info" | "warning";
}

const VARIANT_STYLES: Record<string, string> = {
  default: "border-l-muted-foreground/50",
  info: "border-l-blue-500",
  warning: "border-l-yellow-500",
};

function CanvasBlockquoteInner({ text, attribution, variant = "default" }: CanvasBlockquoteProps) {
  const borderStyle = VARIANT_STYLES[variant] || VARIANT_STYLES.default;

  return (
    <motion.blockquote
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`border-l-4 ${borderStyle} bg-muted/30 rounded-lg p-4`}
    >
      <p className="text-sm text-foreground italic">{text}</p>
      {attribution && (
        <footer className="mt-1.5 text-xs text-muted-foreground">
          — {attribution}
        </footer>
      )}
    </motion.blockquote>
  );
}

export default memo(CanvasBlockquoteInner);

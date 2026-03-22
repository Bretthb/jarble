"use client";

import { memo } from "react";
import { motion } from "framer-motion";

export interface CanvasDividerProps {
  label?: string;
  variant?: "solid" | "dashed" | "dotted";
  spacing?: "sm" | "md" | "lg";
}

const SPACING_CLASSES: Record<string, string> = {
  sm: "my-2",
  md: "my-4",
  lg: "my-6",
};

const VARIANT_STYLES: Record<string, string> = {
  solid: "border-solid",
  dashed: "border-dashed",
  dotted: "border-dotted",
};

function CanvasDividerInner({ label, variant = "solid", spacing = "md" }: CanvasDividerProps) {
  const spacingClass = SPACING_CLASSES[spacing] || SPACING_CLASSES.md;
  const variantStyle = VARIANT_STYLES[variant] || VARIANT_STYLES.solid;

  if (label) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="p-4"
      >
        <div className={`flex items-center gap-3 ${spacingClass}`}>
          <div role="separator" className={`flex-1 border-t border-border ${variantStyle}`} />
          <span className="text-xs text-muted-foreground shrink-0">{label}</span>
          <div className={`flex-1 border-t border-border ${variantStyle}`} />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-4"
    >
      <div role="separator" className={`border-t border-border ${variantStyle} ${spacingClass}`} />
    </motion.div>
  );
}

export default memo(CanvasDividerInner);

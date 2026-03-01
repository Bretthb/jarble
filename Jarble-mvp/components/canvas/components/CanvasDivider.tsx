"use client";

import { memo } from "react";

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
      <div className={`flex items-center gap-3 ${spacingClass}`}>
        <div className={`flex-1 border-t border-border ${variantStyle}`} />
        <span className="text-xs text-muted-foreground shrink-0">{label}</span>
        <div className={`flex-1 border-t border-border ${variantStyle}`} />
      </div>
    );
  }

  return <div className={`border-t border-border ${variantStyle} ${spacingClass}`} />;
}

export default memo(CanvasDividerInner);

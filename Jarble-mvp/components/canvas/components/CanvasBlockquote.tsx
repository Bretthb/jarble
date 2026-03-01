"use client";

import { memo } from "react";

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
    <blockquote className={`border-l-4 ${borderStyle} pl-4 py-1`}>
      <p className="text-sm text-foreground italic">{text}</p>
      {attribution && (
        <footer className="mt-1.5 text-xs text-muted-foreground">
          — {attribution}
        </footer>
      )}
    </blockquote>
  );
}

export default memo(CanvasBlockquoteInner);

"use client";

import { memo } from "react";
import { FadeIn } from "../FadeIn";

export interface CanvasBadgeProps {
  text: string;
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "positive" | "warning" | "info";
  icon?: string;
}

const VARIANT_STYLES: Record<string, string> = {
  default: "bg-primary/15 text-primary border-primary/30",
  secondary: "bg-secondary text-secondary-foreground border-border",
  destructive: "bg-red-500/15 text-red-400 border-red-500/30",
  outline: "bg-transparent text-foreground border-border",
  success: "bg-green-500/15 text-green-400 border-green-500/30",
  positive: "bg-green-500/15 text-green-400 border-green-500/30",
  warning: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  info: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

function CanvasBadgeInner({ text, variant = "default", icon }: CanvasBadgeProps) {
  const style = VARIANT_STYLES[variant] || VARIANT_STYLES.default;

  return (
    <FadeIn className="px-4 py-2">
      <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${style}`}>
        {icon && <span>{icon}</span>}
        {text}
      </span>
    </FadeIn>
  );
}

export default memo(CanvasBadgeInner);

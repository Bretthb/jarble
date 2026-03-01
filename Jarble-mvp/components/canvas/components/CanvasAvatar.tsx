"use client";

import { memo } from "react";
import { motion } from "framer-motion";

export interface CanvasAvatarProps {
  name: string;
  src?: string;
  subtitle?: string;
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASSES: Record<string, { container: string; text: string }> = {
  sm: { container: "w-8 h-8", text: "text-xs" },
  md: { container: "w-10 h-10", text: "text-sm" },
  lg: { container: "w-14 h-14", text: "text-lg" },
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function CanvasAvatarInner({ name, src, subtitle, size = "md" }: CanvasAvatarProps) {
  const sizeClasses = SIZE_CLASSES[size] || SIZE_CLASSES.md;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-4 flex items-center gap-3"
    >
      <div
        className={`${sizeClasses.container} rounded-full shrink-0 overflow-hidden bg-primary/15 border border-primary/30 flex items-center justify-center`}
      >
        {src ? (
          <img src={src} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span className={`${sizeClasses.text} font-semibold text-primary`}>
            {getInitials(name)}
          </span>
        )}
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{name}</p>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </motion.div>
  );
}

export default memo(CanvasAvatarInner);

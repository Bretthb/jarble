"use client";

import { memo } from "react";
import { motion } from "framer-motion";

const COLORS = [
  "#f50", "#2db7f5", "#87d068", "#108ee9",
  "#ff85c0", "#ffd666", "#b37feb", "#5cdbd3",
];

export interface CanvasTagCloudProps {
  tags: { text: string; color?: string; size?: "small" | "medium" | "large" }[];
  title?: string;
}

const sizeClasses = {
  small: "text-xs px-2 py-0.5",
  medium: "text-sm px-2.5 py-1",
  large: "text-base px-3 py-1.5",
} as const;

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  // Handle shorthand hex like #f50
  let cleanHex = hex.replace("#", "");
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(cleanHex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function CanvasTagCloudInner({ tags, title }: CanvasTagCloudProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-4 h-full"
    >
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-3">
          {title}
        </h3>
      )}
      <div className="flex flex-wrap gap-2">
        {tags.map((tag, i) => {
          const color = tag.color || COLORS[i % COLORS.length];
          const rgb = hexToRgb(color);
          const bgColor = rgb
            ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`
            : `${color}26`;

          return (
            <span
              key={`${tag.text}-${i}`}
              className={`inline-flex items-center rounded-full font-medium ${sizeClasses[tag.size || "medium"]}`}
              style={{
                backgroundColor: bgColor,
                color: color,
              }}
            >
              {tag.text}
            </span>
          );
        })}
      </div>
    </motion.div>
  );
}

export default memo(CanvasTagCloudInner);

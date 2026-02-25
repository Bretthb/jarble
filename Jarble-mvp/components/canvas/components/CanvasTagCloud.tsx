"use client";

import { Tag } from "antd";
import AntThemeProvider from "../AntThemeProvider";

const COLORS = [
  "#f50", "#2db7f5", "#87d068", "#108ee9",
  "#ff85c0", "#ffd666", "#b37feb", "#5cdbd3",
];

export interface CanvasTagCloudProps {
  tags: { text: string; color?: string; size?: "small" | "medium" | "large" }[];
  title?: string;
}

export default function CanvasTagCloud({ tags, title }: CanvasTagCloudProps) {
  const sizeMap = { small: "text-xs", medium: "text-sm", large: "text-base" };

  return (
    <AntThemeProvider>
      <div className="rounded-xl border border-border bg-card p-4">
        {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
        <div className="flex flex-wrap gap-2">
          {tags.map((tag, i) => (
            <Tag
              key={i}
              color={tag.color || COLORS[i % COLORS.length]}
              className={sizeMap[tag.size || "medium"]}
            >
              {tag.text}
            </Tag>
          ))}
        </div>
      </div>
    </AntThemeProvider>
  );
}

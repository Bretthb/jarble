"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { useCanvasAction } from "../CanvasActionContext";

interface ListItem {
  text: string;
  description?: string;
  icon?: string;
  badge?: string;
  badgeVariant?: string;
}

export interface CanvasListProps {
  title?: string;
  items: ListItem[];
  ordered?: boolean;
}

const BADGE_STYLES: Record<string, string> = {
  default: "bg-primary/15 text-primary border-primary/30",
  success: "bg-green-500/15 text-green-400 border-green-500/30",
  warning: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  destructive: "bg-red-500/15 text-red-400 border-red-500/30",
  info: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

function CanvasListInner({ title, items, ordered = false }: CanvasListProps) {
  let dispatch: ReturnType<typeof useCanvasAction>["dispatch"] | null = null;
  try {
    const ctx = useCanvasAction();
    dispatch = ctx.dispatch;
  } catch {
    // Not inside CanvasActionProvider — interactivity disabled
  }

  if (!Array.isArray(items) || items.length === 0) return null;

  const Tag = ordered ? "ol" : "ul";

  const handleItemClick = (index: number, item: ListItem) => {
    if (!dispatch) return;
    dispatch({
      action: "item_click",
      payload: { index, text: item.text, description: item.description, badge: item.badge },
    });
  };

  return (
    <div className="p-4 h-full">
      {title && <h3 className="text-sm font-semibold text-foreground mb-2">{title}</h3>}
      <Tag className="space-y-0.5">
        {items.map((item, i) => (
          <motion.li
            key={`${item.text}-${i}`}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              duration: 0.3,
              delay: i * 0.04,
              ease: [0.25, 0.46, 0.45, 0.94],
            }}
            className="flex items-start gap-2.5 py-1.5 cursor-pointer rounded-lg hover:bg-accent/40 transition-colors duration-150 px-1.5 border-b border-transparent last:border-0 [&:not(:last-child)]:border-border/20"
            onClick={() => handleItemClick(i, item)}
          >
            {item.icon ? (
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-secondary/60 text-sm shrink-0 mt-0.5">
                {item.icon}
              </span>
            ) : ordered ? (
              <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary/10 text-[10px] font-bold text-primary shrink-0 mt-0.5">
                {i + 1}
              </span>
            ) : (
              <span className="shrink-0 mt-2 w-1.5 h-1.5 rounded-full bg-primary/50" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground">{item.text}</span>
                {item.badge && (
                  <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${BADGE_STYLES[item.badgeVariant || "default"] || BADGE_STYLES.default}`}>
                    {item.badge}
                  </span>
                )}
              </div>
              {item.description && (
                <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">{item.description}</p>
              )}
            </div>
          </motion.li>
        ))}
      </Tag>
    </div>
  );
}

export default memo(CanvasListInner);

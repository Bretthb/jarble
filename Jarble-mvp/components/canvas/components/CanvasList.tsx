"use client";

import { memo } from "react";
import { FadeIn } from "../FadeIn";
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
  default: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-inset ring-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-inset ring-amber-500/20",
  destructive: "bg-red-500/10 text-red-600 dark:text-red-400 ring-1 ring-inset ring-red-500/20",
  info: "bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/20",
};

const ICON_BG: Record<string, string> = {
  default: "bg-gradient-to-br from-secondary/80 to-secondary/50 dark:from-white/[0.08] dark:to-white/[0.04]",
  success: "bg-gradient-to-br from-emerald-100 to-emerald-50 dark:from-emerald-500/20 dark:to-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "bg-gradient-to-br from-amber-100 to-amber-50 dark:from-amber-500/20 dark:to-amber-500/10 text-amber-600 dark:text-amber-400",
  destructive: "bg-gradient-to-br from-red-100 to-red-50 dark:from-red-500/20 dark:to-red-500/10 text-red-600 dark:text-red-400",
  info: "bg-gradient-to-br from-blue-100 to-blue-50 dark:from-blue-500/20 dark:to-blue-500/10 text-blue-600 dark:text-blue-400",
};

function CanvasListInner({ title, items, ordered = false }: CanvasListProps) {
  let dispatch: ReturnType<typeof useCanvasAction>["dispatch"] | null = null;
  try {
    const ctx = useCanvasAction();
    dispatch = ctx.dispatch;
  } catch {
    // Not inside CanvasActionProvider - interactivity disabled
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
    <FadeIn
      className={[
        "overflow-hidden rounded-xl",
        "border border-border/40",
        "shadow-sm dark:shadow-md dark:shadow-black/15",
      ].join(" ")}
    >
      {/* Title header with gradient separator */}
      {title && (
        <div className="px-4 py-3 border-b border-border/30">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <div className="mt-2 h-px w-full bg-gradient-to-r from-primary/30 via-border/20 to-transparent" />
        </div>
      )}

      <Tag aria-label={title || "List"} className={title ? "" : "pt-1"}>
        {items.map((item, i) => {
          const badgeVariant = item.badgeVariant || "default";
          const iconBg = ICON_BG[badgeVariant] || ICON_BG.default;

          return (
            <li
              key={`${item.text}-${i}`}
              className={[
                "group relative flex items-start gap-3 px-4 py-2.5",
                "cursor-pointer transition-all duration-200",
                "hover:bg-accent/50 dark:hover:bg-white/[0.04]",
                "hover:scale-[1.01]",
                i < items.length - 1 ? "border-b border-border/15" : "",
              ].join(" ")}
              onClick={() => handleItemClick(i, item)}
            >
              {/* Left accent bar on hover */}
              <div className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-primary/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

              {/* Icon / number / bullet */}
              {item.icon ? (
                <span
                  className={[
                    "inline-flex items-center justify-center h-7 w-7 rounded-full text-sm shrink-0 mt-0.5",
                    "shadow-sm",
                    iconBg,
                  ].join(" ")}
                >
                  {item.icon}
                </span>
              ) : ordered ? (
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-primary/15 to-primary/5 text-[10px] font-bold text-primary shrink-0 mt-0.5">
                  {i + 1}
                </span>
              ) : (
                <span className="shrink-0 mt-2 w-1.5 h-1.5 rounded-full bg-primary/50" />
              )}

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-foreground">{item.text}</span>
                  {item.badge && (
                    <span
                      className={[
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        BADGE_STYLES[badgeVariant] || BADGE_STYLES.default,
                      ].join(" ")}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
                {item.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.description}</p>
                )}
              </div>
            </li>
          );
        })}
      </Tag>
    </FadeIn>
  );
}

export default memo(CanvasListInner);

"use client";

import { memo } from "react";
import { FadeIn } from "../FadeIn";
import MarkdownMessage from "@/components/MarkdownMessage";

export interface CanvasCardProps {
  title?: string;
  subtitle?: string;
  body?: string;
  content?: string;
  icon?: string;
  status?: "info" | "success" | "warning" | "error";
  live?: boolean;
  lastUpdated?: string;
}

/**
 * Status-to-gradient mappings for the top accent stripe.
 * Uses gradient instead of solid color for a premium feel.
 */
const STATUS_ACCENT_GRADIENT: Record<string, string> = {
  info: "from-blue-400 via-blue-500 to-indigo-500",
  success: "from-emerald-400 via-emerald-500 to-teal-500",
  warning: "from-amber-400 via-amber-500 to-orange-500",
  error: "from-red-400 via-red-500 to-rose-500",
};

const STATUS_BADGE_BG: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-blue-500/20",
  success:
    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20",
  warning:
    "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20",
  error: "bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20",
};

/** Soft background tint based on status for the card body */
const STATUS_BG_TINT: Record<string, string> = {
  info: "bg-gradient-to-br from-blue-50/50 to-transparent dark:from-blue-950/20 dark:to-transparent",
  success: "bg-gradient-to-br from-emerald-50/50 to-transparent dark:from-emerald-950/20 dark:to-transparent",
  warning: "bg-gradient-to-br from-amber-50/50 to-transparent dark:from-amber-950/20 dark:to-transparent",
  error: "bg-gradient-to-br from-red-50/50 to-transparent dark:from-red-950/20 dark:to-transparent",
};

/** Icon background circles colored by status */
const STATUS_ICON_BG: Record<string, string> = {
  info: "bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400",
  success: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400",
  error: "bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400",
};

/** Pulsing live-indicator dot */
function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  );
}

function CanvasCardInner({
  title,
  subtitle,
  body,
  content,
  icon,
  status,
  live,
  lastUpdated,
}: CanvasCardProps) {
  const accentGradient = status
    ? STATUS_ACCENT_GRADIENT[status]
    : "from-primary/80 via-primary to-primary/80";

  const bgTint = status ? STATUS_BG_TINT[status] : "";

  const iconBg = status
    ? STATUS_ICON_BG[status]
    : "bg-primary/10 dark:bg-primary/15 text-primary";

  return (
    <FadeIn
      role="article"
      aria-label={title || "Card"}
      className={[
        "group h-full flex flex-col overflow-hidden rounded-xl",
        "bg-card border border-border/50",
        "shadow-sm hover:shadow-md dark:shadow-md dark:shadow-black/20 dark:hover:shadow-lg dark:hover:shadow-black/30",
        "transition-shadow duration-300 ease-out",
      ].join(" ")}
    >
      {/* -- Top accent stripe (gradient) -- */}
      <div className={`h-[3px] w-full shrink-0 bg-gradient-to-r ${accentGradient}`} />

      {/* -- Card body -- */}
      <div className={`flex flex-1 flex-col gap-3 p-4 ${bgTint}`}>
        {/* Header row: icon + title + live dot */}
        {(title || icon || live) && (
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              {icon && (
                <span
                  className={[
                    "inline-flex items-center justify-center h-8 w-8 rounded-full text-base leading-none shrink-0",
                    "shadow-sm",
                    iconBg,
                  ].join(" ")}
                  aria-hidden
                >
                  {icon}
                </span>
              )}
              {title && (
                <h3 className="text-sm font-semibold text-foreground leading-snug truncate">
                  {title}
                </h3>
              )}
            </div>

            {live && (
              <div className="flex items-center gap-1.5 shrink-0">
                <LiveDot />
                <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Live
                </span>
              </div>
            )}
          </div>
        )}

        {/* Title separator */}
        {title && (subtitle || body || content) && (
          <div className="h-px w-full bg-gradient-to-r from-border/60 via-border/30 to-transparent" />
        )}

        {/* Subtitle as a colored badge pill */}
        {subtitle && (
          <span
            className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
              status && STATUS_BADGE_BG[status]
                ? STATUS_BADGE_BG[status]
                : "bg-primary/10 text-primary ring-primary/20"
            }`}
          >
            {subtitle}
          </span>
        )}

        {/* Body text (supports markdown) */}
        {body && (
          <div className="text-sm leading-relaxed text-foreground/85">
            <MarkdownMessage content={body} />
          </div>
        )}

        {/* Content (supports markdown) */}
        {content && (
          <div className="text-sm leading-[1.7] text-foreground/80">
            <MarkdownMessage content={content} />
          </div>
        )}

        {/* Last-updated timestamp in footer */}
        {lastUpdated && (
          <div className="mt-auto pt-2 border-t border-border/30">
            <span className="text-[10px] text-muted-foreground/70">
              Updated {lastUpdated}
            </span>
          </div>
        )}
      </div>
    </FadeIn>
  );
}

export default memo(CanvasCardInner);

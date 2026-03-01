"use client";

import { memo } from "react";
import { motion } from "framer-motion";

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
 * Status-to-color mappings for the top accent border.
 * Falls back to primary (theme-aware) when no status is set.
 */
const STATUS_ACCENT: Record<string, string> = {
  info: "bg-blue-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

const STATUS_BADGE_BG: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-blue-500/20",
  success:
    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20",
  warning:
    "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20",
  error: "bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20",
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
  const accentClass = status
    ? STATUS_ACCENT[status]
    : "bg-primary";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="h-full flex flex-col overflow-hidden rounded-lg shadow-sm dark:shadow-md dark:shadow-black/20"
    >
      {/* ── Top accent stripe ─────────────────────────────────── */}
      <div className={`h-[2px] w-full shrink-0 ${accentClass}`} />

      {/* ── Card body ─────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Header row: icon + title + live dot */}
        {(title || icon || live) && (
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {icon && (
                <span className="text-base leading-none shrink-0" aria-hidden>
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

        {/* Title separator — only when there is a title AND content below it */}
        {title && (subtitle || body || content) && (
          <div className="h-px w-full bg-border/60" />
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

        {/* Body text */}
        {body && (
          <p className="text-sm leading-relaxed text-foreground/85 whitespace-pre-wrap">
            {body}
          </p>
        )}

        {/* Content (markdown-like block with good typography) */}
        {content && (
          <div className="text-sm leading-[1.7] text-foreground/80 whitespace-pre-wrap break-words [&>*]:mb-2">
            {content}
          </div>
        )}

        {/* Last-updated timestamp in footer */}
        {lastUpdated && (
          <div className="mt-auto pt-2 border-t border-border/40">
            <span className="text-[10px] text-muted-foreground">
              Updated {lastUpdated}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default memo(CanvasCardInner);

"use client";

import { memo } from "react";
import { motion } from "framer-motion";

interface TimelineEvent {
  label: string;
  description?: string;
  timestamp?: string;
  icon?: string;
  status?: "completed" | "active" | "pending";
}

export interface CanvasTimelineProps {
  title?: string;
  events: TimelineEvent[];
}

const STATUS_DOT: Record<string, string> = {
  completed: "bg-emerald-500 border-emerald-500/30",
  active: "bg-primary border-primary/30",
  pending: "bg-muted-foreground/30 border-border",
};

const STATUS_GLOW: Record<string, string> = {
  completed: "shadow-[0_0_8px_rgba(16,185,129,0.3)]",
  active: "shadow-[0_0_8px_rgba(var(--primary)/0.3)]",
  pending: "",
};

const STATUS_BG_TINT: Record<string, string> = {
  completed: "",
  active: "bg-primary/[0.03] dark:bg-primary/[0.05]",
  pending: "",
};

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2.5 5l2 2L7.5 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CanvasTimelineInner({ title, events }: CanvasTimelineProps) {
  if (!Array.isArray(events) || events.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={[
        "overflow-hidden rounded-xl",
        "border border-border/40",
        "shadow-sm dark:shadow-md dark:shadow-black/15",
      ].join(" ")}
    >
      {/* Title header */}
      {title && (
        <div className="px-4 py-3 border-b border-border/30">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <div className="mt-2 h-px w-full bg-gradient-to-r from-primary/30 via-border/20 to-transparent" />
        </div>
      )}

      <div role="list" aria-label={title || "Timeline"} className="p-4">
        {events.map((event, i) => {
          const status = event.status || "pending";
          const dotStyle = STATUS_DOT[status] || STATUS_DOT.pending;
          const glow = STATUS_GLOW[status] || "";
          const bgTint = STATUS_BG_TINT[status] || "";
          const isLast = i === events.length - 1;
          const isCompleted = status === "completed";
          const isActive = status === "active";

          return (
            <motion.div
              role="listitem"
              key={`${event.label}-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.35,
                delay: i * 0.07,
                ease: [0.25, 0.46, 0.45, 0.94],
              }}
              className={[
                "group flex gap-3 rounded-lg px-2 -mx-2",
                "transition-colors duration-200",
                "hover:bg-accent/40 dark:hover:bg-white/[0.03]",
                bgTint,
              ].join(" ")}
            >
              {/* Timeline spine */}
              <div className="flex flex-col items-center">
                {event.icon ? (
                  <span className="text-base shrink-0 mt-0.5">{event.icon}</span>
                ) : (
                  <div className="relative shrink-0 mt-1.5">
                    <div
                      className={[
                        "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                        dotStyle,
                        glow,
                      ].join(" ")}
                    >
                      {isCompleted && <CheckIcon />}
                    </div>
                    {/* Pulsing ring for active status */}
                    {isActive && (
                      <span className="absolute inset-0 rounded-full animate-ping bg-primary/30" />
                    )}
                  </div>
                )}
                {/* Connector line with draw animation */}
                {!isLast && (
                  <motion.div
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{
                      duration: 0.4,
                      delay: i * 0.07 + 0.2,
                      ease: [0.25, 0.46, 0.45, 0.94],
                    }}
                    className="w-[2px] flex-1 min-h-[24px] origin-top bg-gradient-to-b from-border/60 to-border/20"
                  />
                )}
              </div>

              {/* Event content */}
              <div className={`pb-4 ${isLast ? "pb-1" : ""}`}>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-medium ${
                      isCompleted || isActive
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    {event.label}
                  </span>
                  {event.timestamp && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-muted-foreground/70 bg-secondary/50 dark:bg-white/[0.04] ring-1 ring-inset ring-border/20">
                      {event.timestamp}
                    </span>
                  )}
                </div>
                {event.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {event.description}
                  </p>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

export default memo(CanvasTimelineInner);

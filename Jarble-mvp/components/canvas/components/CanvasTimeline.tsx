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
    <div className="p-3 h-full">
      {title && (
        <motion.h3
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-sm font-semibold text-foreground mb-3"
        >
          {title}
        </motion.h3>
      )}
      <div className="space-y-0">
        {events.map((event, i) => {
          const status = event.status || "pending";
          const dotStyle = STATUS_DOT[status] || STATUS_DOT.pending;
          const isLast = i === events.length - 1;
          const isCompleted = status === "completed";
          const isActive = status === "active";

          return (
            <motion.div
              key={`${event.label}-${i}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                duration: 0.35,
                delay: i * 0.06,
                ease: [0.25, 0.46, 0.45, 0.94],
              }}
              className="flex gap-3 rounded-lg px-1 -mx-1 transition-colors hover:bg-secondary/40"
            >
              <div className="flex flex-col items-center">
                {event.icon ? (
                  <span className="text-base shrink-0 mt-0.5">{event.icon}</span>
                ) : (
                  <div className="relative shrink-0 mt-1.5">
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center ${dotStyle}`}
                    >
                      {isCompleted && <CheckIcon />}
                    </div>
                    {/* Pulsing ring for active status */}
                    {isActive && (
                      <span className="absolute inset-0 rounded-full animate-ping bg-primary/30" />
                    )}
                  </div>
                )}
                {!isLast && (
                  <div className="w-px flex-1 min-h-[24px] bg-gradient-to-b from-border to-transparent" />
                )}
              </div>
              <div className={`pb-4 ${isLast ? "pb-0" : ""}`}>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-medium ${
                      isCompleted
                        ? "text-foreground"
                        : isActive
                          ? "text-foreground"
                          : "text-muted-foreground"
                    }`}
                  >
                    {event.label}
                  </span>
                  {event.timestamp && (
                    <span className="inline-flex items-center rounded-full bg-secondary/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {event.timestamp}
                    </span>
                  )}
                </div>
                {event.description && (
                  <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">
                    {event.description}
                  </p>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(CanvasTimelineInner);

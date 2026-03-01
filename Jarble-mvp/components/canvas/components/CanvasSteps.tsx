"use client";

import { memo } from "react";
import { motion } from "framer-motion";

export interface CanvasStepsProps {
  current: number;
  items: { title: string; description?: string; icon?: string }[];
  direction?: "vertical" | "horizontal";
}

function CanvasStepsInner({
  current,
  items,
  direction = "horizontal",
}: CanvasStepsProps) {
  const isVertical = direction === "vertical";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-4 h-full"
    >
      <div
        className={
          isVertical
            ? "flex flex-col gap-0"
            : "flex flex-row items-start"
        }
      >
        {items.map((item, index) => {
          const isCompleted = index < current;
          const isCurrent = index === current;
          const isLast = index === items.length - 1;

          return (
            <div
              key={`${item.title}-${index}`}
              className={
                isVertical
                  ? "flex flex-row items-stretch gap-3"
                  : "flex flex-col items-center flex-1 min-w-0"
              }
            >
              {/* Step indicator + connector */}
              {isVertical ? (
                <div className="flex flex-col items-center">
                  {/* Circle */}
                  <div
                    className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                      isCompleted
                        ? "bg-emerald-500 text-white"
                        : isCurrent
                          ? "bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2 ring-offset-background"
                          : "bg-muted text-muted-foreground border border-border"
                    }`}
                  >
                    {isCompleted ? (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      index + 1
                    )}
                  </div>
                  {/* Vertical connector line */}
                  {!isLast && (
                    <div
                      className={`w-0.5 flex-1 min-h-[24px] ${
                        isCompleted ? "bg-emerald-500" : "bg-border"
                      }`}
                    />
                  )}
                </div>
              ) : (
                <div className="flex items-center w-full">
                  {/* Circle */}
                  <div
                    className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                      isCompleted
                        ? "bg-emerald-500 text-white"
                        : isCurrent
                          ? "bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2 ring-offset-background"
                          : "bg-muted text-muted-foreground border border-border"
                    }`}
                  >
                    {isCompleted ? (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      index + 1
                    )}
                  </div>
                  {/* Horizontal connector line */}
                  {!isLast && (
                    <div
                      className={`flex-1 h-0.5 mx-2 ${
                        isCompleted ? "bg-emerald-500" : "bg-border"
                      }`}
                    />
                  )}
                </div>
              )}

              {/* Title & description */}
              <div
                className={
                  isVertical
                    ? "pb-6 pt-1"
                    : "mt-2 text-center px-1"
                }
              >
                <div
                  className={`text-sm font-medium ${
                    isCurrent
                      ? "text-foreground"
                      : isCompleted
                        ? "text-foreground"
                        : "text-muted-foreground"
                  }`}
                >
                  {item.title}
                </div>
                {item.description && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {item.description}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

export default memo(CanvasStepsInner);

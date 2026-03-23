"use client";

import { memo, useState, useEffect } from "react";
import { FadeIn } from "../FadeIn";

export interface CanvasStatisticProps {
  value: string | number;
  title?: string;
  prefix?: string;
  suffix?: string;
  precision?: number;
  isCountdown?: boolean;
  countdownTarget?: string;
}

function formatCountdown(diffMs: number): string {
  if (diffMs <= 0) return "00:00:00";

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (days > 0) {
    return `${days} day${days !== 1 ? "s" : ""} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function CanvasStatisticInner({
  value,
  title,
  prefix,
  suffix,
  precision,
  isCountdown,
  countdownTarget,
}: CanvasStatisticProps) {
  const [remaining, setRemaining] = useState<string>("");

  useEffect(() => {
    if (!isCountdown || !countdownTarget) return;

    const targetTime = new Date(countdownTarget).getTime();

    const update = () => {
      const diff = targetTime - Date.now();
      setRemaining(formatCountdown(diff));
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [isCountdown, countdownTarget]);

  const formattedValue = (() => {
    if (isCountdown && countdownTarget) {
      return remaining;
    }
    if (typeof value === "number" && precision !== undefined) {
      return value.toFixed(precision);
    }
    return value;
  })();

  return (
    <FadeIn className="p-4 h-full flex flex-col justify-center">
      <div role="img" aria-label={`${title ? title + ": " : ""}${prefix || ""}${formattedValue}${suffix || ""}`}>
        {title && (
          <div className="text-xs text-muted-foreground mb-1">{title}</div>
        )}
        <div className="flex items-baseline gap-1">
          {prefix && (
            <span className="text-xl text-muted-foreground">{prefix}</span>
          )}
          <span className="text-3xl font-bold text-foreground">
            {formattedValue}
          </span>
          {suffix && (
            <span className="text-xl text-muted-foreground">{suffix}</span>
          )}
        </div>
      </div>
    </FadeIn>
  );
}

export default memo(CanvasStatisticInner);

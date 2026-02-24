"use client";

import { Statistic } from "antd";
import AntThemeProvider from "../AntThemeProvider";

const { Countdown } = Statistic;

export interface CanvasStatisticProps {
  value: string | number;
  title?: string;
  prefix?: string;
  suffix?: string;
  precision?: number;
  isCountdown?: boolean;
  countdownTarget?: string;
}

export default function CanvasStatistic({
  value,
  title,
  prefix,
  suffix,
  precision,
  isCountdown,
  countdownTarget,
}: CanvasStatisticProps) {
  return (
    <AntThemeProvider>
      <div className="rounded-xl border border-border bg-card p-4">
        {isCountdown && countdownTarget ? (
          <Countdown
            title={title}
            value={new Date(countdownTarget).getTime()}
            prefix={prefix}
            suffix={suffix}
          />
        ) : (
          <Statistic
            title={title}
            value={value}
            prefix={prefix}
            suffix={suffix}
            precision={precision}
          />
        )}
      </div>
    </AntThemeProvider>
  );
}

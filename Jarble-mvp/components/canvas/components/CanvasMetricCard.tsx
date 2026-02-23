"use client";

import { LineChart, Line, ResponsiveContainer } from "recharts";

export interface CanvasMetricCardProps {
  label: string;
  value: string | number;
  change?: string;
  changeLabel?: string;
  icon?: string;
  sparkline?: number[];
}

export default function CanvasMetricCard({
  label,
  value,
  change,
  changeLabel,
  icon,
  sparkline,
}: CanvasMetricCardProps) {
  const isPositive = change?.startsWith("+") || change?.startsWith("↑");
  const isNegative = change?.startsWith("-") || change?.startsWith("↓");

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {icon && <span className="text-base">{icon}</span>}
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
          <div className="text-2xl font-semibold text-foreground">{String(value)}</div>
          {change && (
            <div className="flex items-center gap-1.5">
              <span
                className={`text-xs font-medium ${
                  isPositive
                    ? "text-green-400"
                    : isNegative
                      ? "text-red-400"
                      : "text-muted-foreground"
                }`}
              >
                {change}
              </span>
              {changeLabel && (
                <span className="text-[10px] text-muted-foreground">{changeLabel}</span>
              )}
            </div>
          )}
        </div>
        {sparkline && sparkline.length > 1 && (
          <div className="w-20 h-10">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkline.map((v, i) => ({ v, i }))}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke={isNegative ? "#ef4444" : "#10b981"}
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

interface SeriesData {
  label: string;
  data: { time: number; value: number }[];
}

interface MetricsChartProps {
  title: string;
  series: SeriesData[];
  unit: "%" | "MB" | "cores" | "count";
  isLoading: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function MetricsChart({ title, series, unit, isLoading }: MetricsChartProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (series.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
            No data available
          </div>
        </CardContent>
      </Card>
    );
  }

  // Sanitize labels — recharts interprets dots in dataKey as nested property
  // access, so "10.0.1.10:9100" would fail. Replace dots/colons with safe chars.
  const safeKey = (label: string) => label.replace(/[.:]/g, "_");

  // Merge all series into a unified data array keyed by timestamp
  const timeMap = new Map<number, Record<string, number>>();
  for (const s of series) {
    const key = safeKey(s.label);
    for (const pt of s.data) {
      const row = timeMap.get(pt.time) ?? { time: pt.time };
      row[key] = Math.round(pt.value * 100) / 100;
      timeMap.set(pt.time, row);
    }
  }
  const chartData = Array.from(timeMap.values()).sort((a, b) => a.time - b.time);

  const chartConfig: ChartConfig = Object.fromEntries(
    series.map((s, i) => [
      safeKey(s.label),
      { label: s.label, color: COLORS[i % COLORS.length] },
    ])
  );

  const unitSuffix = unit === "%" ? "%" : unit === "MB" ? " MB" : "";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              tickFormatter={formatTime}
              tick={{ fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => `${v}${unitSuffix}`}
              width={50}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    const ts = payload?.[0]?.payload?.time;
                    return ts ? formatTime(ts) : "";
                  }}
                />
              }
            />
            {series.map((s, i) => (
              <Line
                key={s.label}
                type="monotone"
                dataKey={safeKey(s.label)}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

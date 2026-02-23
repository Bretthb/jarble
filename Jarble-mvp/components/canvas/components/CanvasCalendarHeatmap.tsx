"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Heatmap = dynamic(
  () => import("@ant-design/plots").then((m) => m.Heatmap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[200px] animate-pulse rounded bg-muted" />
    ),
  }
);

export interface CanvasCalendarHeatmapProps {
  data: { date: string; value: number }[];
  title?: string;
}

export default function CanvasCalendarHeatmap({
  data,
  title,
}: CanvasCalendarHeatmapProps) {
  // Transform date strings into week/day grid for calendar layout
  const transformed = data.map((d) => {
    const date = new Date(d.date);
    return {
      week: `W${Math.ceil(
        (date.getDate() + new Date(date.getFullYear(), date.getMonth(), 1).getDay()) / 7
      )}`,
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      value: d.value,
      date: d.date,
    };
  });

  const config = {
    data: transformed,
    xField: "week",
    yField: "day",
    colorField: "value",
    scale: {
      color: {
        range: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
      },
    },
    mark: "cell" as const,
    style: { inset: 1 },
    tooltip: {
      items: [
        { field: "date", name: "Date" },
        { field: "value", name: "Value" },
      ],
    },
  };

  return (
    <AntThemeProvider>
      <div className="rounded-xl border border-border bg-card p-4">
        {title && (
          <h3 className="text-sm font-semibold text-foreground mb-3">
            {title}
          </h3>
        )}
        <div style={{ height: 200 }}>
          <Heatmap {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

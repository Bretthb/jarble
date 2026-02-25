"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Scatter = dynamic(
  () => import("@ant-design/plots").then((m) => m.Scatter),
  {
    ssr: false,
    loading: () => (
      <div className="h-[300px] animate-pulse rounded bg-muted" />
    ),
  }
);

export interface CanvasScatterProps {
  data: { x: number; y: number; label?: string; group?: string }[];
  title?: string;
  xLabel?: string;
  yLabel?: string;
}

export default function CanvasScatter({
  data,
  title,
  xLabel,
  yLabel,
}: CanvasScatterProps) {
  const hasGroups = data.some((d) => d.group);

  const config = {
    data,
    xField: "x",
    yField: "y",
    ...(hasGroups ? { colorField: "group" } : {}),
    shape: "point" as const,
    axis: {
      x: { title: xLabel || "X" },
      y: { title: yLabel || "Y" },
    },
    tooltip: {
      items: [
        { field: "x", name: xLabel || "X" },
        { field: "y", name: yLabel || "Y" },
        ...(hasGroups ? [{ field: "group", name: "Group" }] : []),
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
        <div style={{ height: 300 }}>
          <Scatter {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

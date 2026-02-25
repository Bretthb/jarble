"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Heatmap = dynamic(
  () => import("@ant-design/plots").then((m) => m.Heatmap),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-muted" /> }
);

export interface CanvasHeatmapProps {
  data: { x: string; y: string; value: number }[];
  title?: string;
}

export default function CanvasHeatmap({ data, title }: CanvasHeatmapProps) {
  const config = {
    data,
    xField: "x",
    yField: "y",
    colorField: "value",
    shape: "square" as const,
  };

  return (
    <AntThemeProvider>
      <div className="p-3 h-full">
        {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
        <div style={{ height: 300 }}>
          <Heatmap {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Radar = dynamic(() => import("@ant-design/plots").then((m) => m.Radar), {
  ssr: false,
  loading: () => <div className="h-[300px] animate-pulse rounded bg-muted" />,
});

export interface CanvasRadarProps {
  data: { axis: string; value: number; group?: string }[];
  title?: string;
}

export default function CanvasRadar({ data, title }: CanvasRadarProps) {
  const hasGroups = data.some((d) => d.group);

  const config = {
    data,
    xField: "axis",
    yField: "value",
    ...(hasGroups ? { colorField: "group" } : {}),
    area: { style: { fillOpacity: 0.2 } },
    scale: { x: { padding: 0.5, align: 0 }, y: { tickCount: 5 } },
    axis: {
      x: { title: false, grid: true },
      y: { gridConnect: "line" as const, title: false },
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
          <Radar {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

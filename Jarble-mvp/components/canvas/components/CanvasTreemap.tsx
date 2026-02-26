"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Treemap = dynamic(
  () => import("@ant-design/plots").then((m) => m.Treemap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[300px] animate-pulse rounded bg-muted" />
    ),
  }
);

export interface CanvasTreemapProps {
  data: { name: string; children: { name: string; value: number }[] };
  title?: string;
}

export default function CanvasTreemap({ data, title }: CanvasTreemapProps) {
  const config = {
    data,
    valueField: "value",
    legend: { color: { title: false, position: "top" as const } },
  };

  return (
    <AntThemeProvider>
      <div className="p-3 h-full">
        {title && (
          <h3 className="text-sm font-semibold text-foreground mb-3">
            {title}
          </h3>
        )}
        <div style={{ height: 300 }}>
          <Treemap {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

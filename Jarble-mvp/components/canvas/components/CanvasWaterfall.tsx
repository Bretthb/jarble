"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Waterfall = dynamic(
  () => import("@ant-design/plots").then((m) => m.Waterfall),
  {
    ssr: false,
    loading: () => (
      <div className="h-[300px] animate-pulse rounded bg-muted" />
    ),
  }
);

export interface CanvasWaterfallProps {
  data: { label: string; value: number }[];
  title?: string;
}

export default function CanvasWaterfall({
  data,
  title,
}: CanvasWaterfallProps) {
  const config = {
    data,
    xField: "label",
    yField: "value",
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
          <Waterfall {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

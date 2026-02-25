"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Histogram = dynamic(
  () => import("@ant-design/plots").then((m) => m.Histogram),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-muted" /> }
);

export interface CanvasHistogramProps {
  data: { value: number }[];
  title?: string;
  binWidth?: number;
}

export default function CanvasHistogram({ data, title, binWidth }: CanvasHistogramProps) {
  const config = {
    data,
    binField: "value",
    ...(binWidth ? { binWidth } : {}),
  };

  return (
    <AntThemeProvider>
      <div className="rounded-xl border border-border bg-card p-4">
        {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
        <div style={{ height: 300 }}>
          <Histogram {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

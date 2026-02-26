"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Stock = dynamic(
  () => import("@ant-design/plots").then((m) => m.Stock),
  { ssr: false, loading: () => <div className="h-[400px] animate-pulse rounded bg-muted" /> }
);

export interface CanvasStockProps {
  data: { date: string; open: number; close: number; high: number; low: number }[];
  title?: string;
}

export default function CanvasStock({ data, title }: CanvasStockProps) {
  // Ensure numeric values (bot may send strings)
  const cleanData = data.map((d) => ({
    date: d.date,
    open: Number(d.open),
    close: Number(d.close),
    high: Number(d.high),
    low: Number(d.low),
  }));

  const config = {
    data: cleanData,
    xField: "date",
    // Order: [open, close, high, low] — per @ant-design/plots Stock adaptor
    yField: ["open", "close", "high", "low"] as [string, string, string, string],
    // Wick/shadow line style
    lineStyle: {
      stroke: "#999",
      lineWidth: 1,
    },
    axis: {
      x: { title: false, labelAutoRotate: true },
      y: { title: false },
    },
  };

  return (
    <AntThemeProvider>
      <div className="p-3 h-full">
        {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
        <div style={{ height: 400 }}>
          <Stock {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

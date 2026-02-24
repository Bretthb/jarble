"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Rose = dynamic(
  () => import("@ant-design/plots").then((m) => m.Rose),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-muted" /> }
);

export interface CanvasRoseProps {
  data: { category: string; value: number }[];
  title?: string;
}

export default function CanvasRose({ data, title }: CanvasRoseProps) {
  const config = {
    data,
    xField: "category",
    yField: "value",
    colorField: "category",
  };

  return (
    <AntThemeProvider>
      <div className="rounded-xl border border-border bg-card p-4">
        {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
        <div style={{ height: 300 }}>
          <Rose {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

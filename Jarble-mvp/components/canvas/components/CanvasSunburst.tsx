"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Sunburst = dynamic(
  () => import("@ant-design/plots").then((m) => m.Sunburst),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-muted" /> }
);

export interface CanvasSunburstProps {
  data: { name: string; children: { name: string; value: number; children?: unknown[] }[] };
  title?: string;
}

export default function CanvasSunburst({ data, title }: CanvasSunburstProps) {
  const config = {
    data,
  };

  return (
    <AntThemeProvider>
      <div className="rounded-xl border border-border bg-card p-4">
        {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
        <div style={{ height: 300 }}>
          <Sunburst {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

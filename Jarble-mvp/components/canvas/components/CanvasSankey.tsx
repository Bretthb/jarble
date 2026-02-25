"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Sankey = dynamic(
  () => import("@ant-design/plots").then((m) => m.Sankey),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-muted" /> }
);

export interface CanvasSankeyProps {
  data: { source: string; target: string; value: number }[];
  title?: string;
}

export default function CanvasSankey({ data, title }: CanvasSankeyProps) {
  const config = {
    data,
    sourceField: "source",
    targetField: "target",
    weightField: "value",
  };

  return (
    <AntThemeProvider>
      <div className="rounded-xl border border-border bg-card p-4">
        {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
        <div style={{ height: 300 }}>
          <Sankey {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

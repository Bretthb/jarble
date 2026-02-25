"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Funnel = dynamic(
  () => import("@ant-design/plots").then((m) => m.Funnel),
  {
    ssr: false,
    loading: () => (
      <div className="h-[300px] animate-pulse rounded bg-muted" />
    ),
  }
);

export interface CanvasFunnelProps {
  data: { stage: string; value: number }[];
  title?: string;
}

export default function CanvasFunnel({ data, title }: CanvasFunnelProps) {
  const config = {
    data,
    xField: "stage",
    yField: "value",
    legend: false as const,
    label: {
      text: (d: { stage: string; value: number }) =>
        `${d.stage}\n${d.value.toLocaleString()}`,
      position: "inside" as const,
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
          <Funnel {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

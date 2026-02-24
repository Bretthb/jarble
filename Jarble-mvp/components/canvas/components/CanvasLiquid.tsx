"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Liquid = dynamic(
  () => import("@ant-design/plots").then((m) => m.Liquid),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse rounded bg-muted" /> }
);

export interface CanvasLiquidProps {
  value: number;
  title?: string;
  color?: string;
}

export default function CanvasLiquid({ value, title, color }: CanvasLiquidProps) {
  const config = {
    percent: value,
    style: {
      ...(color ? { fill: color } : {}),
    },
  };

  return (
    <AntThemeProvider>
      <div className="rounded-xl border border-border bg-card p-4">
        {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
        <div style={{ height: 200 }}>
          <Liquid {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

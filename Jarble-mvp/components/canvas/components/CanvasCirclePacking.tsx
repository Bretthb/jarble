"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const CirclePacking = dynamic(
  () => import("@ant-design/plots").then((m) => m.CirclePacking),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-muted" /> }
);

export interface CanvasCirclePackingProps {
  data: { name: string; children: { name: string; value: number; children?: unknown[] }[] };
  title?: string;
}

export default function CanvasCirclePacking({ data, title }: CanvasCirclePackingProps) {
  const config = {
    data,
  };

  return (
    <AntThemeProvider>
      <div className="rounded-xl border border-border bg-card p-4">
        {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
        <div style={{ height: 300 }}>
          <CirclePacking {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

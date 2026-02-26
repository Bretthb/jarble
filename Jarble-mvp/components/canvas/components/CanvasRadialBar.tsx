"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const RadialBar = dynamic(
  () => import("@ant-design/plots").then((m) => m.RadialBar),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-muted" /> }
);

export interface CanvasRadialBarProps {
  data: { name: string; value: number }[];
  title?: string;
}

export default function CanvasRadialBar({ data, title }: CanvasRadialBarProps) {
  const config = {
    data,
    xField: "name",
    yField: "value",
    colorField: "name",
  };

  return (
    <AntThemeProvider>
      <div className="p-3 h-full">
        {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
        <div style={{ height: 300 }}>
          <RadialBar {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

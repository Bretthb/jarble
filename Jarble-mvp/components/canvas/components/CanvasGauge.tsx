"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Gauge = dynamic(() => import("@ant-design/plots").then((m) => m.Gauge), {
  ssr: false,
  loading: () => <div className="h-[200px] animate-pulse rounded bg-muted" />,
});

export interface CanvasGaugeProps {
  value: number;
  title?: string;
  suffix?: string;
  color?: string;
}

export default function CanvasGauge({
  value,
  title,
  suffix = "%",
  color,
}: CanvasGaugeProps) {
  const config = {
    data: {
      target: value / 100,
      total: 1,
      name: title || "Value",
    },
    scale: {
      color: {
        range: [color || "#3b82f6", "#232326"],
      },
    },
    style: {
      textContent: () => `${value}${suffix}`,
    },
  };

  return (
    <AntThemeProvider>
      <div className="p-3 h-full">
        {title && (
          <h3 className="text-sm font-semibold text-foreground mb-3">
            {title}
          </h3>
        )}
        <div style={{ height: 200 }}>
          <Gauge {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

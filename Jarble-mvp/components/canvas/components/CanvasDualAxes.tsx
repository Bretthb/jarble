"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const DualAxes = dynamic(
  () => import("@ant-design/plots").then((m) => m.DualAxes),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-muted" /> }
);

export interface CanvasDualAxesProps {
  data: Record<string, unknown>[];
  title?: string;
  xField?: string;
  yFields?: [string, string];
}

export default function CanvasDualAxes({
  data,
  title,
  xField = "date",
  yFields = ["value1", "value2"],
}: CanvasDualAxesProps) {
  const config = {
    data,
    xField,
    children: [
      { type: "line" as const, yField: yFields[0] },
      { type: "line" as const, yField: yFields[1], style: { lineWidth: 2, lineDash: [4, 4] } },
    ],
  };

  return (
    <AntThemeProvider>
      <div className="rounded-xl border border-border bg-card p-4">
        {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
        <div style={{ height: 300 }}>
          <DualAxes {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

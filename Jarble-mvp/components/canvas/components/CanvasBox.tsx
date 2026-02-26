"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Box = dynamic(
  () => import("@ant-design/plots").then((m) => m.Box),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-muted" /> }
);

export interface CanvasBoxProps {
  data: { group: string; value: number }[];
  title?: string;
}

export default function CanvasBox({ data, title }: CanvasBoxProps) {
  const config = {
    data,
    xField: "group",
    yField: "value",
  };

  return (
    <AntThemeProvider>
      <div className="p-3 h-full">
        {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
        <div style={{ height: 300 }}>
          <Box {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

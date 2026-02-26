"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const WordCloud = dynamic(
  () => import("@ant-design/plots").then((m) => m.WordCloud),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-muted" /> }
);

export interface CanvasWordCloudProps {
  data: { text: string; value: number }[];
  title?: string;
}

export default function CanvasWordCloud({ data, title }: CanvasWordCloudProps) {
  const config = {
    data,
    textField: "text",
    valueField: "value",
  };

  return (
    <AntThemeProvider>
      <div className="p-3 h-full">
        {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
        <div style={{ height: 300 }}>
          <WordCloud {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Venn = dynamic(
  () => import("@ant-design/plots").then((m) => m.Venn),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-muted" /> }
);

export interface CanvasVennProps {
  data: { sets: string[]; size: number; label?: string }[];
  title?: string;
}

export default function CanvasVenn({ data, title }: CanvasVennProps) {
  const config = {
    data,
    setsField: "sets",
    sizeField: "size",
  };

  return (
    <AntThemeProvider>
      <div className="rounded-xl border border-border bg-card p-4">
        {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
        <div style={{ height: 300 }}>
          <Venn {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

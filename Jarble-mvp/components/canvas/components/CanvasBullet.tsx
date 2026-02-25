"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Bullet = dynamic(
  () => import("@ant-design/plots").then((m) => m.Bullet),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-muted" /> }
);

export interface CanvasBulletProps {
  data: { title: string; ranges: number[]; measures: number[]; target: number }[];
  title?: string;
}

export default function CanvasBullet({ data, title }: CanvasBulletProps) {
  const config = {
    data,
  };

  return (
    <AntThemeProvider>
      <div className="p-3 h-full">
        {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
        <div style={{ height: 300 }}>
          <Bullet {...config} />
        </div>
      </div>
    </AntThemeProvider>
  );
}

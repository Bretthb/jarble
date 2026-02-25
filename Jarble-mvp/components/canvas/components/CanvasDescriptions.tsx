"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Descriptions = dynamic(
  () => import("antd").then((m) => m.Descriptions),
  {
    ssr: false,
    loading: () => (
      <div className="h-[100px] animate-pulse rounded bg-muted" />
    ),
  }
);

export interface CanvasDescriptionsProps {
  title?: string;
  items: { label: string; value: string | number; span?: number }[];
  columns?: number;
  bordered?: boolean;
}

export default function CanvasDescriptions({
  title,
  items,
  columns = 2,
  bordered = true,
}: CanvasDescriptionsProps) {
  return (
    <AntThemeProvider>
      <div className="rounded-xl border border-border bg-card p-4">
        <Descriptions
          title={title}
          bordered={bordered}
          column={columns}
          size="small"
          items={items.map((item, i) => ({
            key: i,
            label: item.label,
            children: item.value,
            span: item.span,
          }))}
        />
      </div>
    </AntThemeProvider>
  );
}

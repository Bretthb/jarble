"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Steps = dynamic(
  () => import("antd").then((m) => m.Steps),
  {
    ssr: false,
    loading: () => <div className="h-[60px] animate-pulse rounded bg-muted" />,
  }
);

export interface CanvasStepsProps {
  current: number;
  items: { title: string; description?: string; icon?: string }[];
  direction?: "vertical" | "horizontal";
}

export default function CanvasSteps({
  current,
  items,
  direction = "horizontal",
}: CanvasStepsProps) {
  return (
    <AntThemeProvider>
      <div className="p-3 h-full">
        <Steps
          current={current}
          direction={direction}
          items={items.map((item) => ({
            title: item.title,
            description: item.description,
          }))}
        />
      </div>
    </AntThemeProvider>
  );
}

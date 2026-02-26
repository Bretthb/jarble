"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Result = dynamic(
  () => import("antd").then((m) => m.Result),
  {
    ssr: false,
    loading: () => (
      <div className="h-[200px] animate-pulse rounded bg-muted" />
    ),
  }
);

export interface CanvasResultProps {
  status: "success" | "error" | "info" | "warning";
  title: string;
  subtitle?: string;
  extra?: string;
}

export default function CanvasResult({
  status,
  title,
  subtitle,
}: CanvasResultProps) {
  return (
    <AntThemeProvider>
      <div className="p-3 h-full">
        <Result status={status} title={title} subTitle={subtitle} />
      </div>
    </AntThemeProvider>
  );
}

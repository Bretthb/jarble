"use client";

import { memo } from "react";
import dynamic from "next/dynamic";
import { FadeIn } from "../FadeIn";

const Workbook = dynamic(
  () => import("@fortune-sheet/react").then((m) => m.Workbook),
  { ssr: false, loading: () => <div className="h-[400px] animate-pulse rounded bg-muted" /> }
);

import "@fortune-sheet/react/dist/index.css";

export interface CanvasSpreadsheetProps {
  data?: Record<string, unknown>[];
  title?: string;
  height?: number;
}

function CanvasSpreadsheetInner({
  data,
  title,
  height = 400,
}: CanvasSpreadsheetProps) {
  const sheetData = data
    ? [
        {
          name: "Sheet1",
          celldata: data.flatMap((row, r) =>
            Object.values(row).map((val, c) => ({
              r,
              c,
              v: {
                v: val as string | number | boolean | undefined,
                m: String(val),
              },
            }))
          ),
        },
      ]
    : [{ name: "Sheet1" }];

  return (
    <FadeIn className="p-4 h-full" role="region" aria-label={title || "Spreadsheet"}>
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
      )}
      <div style={{ height }}>
        <Workbook data={sheetData} />
      </div>
    </FadeIn>
  );
}

export default memo(CanvasSpreadsheetInner);

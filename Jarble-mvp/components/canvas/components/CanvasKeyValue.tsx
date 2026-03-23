"use client";

import { memo } from "react";
import { FadeIn } from "../FadeIn";

export interface KeyValueItem {
  key: string;
  value: string | number;
}

export interface CanvasKeyValueProps {
  title?: string;
  items: KeyValueItem[];
}

/** Detect if a value looks numeric (for font-mono treatment) */
function isNumeric(val: string | number): boolean {
  if (typeof val === "number") return true;
  const cleaned = String(val).replace(/[$€£¥%,]/g, "").trim();
  return cleaned !== "" && !isNaN(Number(cleaned));
}

function CanvasKeyValueInner({ title, items = [] }: CanvasKeyValueProps) {
  return (
    <FadeIn
      className={[
        "overflow-hidden rounded-xl",
        "border border-border/40",
        "shadow-sm dark:shadow-md dark:shadow-black/15",
      ].join(" ")}
    >
      {/* Title header */}
      {title && (
        <div className="px-4 py-3 border-b border-border/30">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <div className="mt-2 h-px w-full bg-gradient-to-r from-primary/30 via-border/20 to-transparent" />
        </div>
      )}

      {/* Key-value rows */}
      <dl aria-label={title || "Key-value pairs"} className={title ? "" : "pt-1"}>
        {items.map((item, i) => (
          <div
            key={item.key}
            className={[
              "group flex justify-between items-baseline gap-4 px-4 py-2.5",
              "transition-colors duration-150",
              "hover:bg-accent/40 dark:hover:bg-white/[0.03]",
              i % 2 === 1 ? "bg-muted/10 dark:bg-white/[0.015]" : "",
              i < items.length - 1 ? "border-b border-border/15" : "",
            ].join(" ")}
          >
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground shrink-0">
              {item.key}
            </dt>
            <dd
              className={[
                "text-sm text-foreground text-right",
                isNumeric(item.value) ? "font-mono tabular-nums font-medium" : "",
              ].join(" ")}
            >
              {String(item.value)}
            </dd>
          </div>
        ))}
      </dl>
    </FadeIn>
  );
}

export default memo(CanvasKeyValueInner);

"use client";

import { memo } from "react";

export interface CanvasDescriptionsProps {
  title?: string;
  items: { label: string; value: string | number; span?: number }[];
  columns?: number;
  bordered?: boolean;
}

function CanvasDescriptionsInner({
  title,
  items,
  columns = 2,
  bordered = true,
}: CanvasDescriptionsProps) {
  return (
    <div className="p-3 h-full">
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-3">
          {title}
        </h3>
      )}
      <div
        className="w-full"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: 0,
        }}
      >
        {items.map((item, index) => {
          const col = index % columns;
          const isLastRow =
            index >= items.length - (items.length % columns || columns);
          const isLastCol = col === columns - 1;

          return (
            <div
              key={`${item.label}-${index}`}
              className={`p-2.5 ${
                bordered
                  ? `${!isLastRow ? "border-b border-border" : ""} ${
                      !isLastCol ? "border-r border-border" : ""
                    }`
                  : ""
              }`}
              style={{
                gridColumn: item.span ? `span ${item.span}` : undefined,
              }}
            >
              <div className="text-xs text-muted-foreground font-medium">
                {item.label}
              </div>
              <div className="text-sm text-foreground mt-0.5">
                {item.value}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(CanvasDescriptionsInner);

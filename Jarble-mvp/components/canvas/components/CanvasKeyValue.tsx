"use client";

export interface KeyValueItem {
  key: string;
  value: string | number;
}

export interface CanvasKeyValueProps {
  title?: string;
  items: KeyValueItem[];
}

export default function CanvasKeyValue({ title, items = [] }: CanvasKeyValueProps) {
  return (
    <div className="p-3 h-full space-y-2">
      {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
      {items.map((item, i) => (
        <div key={i} className="flex justify-between items-baseline gap-4">
          <span className="text-xs text-muted-foreground shrink-0">{item.key}</span>
          <span className="text-sm text-foreground text-right">{String(item.value)}</span>
        </div>
      ))}
    </div>
  );
}

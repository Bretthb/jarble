"use client";

import { Plus, Trash2 } from "lucide-react";
import type { EditorProps } from "./registry";

interface KVItem {
  key: string;
  value: string | number;
}

export default function KeyValueEditor({ props, onChange }: EditorProps) {
  const title = (props.title as string) || "";
  const items = (props.items as KVItem[]) || [];

  const update = (patch: Partial<typeof props>) => {
    onChange({ ...props, ...patch });
  };

  const updateItem = (idx: number, field: "key" | "value", val: string) => {
    const next = items.map((item, i) =>
      i === idx ? { ...item, [field]: val } : item
    );
    update({ items: next });
  };

  const addItem = () => {
    update({ items: [...items, { key: "", value: "" }] });
  };

  const removeItem = (idx: number) => {
    update({ items: items.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={title}
        onChange={(e) => update({ title: e.target.value })}
        placeholder="Title (optional)"
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary/50"
      />

      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={`${item.key}-${i}`} className="flex gap-1.5 items-center group">
            <input
              type="text"
              value={item.key}
              onChange={(e) => updateItem(i, "key", e.target.value)}
              placeholder="Key"
              className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <input
              type="text"
              value={String(item.value)}
              onChange={(e) => updateItem(i, "value", e.target.value)}
              placeholder="Value"
              className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <button
              onClick={() => removeItem(i)}
              className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-red-400 transition-opacity"
              title="Remove"
              aria-label={`Remove ${item.key || "pair"}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addItem}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border border-border/60 bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
      >
        <Plus className="w-3 h-3" />
        Add pair
      </button>
    </div>
  );
}

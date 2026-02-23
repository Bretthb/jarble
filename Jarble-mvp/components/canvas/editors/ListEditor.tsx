"use client";

import type { EditorProps } from "./registry";

export default function ListEditor({ props, onChange }: EditorProps) {
  const title = (props.title as string) || "";
  const items = (props.items as Array<{ text: string; description?: string }>) || [];
  const ordered = (props.ordered as boolean) || false;

  const update = (patch: Partial<typeof props>) => {
    onChange({ ...props, ...patch });
  };

  const updateItem = (index: number, field: string, value: string) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    update({ items: newItems });
  };

  const addItem = () => {
    update({ items: [...items, { text: "" }] });
  };

  const removeItem = (index: number) => {
    update({ items: items.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={title}
        onChange={(e) => update({ title: e.target.value })}
        placeholder="List title (optional)"
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
      />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={ordered} onChange={(e) => update({ ordered: e.target.checked })} />
        Numbered list
      </label>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex gap-1.5">
            <input
              type="text"
              value={item.text}
              onChange={(e) => updateItem(i, "text", e.target.value)}
              placeholder={`Item ${i + 1}`}
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <button
              onClick={() => removeItem(i)}
              className="px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground border border-border/60 hover:bg-secondary"
            >
              x
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={addItem}
        className="px-3 py-1 rounded-md text-xs font-medium border border-border/60 bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
      >
        + Add Item
      </button>
    </div>
  );
}

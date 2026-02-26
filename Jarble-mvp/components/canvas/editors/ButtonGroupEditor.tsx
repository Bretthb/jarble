"use client";

import type { EditorProps } from "./registry";

const VARIANTS = ["default", "secondary", "destructive", "outline"] as const;

export default function ButtonGroupEditor({ props, onChange }: EditorProps) {
  const buttons = (props.buttons as Array<{ id: string; label: string; variant?: string }>) || [];

  const update = (newButtons: typeof buttons) => {
    onChange({ ...props, buttons: newButtons });
  };

  const updateButton = (index: number, field: string, value: string) => {
    const newButtons = [...buttons];
    newButtons[index] = { ...newButtons[index], [field]: value };
    update(newButtons);
  };

  const addButton = () => {
    update([...buttons, { id: `btn-${buttons.length + 1}`, label: "", variant: "default" }]);
  };

  const removeButton = (index: number) => {
    update(buttons.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {buttons.map((btn, i) => (
        <div key={btn.id} className="flex gap-1.5 items-center">
          <input
            type="text"
            value={btn.label}
            onChange={(e) => updateButton(i, "label", e.target.value)}
            placeholder="Button label"
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <select
            value={btn.variant || "default"}
            onChange={(e) => updateButton(i, "variant", e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            {VARIANTS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          <button
            onClick={() => removeButton(i)}
            className="px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground border border-border/60 hover:bg-secondary"
            aria-label={`Remove button ${btn.label || i + 1}`}
          >
            x
          </button>
        </div>
      ))}
      <button
        onClick={addButton}
        className="px-3 py-1 rounded-md text-xs font-medium border border-border/60 bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
      >
        + Add Button
      </button>
    </div>
  );
}

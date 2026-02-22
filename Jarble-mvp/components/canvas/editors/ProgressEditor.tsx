"use client";

import type { EditorProps } from "./registry";

const VARIANTS = ["default", "success", "warning", "error"] as const;

export default function ProgressEditor({ props, onChange }: EditorProps) {
  const label = (props.label as string) || "";
  const value = (props.value as number) || 0;
  const variant = (props.variant as string) || "default";

  const update = (patch: Partial<typeof props>) => {
    onChange({ ...props, ...patch });
  };

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={label}
        onChange={(e) => update({ label: e.target.value })}
        placeholder="Label (optional)"
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
      />
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => update({ value: parseInt(e.target.value, 10) })}
          className="flex-1"
        />
        <span className="text-xs text-muted-foreground w-10 text-right">{value}%</span>
      </div>
      <div className="flex gap-1.5">
        {VARIANTS.map((v) => (
          <button
            key={v}
            onClick={() => update({ variant: v })}
            className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
              variant === v
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/60 bg-secondary/50 text-muted-foreground hover:bg-secondary"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

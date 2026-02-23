"use client";

import type { EditorProps } from "./registry";

const CHART_TYPES = ["bar", "line", "pie", "area"] as const;

export default function ChartEditor({ props, onChange }: EditorProps) {
  const type = (props.type as string) || "bar";
  const title = (props.title as string) || "";
  const stacked = (props.stacked as boolean) || false;
  const showLegend = props.showLegend !== false;
  const showGrid = props.showGrid !== false;

  const update = (patch: Partial<typeof props>) => {
    onChange({ ...props, ...patch });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {CHART_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => update({ type: t })}
            className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
              type === t
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/60 bg-secondary/50 text-muted-foreground hover:bg-secondary"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={title}
        onChange={(e) => update({ title: e.target.value })}
        placeholder="Chart title (optional)"
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
      />
      <div className="flex gap-3">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={stacked} onChange={(e) => update({ stacked: e.target.checked })} />
          Stacked
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={showLegend} onChange={(e) => update({ showLegend: e.target.checked })} />
          Legend
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={showGrid} onChange={(e) => update({ showGrid: e.target.checked })} />
          Grid
        </label>
      </div>
    </div>
  );
}

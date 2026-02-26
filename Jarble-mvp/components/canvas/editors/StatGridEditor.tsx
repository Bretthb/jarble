"use client";

import { Plus, Trash2 } from "lucide-react";
import type { EditorProps } from "./registry";

interface StatItem {
  label: string;
  value: string | number;
  change?: string;
  icon?: string;
}

export default function StatGridEditor({ props, onChange, disabled }: EditorProps) {
  const stats = (props.stats as StatItem[]) || [];

  const update = (next: StatItem[]) => {
    onChange({ ...props, stats: next });
  };

  const updateStat = (idx: number, field: keyof StatItem, val: string) => {
    const next = stats.map((s, i) =>
      i === idx ? { ...s, [field]: val } : s
    );
    update(next);
  };

  const addStat = () => {
    update([...stats, { label: "", value: "" }]);
  };

  const removeStat = (idx: number) => {
    update(stats.filter((_, i) => i !== idx));
  };

  return (
    <fieldset disabled={disabled} className="space-y-3">
      {stats.map((stat, i) => (
        <div
          key={`${stat.label}-${i}`}
          className="flex gap-2 items-start group rounded-lg border border-border/40 bg-background/30 p-2"
        >
          <div className="flex-1 space-y-1.5">
            <div className="flex gap-1.5">
              <input
                type="text"
                value={stat.label}
                onChange={(e) => updateStat(i, "label", e.target.value)}
                placeholder="e.g. Users"
                className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
              />
              <input
                type="text"
                value={String(stat.value)}
                onChange={(e) => updateStat(i, "value", e.target.value)}
                placeholder="Value"
                className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
              />
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={stat.change || ""}
                onChange={(e) => updateStat(i, "change", e.target.value)}
                placeholder="e.g. +5%"
                className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
              />
              <input
                type="text"
                value={stat.icon || ""}
                onChange={(e) => updateStat(i, "icon", e.target.value)}
                placeholder="Icon (optional)"
                className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
              />
            </div>
          </div>
          <button
            onClick={() => removeStat(i)}
            className="md:opacity-0 md:group-hover:opacity-100 p-1 mt-1 text-muted-foreground hover:text-red-400 transition-opacity"
            aria-label={`Remove ${stat.label || "stat"}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={addStat}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border border-border/60 bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-40"
      >
        <Plus className="w-3 h-3" />
        Add stat
      </button>
    </fieldset>
  );
}

"use client";

import { Plus, Trash2 } from "lucide-react";
import type { EditorProps } from "./registry";

interface StatItem {
  label: string;
  value: string | number;
  change?: string;
  icon?: string;
}

export default function StatGridEditor({ props, onChange }: EditorProps) {
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
    <div className="space-y-2">
      {stats.map((stat, i) => (
        <div key={i} className="flex gap-1.5 items-start group">
          <div className="flex-1 grid grid-cols-2 gap-1.5">
            <input
              type="text"
              value={stat.label}
              onChange={(e) => updateStat(i, "label", e.target.value)}
              placeholder="Label"
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <input
              type="text"
              value={String(stat.value)}
              onChange={(e) => updateStat(i, "value", e.target.value)}
              placeholder="Value"
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <input
              type="text"
              value={stat.change || ""}
              onChange={(e) => updateStat(i, "change", e.target.value)}
              placeholder="Change (e.g. +5%)"
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <input
              type="text"
              value={stat.icon || ""}
              onChange={(e) => updateStat(i, "icon", e.target.value)}
              placeholder="Icon (optional)"
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <button
            onClick={() => removeStat(i)}
            className="opacity-0 group-hover:opacity-100 p-1 mt-1 text-muted-foreground hover:text-red-400 transition-opacity"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={addStat}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border border-border/60 bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
      >
        <Plus className="w-3 h-3" />
        Add stat
      </button>
    </div>
  );
}

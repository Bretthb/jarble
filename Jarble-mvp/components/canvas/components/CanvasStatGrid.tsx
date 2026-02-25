"use client";

export interface StatItem {
  label: string;
  value: string | number;
  change?: string;
  icon?: string;
}

export interface CanvasStatGridProps {
  stats: StatItem[];
}

export default function CanvasStatGrid({ stats = [] }: CanvasStatGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2 p-2 h-full">
      {stats.map((stat, i) => (
        <div key={i} className="p-2">
          <div className="flex items-center gap-2 mb-1">
            {stat.icon && <span className="text-base">{stat.icon}</span>}
            <span className="text-xs text-muted-foreground">{stat.label}</span>
          </div>
          <div className="text-lg font-semibold text-foreground">{String(stat.value)}</div>
          {stat.change && (
            <span
              className={`text-xs font-medium ${
                stat.change.startsWith("+") || stat.change.startsWith("↑")
                  ? "text-green-400"
                  : stat.change.startsWith("-") || stat.change.startsWith("↓")
                    ? "text-red-400"
                    : "text-muted-foreground"
              }`}
            >
              {stat.change}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

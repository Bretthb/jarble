"use client";

import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";

export interface CanvasChartProps {
  type: "bar" | "line" | "pie" | "area";
  title?: string;
  data: Record<string, string | number>[];
  dataKeys: string[];
  xAxisKey?: string;
  colors?: string[];
  stacked?: boolean;
  showLegend?: boolean;
  showGrid?: boolean;
  height?: number;
}

const DEFAULT_COLORS = [
  "var(--color-primary)",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
];

export default function CanvasChart({
  type,
  title,
  data,
  dataKeys,
  xAxisKey,
  colors = DEFAULT_COLORS,
  stacked = false,
  showLegend = true,
  showGrid = true,
  height = 300,
}: CanvasChartProps) {
  if (!data || data.length === 0 || !dataKeys || dataKeys.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        No chart data provided
      </div>
    );
  }

  const xKey = xAxisKey || Object.keys(data[0]).find((k) => !dataKeys.includes(k)) || "name";

  const renderChart = () => {
    switch (type) {
      case "bar":
        return (
          <BarChart data={data}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />}
            <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} />
            <YAxis tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: "0.75rem",
                fontSize: "0.75rem",
              }}
            />
            {showLegend && <Legend wrapperStyle={{ fontSize: "0.75rem" }} />}
            {dataKeys.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                fill={colors[i % colors.length]}
                stackId={stacked ? "stack" : undefined}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        );

      case "line":
        return (
          <LineChart data={data}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />}
            <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} />
            <YAxis tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: "0.75rem",
                fontSize: "0.75rem",
              }}
            />
            {showLegend && <Legend wrapperStyle={{ fontSize: "0.75rem" }} />}
            {dataKeys.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={colors[i % colors.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            ))}
          </LineChart>
        );

      case "area":
        return (
          <AreaChart data={data}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />}
            <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} />
            <YAxis tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: "0.75rem",
                fontSize: "0.75rem",
              }}
            />
            {showLegend && <Legend wrapperStyle={{ fontSize: "0.75rem" }} />}
            {dataKeys.map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                fill={colors[i % colors.length]}
                stroke={colors[i % colors.length]}
                fillOpacity={0.2}
                stackId={stacked ? "stack" : undefined}
              />
            ))}
          </AreaChart>
        );

      case "pie":
        return (
          <PieChart>
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: "0.75rem",
                fontSize: "0.75rem",
              }}
            />
            {showLegend && <Legend wrapperStyle={{ fontSize: "0.75rem" }} />}
            <Pie
              data={data}
              dataKey={dataKeys[0]}
              nameKey={xKey}
              cx="50%"
              cy="50%"
              outerRadius="80%"
              label={({ name, percent }) =>
                `${name} ${(percent * 100).toFixed(0)}%`
              }
              labelLine={false}
              fontSize={11}
            >
              {data.map((_, i) => (
                <Cell key={`cell-${i}`} fill={colors[i % colors.length]} />
              ))}
            </Pie>
          </PieChart>
        );

      default:
        return null;
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={height}>
        {renderChart()!}
      </ResponsiveContainer>
    </div>
  );
}

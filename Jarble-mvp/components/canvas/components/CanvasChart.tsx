"use client";

import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";
import { useCanvasAction } from "../CanvasActionContext";

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
  height,
}: CanvasChartProps) {
  let dispatch: ReturnType<typeof useCanvasAction>["dispatch"] | null = null;
  try {
    const ctx = useCanvasAction();
    dispatch = ctx.dispatch;
  } catch {
    // Not inside CanvasActionProvider — interactivity disabled
  }

  // Use explicit height if provided, otherwise fill container
  const useFlexHeight = height === undefined;

  if (!data || data.length === 0 || !dataKeys || dataKeys.length === 0) {
    return (
      <div className="p-3 h-full flex items-center justify-center text-sm text-muted-foreground">
        No chart data provided
      </div>
    );
  }

  const xKey = xAxisKey || Object.keys(data[0]).find((k) => !dataKeys.includes(k)) || "name";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleChartClick = (dataKey: string, entry: any) => {
    if (!dispatch || !entry) return;
    dispatch({
      action: "point_click",
      payload: {
        dataKey,
        value: entry[dataKey],
        label: entry[xKey] ?? "",
        entry,
      },
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlePieClick = (entry: any, index: number) => {
    if (!dispatch || !entry) return;
    dispatch({
      action: "slice_click",
      payload: {
        dataKey: dataKeys[0],
        value: entry[dataKeys[0]],
        label: entry[xKey] ?? entry.name ?? "",
        index,
        entry,
      },
    });
  };

  const renderChart = () => {
    switch (type) {
      case "bar":
        return (
          <BarChart data={data} className="cursor-pointer">
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
                className="cursor-pointer"
                onClick={(entry) => handleChartClick(key, entry)}
              />
            ))}
          </BarChart>
        );

      case "line":
        return (
          <LineChart data={data} className="cursor-pointer">
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
                activeDot={{ r: 6, className: "cursor-pointer", onClick: (_: unknown, payload: unknown) => handleChartClick(key, (payload as { payload: unknown }).payload) }}
              />
            ))}
          </LineChart>
        );

      case "area":
        return (
          <AreaChart data={data} className="cursor-pointer">
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
                activeDot={{ r: 6, className: "cursor-pointer", onClick: (_: unknown, payload: unknown) => handleChartClick(key, (payload as { payload: unknown }).payload) }}
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
              className="cursor-pointer"
              onClick={handlePieClick}
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

  const containerStyle = useFlexHeight
    ? { display: "flex", flexDirection: "column" as const, height: "100%", minHeight: 200 }
    : {};

  return (
    <div className="p-3 h-full" style={containerStyle}>
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-3 shrink-0">{title}</h3>
      )}
      <div style={useFlexHeight ? { flex: 1, minHeight: 0 } : { height: height || 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()!}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

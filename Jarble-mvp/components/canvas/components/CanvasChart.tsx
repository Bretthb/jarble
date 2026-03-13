"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useCanvasAction } from "../CanvasActionContext";

export interface CanvasChartProps {
  type: "bar" | "line" | "pie" | "area";
  title?: string;
  subtitle?: string;
  data: Record<string, string | number>[];
  dataKeys: string[];
  xAxisKey?: string;
  colors?: string[];
  stacked?: boolean;
  showLegend?: boolean;
  showGrid?: boolean;
  height?: number;
}

const PALETTE = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)",
  "var(--chart-4)", "var(--chart-5)",
  "#ec4899", "#06b6d4", "#f97316",
];

/** Prettify a data key into a human-readable label */
function humanize(key: string): string {
  return key.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function CanvasChartInner({
  type,
  title,
  subtitle,
  data,
  dataKeys,
  xAxisKey,
  colors,
  stacked = false,
  showLegend = true,
  showGrid = true,
  height,
}: CanvasChartProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dispatch: ((action: any) => void) | null = null;
  try {
    const ctx = useCanvasAction();
    dispatch = ctx.dispatch;
  } catch {
    // Not inside CanvasActionProvider -- interactivity disabled
  }

  if (!data || data.length === 0 || !dataKeys || dataKeys.length === 0) {
    return (
      <div className="p-6 h-full flex flex-col items-center justify-center text-sm text-muted-foreground gap-2">
        <span className="text-2xl opacity-40">chart</span>
        <span>No chart data provided</span>
      </div>
    );
  }

  const xKey = xAxisKey || Object.keys(data[0]).find((k) => !dataKeys.includes(k)) || "name";

  // Resolve a color for each data key
  const resolvedColors = dataKeys.map((_, i) =>
    colors?.[i] || PALETTE[i % PALETTE.length]
  );

  // Build shadcn chart config (drives tooltips & legends)
  const chartConfig: ChartConfig = {};
  dataKeys.forEach((key, i) => {
    chartConfig[key] = { label: humanize(key), color: resolvedColors[i] };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleClick = (dataKey: string, entry: any) => {
    if (!dispatch || !entry) return;
    dispatch({
      action: "point_click",
      payload: { dataKey, value: entry[dataKey], label: entry[xKey] ?? "", entry },
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

  const axisProps = {
    tickLine: false,
    axisLine: false,
    tickMargin: 8,
    fontSize: 11,
    stroke: "var(--color-muted-foreground)",
    strokeOpacity: 0.5,
  };

  const gridProps = {
    vertical: false,
    strokeDasharray: "3 3",
    stroke: "var(--color-border)",
    strokeOpacity: 0.5,
  };

  const renderChart = () => {
    switch (type) {
      case "bar":
        return (
          <BarChart data={data}>
            <defs>
              {dataKeys.map((key, i) => (
                <linearGradient key={key} id={`bar-fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={resolvedColors[i]} stopOpacity={0.9} />
                  <stop offset="100%" stopColor={resolvedColors[i]} stopOpacity={0.6} />
                </linearGradient>
              ))}
            </defs>
            {showGrid && <CartesianGrid {...gridProps} />}
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} />
            <ChartTooltip
              cursor={{ fill: "var(--color-muted)", opacity: 0.3, rx: 4 }}
              content={<ChartTooltipContent />}
            />
            {showLegend && dataKeys.length > 1 && (
              <ChartLegend content={<ChartLegendContent />} />
            )}
            {dataKeys.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                fill={`url(#bar-fill-${key})`}
                stackId={stacked ? "stack" : undefined}
                radius={stacked ? undefined : [6, 6, 0, 0]}
                className="cursor-pointer"
                onClick={(entry) => handleClick(key, entry)}
              />
            ))}
          </BarChart>
        );

      case "line":
        return (
          <LineChart data={data}>
            <defs>
              {dataKeys.map((key, i) => (
                <linearGradient key={key} id={`line-glow-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={resolvedColors[i]} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={resolvedColors[i]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            {showGrid && <CartesianGrid {...gridProps} />}
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {showLegend && dataKeys.length > 1 && (
              <ChartLegend content={<ChartLegendContent />} />
            )}
            {dataKeys.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={resolvedColors[i]}
                strokeWidth={2.5}
                dot={{ r: 3, fill: "var(--color-background)", stroke: resolvedColors[i], strokeWidth: 2 }}
                activeDot={{ r: 5, fill: resolvedColors[i], stroke: "var(--color-background)", strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        );

      case "area":
        return (
          <AreaChart data={data}>
            <defs>
              {dataKeys.map((key, i) => (
                <linearGradient key={key} id={`area-fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={resolvedColors[i]} stopOpacity={0.35} />
                  <stop offset="40%" stopColor={resolvedColors[i]} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={resolvedColors[i]} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            {showGrid && <CartesianGrid {...gridProps} />}
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} />
            <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
            {showLegend && dataKeys.length > 1 && (
              <ChartLegend content={<ChartLegendContent />} />
            )}
            {dataKeys.map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                fill={`url(#area-fill-${key})`}
                stroke={resolvedColors[i]}
                strokeWidth={2.5}
                stackId={stacked ? "stack" : undefined}
              />
            ))}
          </AreaChart>
        );

      case "pie": {
        const pieColors = data.map((_, i) =>
          colors?.[i % (colors?.length || 1)] || PALETTE[i % PALETTE.length]
        );
        // Add each slice label to chartConfig for tooltip
        data.forEach((item, i) => {
          const label = String(item[xKey] ?? item.name ?? `Slice ${i + 1}`);
          chartConfig[label] = { label, color: pieColors[i] };
        });
        return (
          <PieChart>
            <defs>
              {data.map((_, i) => (
                <linearGradient key={`pie-grad-${i}`} id={`pie-fill-${i}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={pieColors[i]} stopOpacity={1} />
                  <stop offset="100%" stopColor={pieColors[i]} stopOpacity={0.75} />
                </linearGradient>
              ))}
            </defs>
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            {showLegend && <ChartLegend content={<ChartLegendContent nameKey={xKey} />} />}
            <Pie
              data={data}
              dataKey={dataKeys[0]}
              nameKey={xKey}
              cx="50%"
              cy="50%"
              innerRadius="40%"
              outerRadius="72%"
              strokeWidth={2}
              stroke="var(--color-background)"
              className="cursor-pointer"
              onClick={handlePieClick}
              paddingAngle={2}
              cornerRadius={4}
            >
              {data.map((_, i) => (
                <Cell key={`cell-${i}`} fill={`url(#pie-fill-${i})`} />
              ))}
            </Pie>
          </PieChart>
        );
      }

      default:
        return null;
    }
  };

  const chartHeight = height || 260;
  const chartDescription = `${humanize(type)} chart${title ? `: ${title}` : ""}${dataKeys.length > 0 ? ` showing ${dataKeys.map(humanize).join(", ")}` : ""}`;

  return (
    <motion.div
      role="img"
      aria-label={chartDescription}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="p-4"
    >
      {/* Title area with optional subtitle */}
      {title && (
        <div className="mb-4">
          <h3 className="text-base font-semibold text-foreground leading-tight">{title}</h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground/70 mt-0.5">{subtitle}</p>
          )}
        </div>
      )}
      <ChartContainer config={chartConfig} className="aspect-auto w-full" style={{ height: chartHeight }}>
        {renderChart()!}
      </ChartContainer>
    </motion.div>
  );
}

export default memo(CanvasChartInner);

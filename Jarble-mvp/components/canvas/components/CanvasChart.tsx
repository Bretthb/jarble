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
    // Not inside CanvasActionProvider — interactivity disabled
  }

  if (!data || data.length === 0 || !dataKeys || dataKeys.length === 0) {
    return (
      <div className="p-4 h-full flex items-center justify-center text-sm text-muted-foreground">
        No chart data provided
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
    fontSize: 12,
  };

  const renderChart = () => {
    switch (type) {
      case "bar":
        return (
          <BarChart data={data}>
            {showGrid && <CartesianGrid vertical={false} />}
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} />
            <ChartTooltip
              cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
              content={<ChartTooltipContent />}
            />
            {showLegend && dataKeys.length > 1 && (
              <ChartLegend content={<ChartLegendContent />} />
            )}
            {dataKeys.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                fill={resolvedColors[i]}
                stackId={stacked ? "stack" : undefined}
                radius={stacked ? undefined : [4, 4, 0, 0]}
                className="cursor-pointer"
                onClick={(entry) => handleClick(key, entry)}
              />
            ))}
          </BarChart>
        );

      case "line":
        return (
          <LineChart data={data}>
            {showGrid && <CartesianGrid vertical={false} />}
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
                strokeWidth={2}
                dot={{ r: 3, fill: resolvedColors[i], strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 0 }}
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
                  <stop offset="0%" stopColor={resolvedColors[i]} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={resolvedColors[i]} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            {showGrid && <CartesianGrid vertical={false} />}
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
                strokeWidth={2}
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
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            {showLegend && <ChartLegend content={<ChartLegendContent nameKey={xKey} />} />}
            <Pie
              data={data}
              dataKey={dataKeys[0]}
              nameKey={xKey}
              cx="50%"
              cy="50%"
              innerRadius="35%"
              outerRadius="70%"
              strokeWidth={2}
              stroke="var(--color-background)"
              className="cursor-pointer"
              onClick={handlePieClick}
            >
              {data.map((_, i) => (
                <Cell key={`cell-${i}`} fill={pieColors[i]} />
              ))}
            </Pie>
          </PieChart>
        );
      }

      default:
        return null;
    }
  };

  const chartHeight = height || 250;
  const chartDescription = `${humanize(type)} chart${title ? `: ${title}` : ""}${dataKeys.length > 0 ? ` showing ${dataKeys.map(humanize).join(", ")}` : ""}`;

  return (
    <motion.div
      role="img"
      aria-label={chartDescription}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-4"
    >
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
      )}
      <ChartContainer config={chartConfig} className="aspect-auto w-full" style={{ height: chartHeight }}>
        {renderChart()!}
      </ChartContainer>
    </motion.div>
  );
}

export default memo(CanvasChartInner);

"use client";

import { memo, useMemo } from "react";
import { FadeIn } from "../FadeIn";
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
  "hsl(221, 83%, 53%)",  // blue-600
  "hsl(142, 71%, 45%)",  // green-500
  "hsl(24, 95%, 53%)",   // orange-500
  "hsl(262, 83%, 58%)",  // purple-500
  "hsl(0, 84%, 60%)",    // red-500
  "hsl(330, 81%, 60%)",  // pink-500
  "hsl(187, 85%, 43%)",  // cyan-600
  "hsl(45, 93%, 47%)",   // amber-500
];

/** Prettify a data key into a human-readable label */
function humanize(key: string): string {
  return key.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Smart number formatter - abbreviates large numbers, adds commas, handles decimals */
function formatValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(v / 1_000).toFixed(1)}K`;
  if (abs >= 1_000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (abs === 0) return "0";
  if (abs < 0.01) return v.toFixed(4);
  if (abs < 1) return v.toFixed(2);
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  return v.toFixed(2);
}

/** Format tooltip values with full precision */
function formatTooltipValue(v: number): string {
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Detect if x-axis values look like dates */
function looksLikeDates(data: Record<string, string | number>[], xKey: string): boolean {
  if (data.length === 0) return false;
  const sample = data.slice(0, 3);
  return sample.every((row) => {
    const v = row[xKey];
    if (typeof v !== "string") return false;
    // ISO dates, MM/DD, YYYY-MM-DD, "Jan 2024", etc.
    return /^\d{4}[-/]/.test(v) || /^\d{1,2}[/-]\d{1,2}/.test(v) || /^[A-Z][a-z]{2}\s?\d{2,4}/.test(v);
  });
}

/** Shorten date labels for x-axis (e.g. "2024-01-15" → "Jan 15") */
function shortenDate(v: string): string {
  // Try parsing as date
  const d = new Date(v);
  if (!isNaN(d.getTime())) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }
  // Already short or not a date - return truncated
  return v.length > 8 ? v.slice(0, 8) : v;
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
  const isDates = useMemo(() => looksLikeDates(data, xKey), [data, xKey]);

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

  const xAxisTickFormatter = isDates
    ? (v: string) => shortenDate(v)
    : (v: string) => (String(v).length > 12 ? String(v).slice(0, 10) + "…" : String(v));

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
    strokeOpacity: 0.4,
  };

  // Determine optimal x-axis label angle based on data count + label length
  const avgLabelLen = data.reduce((sum, row) => sum + String(row[xKey] ?? "").length, 0) / data.length;
  const needsAngle = data.length > 6 && avgLabelLen > 4;
  const xAxisExtra = needsAngle
    ? { angle: -35, textAnchor: "end" as const, height: 50, interval: 0 }
    : data.length > 12
      ? { interval: Math.ceil(data.length / 8) }
      : {};

  const renderChart = () => {
    switch (type) {
      case "bar":
        return (
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: needsAngle ? 20 : 4, left: 0 }}>
            <defs>
              {dataKeys.map((key, i) => (
                <linearGradient key={key} id={`bar-fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={resolvedColors[i]} stopOpacity={0.9} />
                  <stop offset="100%" stopColor={resolvedColors[i]} stopOpacity={0.6} />
                </linearGradient>
              ))}
            </defs>
            {showGrid && <CartesianGrid {...gridProps} />}
            <XAxis dataKey={xKey} {...axisProps} {...xAxisExtra} tickFormatter={xAxisTickFormatter} />
            <YAxis {...axisProps} tickFormatter={(v: number) => formatValue(v)} width={48} />
            <ChartTooltip
              cursor={{ fill: "var(--color-muted)", opacity: 0.2, rx: 4 }}
              content={<ChartTooltipContent formatter={(value) => formatTooltipValue(Number(value))} />}
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
                radius={stacked ? undefined : [4, 4, 0, 0]}
                className="cursor-pointer"
                onClick={(entry) => handleClick(key, entry)}
              />
            ))}
          </BarChart>
        );

      case "line":
        return (
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: needsAngle ? 20 : 4, left: 0 }}>
            {showGrid && <CartesianGrid {...gridProps} />}
            <XAxis dataKey={xKey} {...axisProps} {...xAxisExtra} tickFormatter={xAxisTickFormatter} />
            <YAxis {...axisProps} tickFormatter={(v: number) => formatValue(v)} width={48} />
            <ChartTooltip content={<ChartTooltipContent formatter={(value) => formatTooltipValue(Number(value))} />} />
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
                dot={data.length <= 30 ? { r: 2, fill: "var(--color-background)", stroke: resolvedColors[i], strokeWidth: 1.5 } : false}
                activeDot={{ r: 4, fill: resolvedColors[i], stroke: "var(--color-background)", strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        );

      case "area":
        return (
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: needsAngle ? 20 : 4, left: 0 }}>
            <defs>
              {dataKeys.map((key, i) => (
                <linearGradient key={key} id={`area-fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={resolvedColors[i]} stopOpacity={0.3} />
                  <stop offset="50%" stopColor={resolvedColors[i]} stopOpacity={0.1} />
                  <stop offset="100%" stopColor={resolvedColors[i]} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            {showGrid && <CartesianGrid {...gridProps} />}
            <XAxis dataKey={xKey} {...axisProps} {...xAxisExtra} tickFormatter={xAxisTickFormatter} />
            <YAxis {...axisProps} tickFormatter={(v: number) => formatValue(v)} width={48} />
            <ChartTooltip content={<ChartTooltipContent indicator="dot" formatter={(value) => formatTooltipValue(Number(value))} />} />
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
            <defs>
              {data.map((_, i) => (
                <linearGradient key={`pie-grad-${i}`} id={`pie-fill-${i}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={pieColors[i]} stopOpacity={1} />
                  <stop offset="100%" stopColor={pieColors[i]} stopOpacity={0.75} />
                </linearGradient>
              ))}
            </defs>
            <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(value) => formatTooltipValue(Number(value))} />} />
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

  const chartHeight = height || 280;
  const chartDescription = `${humanize(type)} chart${title ? `: ${title}` : ""}${dataKeys.length > 0 ? ` showing ${dataKeys.map(humanize).join(", ")}` : ""}`;

  return (
    <FadeIn
      role="img"
      aria-label={chartDescription}
      className="p-4 h-full flex flex-col"
    >
      {/* Title area with optional subtitle */}
      {title && (
        <div className="mb-3 shrink-0">
          <h3 className="text-sm font-semibold text-foreground leading-tight">{title}</h3>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">{subtitle}</p>
          )}
        </div>
      )}
      <ChartContainer config={chartConfig} className="aspect-auto w-full flex-1 min-h-0" style={{ minHeight: chartHeight }}>
        {renderChart()!}
      </ChartContainer>
    </FadeIn>
  );
}

export default memo(CanvasChartInner);

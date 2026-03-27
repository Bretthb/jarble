"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Cpu,
  HardDrive,
  MemoryStick,
  Server,
  RotateCcw,
  AlertTriangle,
  Loader2,
  Info,
} from "lucide-react";
import { MetricsChart } from "@/components/admin/MetricsChart";

type Range = "1h" | "6h" | "24h" | "7d";

const RANGES: { value: Range; label: string }[] = [
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
];

const SEVERITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  critical: "destructive",
  warning: "default",
  info: "secondary",
};

export default function AdminMetrics() {
  const [range, setRange] = useState<Range>("1h");

  const cluster = trpc.admin.getClusterMetrics.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const alerts = trpc.admin.getClusterAlerts.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const nodeCpu = trpc.admin.getMetricsTimeSeries.useQuery(
    { queryKey: "node_cpu", range },
    { refetchInterval: 30_000 }
  );
  const nodeMemory = trpc.admin.getMetricsTimeSeries.useQuery(
    { queryKey: "node_memory", range },
    { refetchInterval: 30_000 }
  );
  const nodeDisk = trpc.admin.getMetricsTimeSeries.useQuery(
    { queryKey: "node_disk", range },
    { refetchInterval: 30_000 }
  );
  const podCpu = trpc.admin.getMetricsTimeSeries.useQuery(
    { queryKey: "pod_cpu", range },
    { refetchInterval: 30_000 }
  );
  const podMemory = trpc.admin.getMetricsTimeSeries.useQuery(
    { queryKey: "pod_memory", range },
    { refetchInterval: 30_000 }
  );

  if (cluster.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (cluster.data && !cluster.data.available) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Cluster Metrics</h1>
        <Card>
          <CardContent className="py-8 flex items-center gap-3 text-muted-foreground">
            <Info className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-medium text-foreground">Monitoring stack not reachable</p>
              <p className="text-sm mt-1">
                Prometheus is not responding. Ensure the monitoring namespace is deployed
                and PROMETHEUS_URL is configured correctly.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { nodes, runningPods, recentRestarts } = cluster.data ?? {
    nodes: [],
    runningPods: 0,
    recentRestarts: 0,
  };

  const avgCpu = nodes.length > 0
    ? Math.round((nodes.reduce((s, n) => s + n.cpu, 0) / nodes.length) * 10) / 10
    : 0;
  const avgMemory = nodes.length > 0
    ? Math.round((nodes.reduce((s, n) => s + n.memory, 0) / nodes.length) * 10) / 10
    : 0;

  return (
    <div className="space-y-6">
      {/* Header + range selector */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cluster Metrics</h1>
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {RANGES.map((r) => (
            <Button
              key={r.value}
              variant={range === r.value ? "default" : "ghost"}
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setRange(r.value)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Running Pods"
          value={runningPods}
          icon={<Server className="w-4 h-4" />}
        />
        <StatCard
          title="Avg Node CPU"
          value={`${avgCpu}%`}
          icon={<Cpu className="w-4 h-4" />}
        />
        <StatCard
          title="Avg Node Memory"
          value={`${avgMemory}%`}
          icon={<MemoryStick className="w-4 h-4" />}
        />
        <StatCard
          title="Recent Restarts"
          value={recentRestarts}
          subtitle="last 1h"
          icon={<RotateCcw className="w-4 h-4" />}
        />
      </div>

      {/* Node charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MetricsChart
          title="CPU Usage by Node"
          series={nodeCpu.data?.series ?? []}
          unit="%"
          isLoading={nodeCpu.isLoading}
        />
        <MetricsChart
          title="Memory Usage by Node"
          series={nodeMemory.data?.series ?? []}
          unit="%"
          isLoading={nodeMemory.isLoading}
        />
      </div>

      {/* Disk chart */}
      <MetricsChart
        title="Disk Usage by Node"
        series={nodeDisk.data?.series ?? []}
        unit="%"
        isLoading={nodeDisk.isLoading}
      />

      {/* Pod charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MetricsChart
          title="Pod CPU Usage (jarble namespace)"
          series={podCpu.data?.series ?? []}
          unit="cores"
          isLoading={podCpu.isLoading}
        />
        <MetricsChart
          title="Pod Memory Usage (jarble namespace)"
          series={podMemory.data?.series ?? []}
          unit="MB"
          isLoading={podMemory.isLoading}
        />
      </div>

      {/* Active Alerts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Active Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {alerts.isLoading ? (
            <div className="flex items-center justify-center h-16">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : !alerts.data?.alerts?.length ? (
            <p className="text-sm text-muted-foreground">No active alerts.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium">Alert</th>
                    <th className="text-left py-2 font-medium">Severity</th>
                    <th className="text-left py-2 font-medium">Summary</th>
                    <th className="text-left py-2 font-medium">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.data.alerts.map((alert, i) => (
                    <tr key={`${alert.name}-${i}`} className="border-b last:border-0">
                      <td className="py-2 font-mono">{alert.name}</td>
                      <td className="py-2">
                        <Badge variant={SEVERITY_VARIANT[alert.severity] ?? "outline"}>
                          {alert.severity}
                        </Badge>
                      </td>
                      <td className="py-2 text-muted-foreground">{alert.summary}</td>
                      <td className="py-2 text-muted-foreground">
                        {alert.startsAt
                          ? new Date(alert.startsAt).toLocaleString()
                          : " - "}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

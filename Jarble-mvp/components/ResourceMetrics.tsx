"use client";

import { Progress } from "@/components/ui/progress";
import { Server, Cpu, MemoryStick, Clock, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface ResourceMetricsProps {
  nodeName?: string | null;
  cpuUsageMillicores?: number | null;
  cpuLimitMillicores?: number | null;
  memoryUsageMb?: number | null;
  memoryLimitMb?: number | null;
  uptimeSeconds?: number | null;
  restarts?: number;
}

function getColorClass(percent: number) {
  if (percent >= 90) return "text-red-500";
  if (percent >= 70) return "text-amber-500";
  return "text-primary";
}

function getBarClass(percent: number) {
  if (percent >= 90) return "[&_[data-slot=progress-indicator]]:bg-red-500";
  if (percent >= 70) return "[&_[data-slot=progress-indicator]]:bg-amber-500";
  return "";
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const NODE_LABELS: Record<string, string> = {
  "jarble-master": "Server 1",
  "jarble-agent-1": "Server 2",
  "jarble-agent-2": "Server 3",
};

function formatNodeName(name: string): string {
  return NODE_LABELS[name] ?? name;
}

export function ResourceMetrics({
  nodeName,
  cpuUsageMillicores,
  cpuLimitMillicores,
  memoryUsageMb,
  memoryLimitMb,
  uptimeSeconds,
  restarts,
}: ResourceMetricsProps) {
  const hasAnything =
    nodeName != null ||
    cpuUsageMillicores != null ||
    memoryUsageMb != null ||
    uptimeSeconds != null ||
    (restarts != null && restarts > 0);

  if (!hasAnything) return null;

  const cpuPercent =
    cpuUsageMillicores != null && cpuLimitMillicores != null && cpuLimitMillicores > 0
      ? Math.round((cpuUsageMillicores / cpuLimitMillicores) * 100)
      : null;

  const memPercent =
    memoryUsageMb != null && memoryLimitMb != null && memoryLimitMb > 0
      ? Math.round((memoryUsageMb / memoryLimitMb) * 100)
      : null;

  return (
    <div className="space-y-1.5">
      {/* Node */}
      {nodeName && (
        <div className="flex items-center gap-2">
          <Server className="w-3 h-3 shrink-0 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">{formatNodeName(nodeName)}</span>
        </div>
      )}

      {/* CPU */}
      {cpuPercent != null && (
        <div className="flex items-center gap-2 min-w-0">
          <Cpu className={cn("w-3 h-3 shrink-0", getColorClass(cpuPercent))} />
          <div className="flex-1 min-w-0">
            <Progress value={cpuPercent} className={cn("h-1.5", getBarClass(cpuPercent))} />
          </div>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {cpuUsageMillicores}/{cpuLimitMillicores}m
          </span>
        </div>
      )}

      {/* Memory */}
      {memPercent != null && (
        <div className="flex items-center gap-2 min-w-0">
          <MemoryStick className={cn("w-3 h-3 shrink-0", getColorClass(memPercent))} />
          <div className="flex-1 min-w-0">
            <Progress value={memPercent} className={cn("h-1.5", getBarClass(memPercent))} />
          </div>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {memoryUsageMb}/{memoryLimitMb} MB
          </span>
        </div>
      )}

      {/* Uptime + Restarts row */}
      {(uptimeSeconds != null || (restarts != null && restarts > 0)) && (
        <div className="flex items-center gap-3">
          {uptimeSeconds != null && (
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 shrink-0 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">{formatUptime(uptimeSeconds)}</span>
            </div>
          )}
          {restarts != null && restarts > 0 && (
            <div className="flex items-center gap-1">
              <RotateCw className={cn("w-3 h-3 shrink-0", restarts >= 3 ? "text-red-500" : "text-amber-500")} />
              <span className={cn("text-[10px]", restarts >= 3 ? "text-red-500" : "text-amber-500")}>
                {restarts} restart{restarts !== 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ResourceMetricsSkeleton() {
  return (
    <div className="space-y-1.5 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded bg-secondary" />
        <div className="w-14 h-3 rounded bg-secondary" />
      </div>
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded bg-secondary" />
        <div className="flex-1 h-1.5 rounded-full bg-secondary" />
        <div className="w-14 h-3 rounded bg-secondary" />
      </div>
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded bg-secondary" />
        <div className="flex-1 h-1.5 rounded-full bg-secondary" />
        <div className="w-14 h-3 rounded bg-secondary" />
      </div>
    </div>
  );
}

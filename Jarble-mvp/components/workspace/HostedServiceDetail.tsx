"use client";

import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Activity, Download, Clock, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface HostedServiceDetailProps {
  serviceId: string;
}

const STATUS_STYLES: Record<string, string> = {
  published: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  draft: "bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/20",
  pending_review: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
  suspended: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
};

const HOSTING_LABELS: Record<string, string> = {
  self_hosted: "Self-hosted",
  remote: "Cloud",
  hybrid: "Hybrid",
};

const HEALTH_DOT_STYLES: Record<string, string> = {
  healthy: "bg-emerald-500",
  degraded: "bg-amber-500",
  offline: "bg-red-500",
  unknown: "bg-gray-400",
};

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return n.toString();
}

function formatMonth(month: string): string {
  // "2026-03" → "Mar"
  const [, m] = month.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[parseInt(m, 10) - 1] ?? month;
}

function formatTimestamp(ts: string | Date | null): string {
  if (!ts) return "Never";
  const d = typeof ts === "string" ? new Date(ts) : ts;
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return d.toLocaleDateString();
}

export function HostedServiceDetail({ serviceId }: HostedServiceDetailProps) {
  const { data, isLoading } = trpc.services.hostedServiceStats.useQuery({ serviceId });

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-secondary/30 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4 text-sm text-muted-foreground">Service not found</div>
    );
  }

  const { service, totalInstalls, totalRequests, monthlyUsage, skillBreakdown, installs } = data;
  const statusStyle = STATUS_STYLES[service.status] ?? STATUS_STYLES.draft;
  const hostingLabel = HOSTING_LABELS[service.hostingModel] ?? service.hostingModel;
  const healthStatus = service.remoteHealth ?? "unknown";
  const healthDot = HEALTH_DOT_STYLES[healthStatus] ?? HEALTH_DOT_STYLES.unknown;
  const isRemote = service.hostingModel === "remote" || service.hostingModel === "hybrid";

  return (
    <div className="p-4 space-y-5">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-foreground">{service.displayName}</h3>
          <Badge variant="outline" className={cn("text-[10px]", statusStyle)}>
            {service.status === "pending_review" ? "Review" : service.status}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {hostingLabel}
          </Badge>
        </div>
        {service.description && (
          <p className="text-xs text-muted-foreground leading-relaxed">{service.description}</p>
        )}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-border/40 bg-secondary/20 p-2.5 text-center">
          <div className="text-lg font-bold text-foreground">{formatCount(totalInstalls)}</div>
          <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
            <Download className="size-3" />
            Installs
          </div>
        </div>
        <div className="rounded-lg border border-border/40 bg-secondary/20 p-2.5 text-center">
          <div className="text-lg font-bold text-foreground">{formatCount(totalRequests)}</div>
          <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
            <Activity className="size-3" />
            Requests
          </div>
        </div>
        <div className="rounded-lg border border-border/40 bg-secondary/20 p-2.5 text-center">
          {isRemote ? (
            <>
              <div className="flex items-center justify-center gap-1.5">
                <span className={cn("inline-block size-2.5 rounded-full", healthDot)} />
                <span className="text-sm font-semibold text-foreground capitalize">{healthStatus}</span>
              </div>
              <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                <Clock className="size-3" />
                {formatTimestamp(service.remoteLastCheck)}
              </div>
            </>
          ) : (
            <>
              <div className="text-lg font-bold text-foreground">--</div>
              <div className="text-[10px] text-muted-foreground">Self-hosted</div>
            </>
          )}
        </div>
      </div>

      {/* Usage chart */}
      {monthlyUsage.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Monthly Requests
          </span>
          <div className="h-32 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyUsage} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <XAxis
                  dataKey="month"
                  tickFormatter={formatMonth}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 8,
                    border: "1px solid hsl(var(--border))",
                    background: "hsl(var(--popover))",
                    color: "hsl(var(--popover-foreground))",
                  }}
                  labelFormatter={formatMonth}
                />
                <Bar
                  dataKey="requests"
                  fill="hsl(var(--primary))"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Per-skill breakdown */}
      {skillBreakdown.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Skill Breakdown (this month)
          </span>
          <div className="rounded-lg border border-border/40 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40 bg-secondary/20">
                  <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Skill</th>
                  <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Requests</th>
                </tr>
              </thead>
              <tbody>
                {skillBreakdown.map((s) => (
                  <tr key={s.skill} className="border-b border-border/20 last:border-0">
                    <td className="px-3 py-1.5 text-foreground">{s.skill}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                      {formatCount(s.requests)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent installs */}
      {installs.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Recent Installs
          </span>
          <div className="space-y-1">
            {installs.slice(0, 10).map((inst) => (
              <div
                key={inst.id}
                className="flex items-center justify-between px-3 py-1.5 rounded-md bg-secondary/20 border border-border/30"
              >
                <span className="text-xs text-foreground truncate">{inst.deploymentName}</span>
                <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                  {formatTimestamp(inst.installedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit link */}
      <div className="pt-2">
        <Link href={`/marketplace/services/${serviceId}`} passHref>
          <Button variant="outline" size="sm" className="w-full text-xs gap-1.5">
            <ExternalLink className="size-3" />
            View in Marketplace
          </Button>
        </Link>
      </div>
    </div>
  );
}

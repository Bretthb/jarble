"use client";

import { cn } from "@/lib/utils";
import { Activity, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface HostedServiceSummary {
  id: string;
  name: string;
  displayName: string;
  status: string;
  hostingModel: string;
  remoteHealth: string | null;
  remoteLastCheck: string | Date | null;
  totalInstalls: number;
  monthlyRequests: number;
  pricingModel: string;
  priceUsdCents: number;
}

interface HostedServiceSummaryCardProps {
  service: HostedServiceSummary;
  onClick: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  published: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  draft: "bg-secondary text-muted-foreground border-border",
  pending_review: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
  suspended: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
};

const HEALTH_DOT_STYLES: Record<string, string> = {
  healthy: "bg-emerald-500",
  degraded: "bg-amber-500",
  offline: "bg-red-500",
  unknown: "bg-muted-foreground",
};

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return n.toString();
}

export function HostedServiceSummaryCard({ service, onClick }: HostedServiceSummaryCardProps) {
  const statusStyle = STATUS_STYLES[service.status] ?? STATUS_STYLES.draft;
  const healthStatus = service.remoteHealth ?? "unknown";
  const healthDot = HEALTH_DOT_STYLES[healthStatus] ?? HEALTH_DOT_STYLES.unknown;
  const isRemote = service.hostingModel === "remote" || service.hostingModel === "hybrid";

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border/40 bg-secondary/20 p-3 space-y-2 hover:border-primary/30 hover:bg-secondary/30 transition-colors"
    >
      {/* Name + health dot */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isRemote && (
            <span
              className={cn("inline-block size-2 rounded-full shrink-0", healthDot)}
              title={`Health: ${healthStatus}`}
            />
          )}
          <span className="text-sm font-medium text-foreground truncate">
            {service.displayName}
          </span>
        </div>
        <Badge variant="outline" className={cn("text-[10px] shrink-0", statusStyle)}>
          {service.status === "pending_review" ? "Review" : service.status}
        </Badge>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Activity className="size-3" />
          <span className="font-semibold text-foreground">{formatCount(service.monthlyRequests)}</span>
          req/mo
        </span>
        <span className="flex items-center gap-1">
          <Download className="size-3" />
          {formatCount(service.totalInstalls)} installs
        </span>
      </div>
    </button>
  );
}

"use client";

import Link from "next/link";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Download, User, Package, Puzzle, Wrench } from "lucide-react";
import { StarRating } from "./StarRating";

export interface PackageCardData {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  hostingModel: string;
  status: string;
  pricingModel: string;
  priceUsdCents: number | null;
  totalInstalls: number | null;
  avgRating: number | null;
  remoteHealth?: string | null; // "healthy" | "degraded" | "offline" | "unknown"
  componentCount: number;
  skillCount: number;
  creator: { id: string; displayName: string } | null;
  createdAt: string;
}

interface PackageCardProps {
  pkg: PackageCardData;
  className?: string;
}

function formatInstalls(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  }
  return count.toString();
}

function formatPrice(model: string, cents: number): string {
  if (model === "free" || cents === 0) return "Free";
  const dollars = cents / 100;
  const formatted = dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2);
  return `$${formatted}`;
}

const HOSTING_STYLES: Record<string, string> = {
  self_hosted: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",
  remote: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
  hybrid: "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/20",
};

const HOSTING_LABELS: Record<string, string> = {
  self_hosted: "Self-hosted",
  remote: "Hosted",
  hybrid: "Hybrid",
};

const HEALTH_DOT_STYLES: Record<string, string> = {
  healthy: "bg-emerald-500",
  degraded: "bg-amber-500",
  offline: "bg-red-500",
  unknown: "bg-gray-400",
};

const HEALTH_LABELS: Record<string, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  offline: "Offline",
  unknown: "Unknown",
};

export function PackageCard({ pkg, className }: PackageCardProps) {
  const price = formatPrice(pkg.pricingModel, pkg.priceUsdCents ?? 0);
  const hostingStyle = HOSTING_STYLES[pkg.hostingModel] ?? "bg-secondary text-secondary-foreground border-border";
  const hostingLabel = HOSTING_LABELS[pkg.hostingModel] ?? pkg.hostingModel;
  const isRemoteOrHybrid = pkg.hostingModel === "remote" || pkg.hostingModel === "hybrid";
  const healthStatus = pkg.remoteHealth ?? "unknown";
  const healthDot = HEALTH_DOT_STYLES[healthStatus] ?? HEALTH_DOT_STYLES.unknown;
  const healthLabel = HEALTH_LABELS[healthStatus] ?? "Unknown";

  return (
    <Link href={`/marketplace/packages/${pkg.id}`} className="block group">
      <Card
        className={cn(
          "border border-border bg-card hover:border-primary/30 hover:shadow-md transition-all duration-200 h-full",
          className
        )}
      >
        <CardContent className="pt-5 pb-3 space-y-3">
          {/* Header: name + price */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-foreground leading-snug group-hover:text-primary transition-colors">
              {pkg.displayName}
            </h3>
            <span
              className={cn(
                "text-sm font-semibold shrink-0",
                price === "Free"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-foreground"
              )}
            >
              {price}
            </span>
          </div>

          {/* Description */}
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            {pkg.description ?? "No description"}
          </p>

          {/* Badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge
              variant="outline"
              className={cn("text-[11px] gap-1", "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border-indigo-500/20")}
            >
              <Package className="size-3" />
              Package
            </Badge>
            <Badge
              variant="outline"
              className={cn("text-[11px] gap-1", hostingStyle)}
            >
              {isRemoteOrHybrid && (
                <span
                  className={cn("inline-block size-1.5 rounded-full shrink-0", healthDot)}
                  title={healthLabel}
                  aria-label={`Health: ${healthLabel}`}
                />
              )}
              {hostingLabel}
            </Badge>
          </div>

          {/* Contents summary */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {pkg.componentCount > 0 && (
              <span className="flex items-center gap-1">
                <Puzzle className="size-3" />
                {pkg.componentCount} component{pkg.componentCount !== 1 ? "s" : ""}
              </span>
            )}
            {pkg.skillCount > 0 && (
              <span className="flex items-center gap-1">
                <Wrench className="size-3" />
                {pkg.skillCount} skill{pkg.skillCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </CardContent>

        <CardFooter className="pt-0 pb-4 flex items-center justify-between text-xs text-muted-foreground">
          {/* Rating + installs */}
          <div className="flex items-center gap-3">
            <StarRating rating={(pkg.avgRating ?? 0) / 100} count={0} />
            <span className="flex items-center gap-1">
              <Download className="size-3" />
              {formatInstalls(pkg.totalInstalls ?? 0)}
            </span>
          </div>

          {/* Creator */}
          {pkg.creator && (
            <span className="flex items-center gap-1 truncate max-w-[120px]">
              <User className="size-3 shrink-0" />
              <span className="truncate">{pkg.creator.displayName}</span>
            </span>
          )}
        </CardFooter>
      </Card>
    </Link>
  );
}

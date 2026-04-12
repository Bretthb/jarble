"use client";

/**
 * CreditStatusBanner
 *
 * Shown above the chat panel for deployments running on managed credits
 * ("included" llmMode). Hidden when credits are healthy (<80% used), shows
 * a yellow warning at 80-99%, and a blocking red banner at 100%.
 *
 * Polls trpc.openrouter.creditStatus every 60s so the user sees refreshed
 * usage without needing to reload. On exhaustion, the Top Up button opens
 * the in-deployment model tab where they can raise the limit.
 */

import { AlertTriangle, Zap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

interface CreditStatusBannerProps {
  deploymentId: string;
  /** If set, overrides the default "/d/{id}?tab=model" top-up link */
  topUpHref?: string;
  className?: string;
}

export function CreditStatusBanner({ deploymentId, topUpHref, className }: CreditStatusBannerProps) {
  const query = trpc.openrouter.creditStatus.useQuery(
    { deploymentId },
    { staleTime: 30_000, refetchInterval: 60_000 }
  );

  const status = query.data;
  if (!status) return null; // BYOK, unlimited, or management API not configured
  if (status.level === "ok") return null;

  const isExhausted = status.level === "exhausted";
  const href = topUpHref ?? `/d/${deploymentId}?tab=model`;
  const pct = status.percentUsed ?? 100;

  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border px-3 py-2 flex items-center gap-3",
        isExhausted
          ? "border-red-500/40 bg-red-500/10"
          : "border-amber-500/40 bg-amber-500/10",
        className
      )}
    >
      <AlertTriangle
        className={cn(
          "w-4 h-4 shrink-0",
          isExhausted ? "text-red-400" : "text-amber-400"
        )}
      />
      <div className="min-w-0 flex-1 text-xs">
        <p className={cn("font-medium", isExhausted ? "text-red-400" : "text-amber-400")}>
          {isExhausted
            ? "Managed credits exhausted"
            : `Managed credits running low (${pct}% used)`}
        </p>
        <p className="text-muted-foreground mt-0.5">
          {isExhausted
            ? "Chats will fail until you add credits or upgrade your plan."
            : "Add credits now to avoid interruption when this month's cap is reached."}
          {status.limit != null && (
            <span className="ml-1">
              (${status.usage.toFixed(2)} of ${status.limit.toFixed(2)})
            </span>
          )}
        </p>
      </div>
      <Button asChild size="sm" variant={isExhausted ? "default" : "outline"} className="h-7 text-xs gap-1.5 shrink-0">
        <Link href={href}>
          <Zap className="w-3 h-3" />
          {isExhausted ? "Add Credits" : "Top Up"}
        </Link>
      </Button>
    </div>
  );
}

export default CreditStatusBanner;

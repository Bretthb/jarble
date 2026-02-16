"use client";

import { AlertCircle, Download, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CancellationGracePeriodProps {
  cancelAtPeriodEnd: string;
  onExport: () => void;
  onReactivate: () => void;
  isExporting: boolean;
  isReactivating: boolean;
}

function daysRemaining(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function CancellationGracePeriod({
  cancelAtPeriodEnd,
  onExport,
  onReactivate,
  isExporting,
  isReactivating,
}: CancellationGracePeriodProps) {
  const days = daysRemaining(cancelAtPeriodEnd);

  return (
    <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-orange-500">Cancelling</p>
          <p className="text-xs text-muted-foreground">
            Access until {formatDate(cancelAtPeriodEnd)} ({days}d remaining)
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5 border-border/60"
          onClick={onExport}
          disabled={isExporting}
        >
          {isExporting ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Download className="w-3 h-3" />
          )}
          Export
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5 border-border/60"
          onClick={onReactivate}
          disabled={isReactivating}
        >
          {isReactivating ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RotateCcw className="w-3 h-3" />
          )}
          Reactivate
        </Button>
      </div>
    </div>
  );
}

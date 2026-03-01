"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2,
  Trash2,
  Package,
  AlertCircle,
  ExternalLink,
  Store,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { TierBadge } from "@/components/marketplace/TierBadge";

export interface ComponentsTabProps {
  deploymentId: string;
  deploymentStatus?: string;
}

export function ComponentsTab({ deploymentId, deploymentStatus }: ComponentsTabProps) {
  const utils = trpc.useUtils();

  // Typed tRPC queries
  const installedQuery = trpc.marketplace.listInstalled.useQuery(
    { deploymentId },
    { enabled: !!deploymentId }
  );

  const uninstallMutation = trpc.marketplace.uninstall.useMutation({
    onSuccess: () => {
      toast.success("Component uninstalled");
      utils.marketplace.listInstalled.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to uninstall component");
    },
  });

  // Track which component is being uninstalled
  const [pendingUninstall, setPendingUninstall] = useState<string | null>(null);

  const handleUninstall = (componentId: string) => {
    setPendingUninstall(componentId);
    uninstallMutation.mutate(
      { deploymentId, componentId },
      {
        onSettled: () => setPendingUninstall(null),
      }
    );
  };

  // Backend listInstalled returns array of objects with nested `component` field
  const installed = installedQuery.data;

  const isNotRunning = deploymentStatus && deploymentStatus !== "running";

  // -- Not running warning --
  if (isNotRunning) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold mb-1">Marketplace Components</h2>
          <p className="text-muted-foreground text-sm">
            Manage installed marketplace components for this deployment
          </p>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertCircle className="w-8 h-8 text-amber-500 mb-3" />
          <p className="text-sm text-muted-foreground mb-1">
            Deployment is not running
          </p>
          <p className="text-xs text-muted-foreground/70">
            Start the deployment to manage marketplace components.
          </p>
        </div>
      </div>
    );
  }

  // -- Loading state --
  if (installedQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold mb-1">Marketplace Components</h2>
          <p className="text-muted-foreground text-sm">
            Manage installed marketplace components for this deployment
          </p>
        </div>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Loading components...
          </span>
        </div>
      </div>
    );
  }

  // -- Error state --
  if (installedQuery.isError) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold mb-1">Marketplace Components</h2>
          <p className="text-muted-foreground text-sm">
            Manage installed marketplace components for this deployment
          </p>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertCircle className="w-8 h-8 text-destructive mb-3" />
          <p className="text-sm text-muted-foreground mb-4">
            Failed to load installed components. Please try again.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => installedQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const hasInstalled = installed && installed.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold mb-1">Marketplace Components</h2>
          <p className="text-muted-foreground text-sm">
            Manage installed marketplace components for this deployment
          </p>
        </div>
        <Link href="/marketplace">
          <Button variant="outline" size="sm" className="shrink-0">
            <Store className="w-3.5 h-3.5 mr-1.5" />
            Browse Marketplace
          </Button>
        </Link>
      </div>

      {/* Installed Components */}
      {hasInstalled ? (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" />
            Installed Components
            <Badge variant="secondary" className="text-xs">
              {installed.length}
            </Badge>
          </h3>
          <div className="space-y-3">
            {installed.map((item) => {
              const comp = item.component;
              if (!comp) return null;
              const isUninstalling = pendingUninstall === comp.id;

              return (
                <div
                  key={item.installId}
                  className="p-4 rounded-lg border border-primary/20 bg-primary/5 transition-all"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Package className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-semibold text-sm">
                            {comp.displayName || comp.name}
                          </h4>
                          <TierBadge tier={comp.tier} />
                          {item.version && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0"
                            >
                              v{item.version}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground/70 mt-1.5">
                          Installed{" "}
                          {new Date(item.installedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUninstall(comp.id)}
                      disabled={isUninstalling}
                      className="border-border text-muted-foreground hover:text-destructive hover:border-destructive/30 flex-shrink-0"
                    >
                      {isUninstalling ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          Uninstall
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Empty State */
        <div className="py-16 text-center">
          <Package className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground mb-1">
            No marketplace components installed
          </p>
          <p className="text-xs text-muted-foreground/70 mb-4">
            Browse the marketplace to add components to this deployment.
          </p>
          <Link href="/marketplace">
            <Button variant="outline" size="sm">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Browse Marketplace
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

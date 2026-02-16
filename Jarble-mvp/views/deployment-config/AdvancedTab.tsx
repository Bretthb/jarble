import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { StorageMeter, StorageMeterSkeleton } from "@/components/StorageMeter";
import type { TabProps } from "./types";

interface AdvancedTabProps extends TabProps {
  deployment: {
    id?: string;
    status?: string;
    runtime?: string;
    createdAt?: string | Date;
    updatedAt?: string | Date;
    cpuLimit?: string;
    memoryMb?: number;
    storageMb?: number;
  } | null | undefined;
}

export function AdvancedTab({ deployment }: AdvancedTabProps) {
  // Query storage usage (only for running deployments)
  const isRunning = deployment?.status === "running";
  const storageQuery = trpc.deployment.getStorageUsage.useQuery(
    { id: deployment?.id || "" },
    {
      enabled: !!deployment?.id && isRunning,
      refetchInterval: 30_000,
      staleTime: 15_000,
    }
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Advanced Settings</h2>
        <p className="text-muted-foreground text-sm">Additional configuration options</p>
      </div>

      <div className="space-y-5">
        <div className="p-5 rounded-lg bg-secondary/30 border border-border/60">
          <h3 className="font-semibold mb-3">Deployment Information</h3>
          <div className="divide-y divide-border/40 text-sm">
            <div className="flex justify-between py-2.5 first:pt-0">
              <span className="text-muted-foreground">Deployment ID</span>
              <span className="font-mono">{deployment?.id}</span>
            </div>
            <div className="flex justify-between py-2.5">
              <span className="text-muted-foreground">Status</span>
              <span className={deployment?.status === "running" ? "text-primary" : "text-muted-foreground"}>
                {deployment?.status}
              </span>
            </div>
            <div className="flex justify-between py-2.5">
              <span className="text-muted-foreground">Runtime</span>
              <span>{deployment?.runtime || "openclaw"}</span>
            </div>
            <div className="flex justify-between py-2.5">
              <span className="text-muted-foreground">Created</span>
              <span>{deployment?.createdAt ? new Date(deployment.createdAt).toLocaleDateString() : "N/A"}</span>
            </div>
            <div className="flex justify-between py-2.5 last:pb-0">
              <span className="text-muted-foreground">Last Updated</span>
              <span>{deployment?.updatedAt ? new Date(deployment.updatedAt).toLocaleDateString() : "N/A"}</span>
            </div>
          </div>
        </div>

        {/* Resource Usage */}
        <div className="p-5 rounded-lg bg-secondary/30 border border-border/60">
          <h3 className="font-semibold mb-3">Resources</h3>
          <div className="space-y-4">
            {/* Hardware Specs */}
            <div className="flex flex-wrap gap-3 text-sm">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary/60 border border-border/40">
                <span className="text-muted-foreground">CPU</span>
                <span className="font-mono font-medium">{deployment?.cpuLimit || "2.0"} vCPU</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary/60 border border-border/40">
                <span className="text-muted-foreground">Memory</span>
                <span className="font-mono font-medium">{deployment?.memoryMb || 2048} MB</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary/60 border border-border/40">
                <span className="text-muted-foreground">Storage</span>
                <span className="font-mono font-medium">{deployment?.storageMb || 30} GB</span>
              </div>
            </div>

            {/* Storage Usage Meter */}
            {isRunning ? (
              storageQuery.isLoading ? (
                <StorageMeterSkeleton />
              ) : storageQuery.data?.usedGb != null ? (
                <StorageMeter
                  usedGb={storageQuery.data.usedGb}
                  totalGb={storageQuery.data.totalGb}
                  percentUsed={storageQuery.data.percentUsed}
                />
              ) : (
                <p className="text-xs text-muted-foreground">Storage metrics unavailable</p>
              )
            ) : (
              <p className="text-xs text-muted-foreground">Storage metrics available when deployment is running</p>
            )}
          </div>
        </div>

        <div className="p-5 rounded-lg bg-secondary/30 border border-border/60">
          <h3 className="font-semibold mb-2">Webhooks</h3>
          <p className="text-sm text-muted-foreground mb-4">Receive notifications about deployment events</p>
          <div>
            <Label htmlFor="webhookUrl" className="mb-2 block text-sm">Webhook URL</Label>
            <Input
              id="webhookUrl"
              type="url"
              placeholder="https://your-server.com/webhook"
              className="bg-secondary/50 border-border text-foreground"
            />
          </div>
        </div>

        <div className="p-5 rounded-lg bg-secondary/30 border border-border">
          <h3 className="font-semibold text-foreground mb-2">Danger Zone</h3>
          <p className="text-sm text-muted-foreground mb-4">
            These actions are irreversible. Please be certain.
          </p>
          <div className="flex gap-3">
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-secondary/80">
              Reset Deployment Data
            </Button>
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-secondary/80">
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Deployment
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

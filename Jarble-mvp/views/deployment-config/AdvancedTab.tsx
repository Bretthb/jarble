import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2 } from "lucide-react";
import type { TabProps } from "./types";

interface AdvancedTabProps extends TabProps {
  deployment: { id?: string; status?: string; runtime?: string; createdAt?: string | Date; updatedAt?: string | Date } | null | undefined;
}

export function AdvancedTab({ deployment }: AdvancedTabProps) {
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

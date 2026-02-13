import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2 } from "lucide-react";
import type { TabProps } from "./types";

interface AdvancedTabProps extends TabProps {
  bot: { id?: string; status?: string; createdAt?: string | Date; updatedAt?: string | Date } | null | undefined;
}

export function AdvancedTab({ bot }: AdvancedTabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Advanced Settings</h2>
        <p className="text-muted-foreground text-sm">Additional configuration options</p>
      </div>

      <div className="space-y-4">
        <div className="p-4 rounded-lg bg-secondary/80/50 border border-border">
          <h3 className="font-semibold mb-2">Bot Information</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bot ID</span>
              <span className="font-mono">{bot?.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className={bot?.status === "running" ? "text-green-600" : "text-muted-foreground"}>
                {bot?.status}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span>{bot?.createdAt ? new Date(bot.createdAt).toLocaleDateString() : "N/A"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last Updated</span>
              <span>{bot?.updatedAt ? new Date(bot.updatedAt).toLocaleDateString() : "N/A"}</span>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-secondary/80/50 border border-border">
          <h3 className="font-semibold mb-2">Rate Limiting</h3>
          <p className="text-sm text-muted-foreground mb-4">Control how often users can interact with your bot</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="rateLimit" className="mb-2 block text-sm">Messages per minute</Label>
              <Input
                id="rateLimit"
                type="number"
                defaultValue={60}
                className="bg-secondary border-border text-foreground"
              />
            </div>
            <div>
              <Label htmlFor="cooldown" className="mb-2 block text-sm">Cooldown (seconds)</Label>
              <Input
                id="cooldown"
                type="number"
                defaultValue={1}
                className="bg-secondary border-border text-foreground"
              />
            </div>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-secondary/80/50 border border-border">
          <h3 className="font-semibold mb-2">Webhooks</h3>
          <p className="text-sm text-muted-foreground mb-4">Receive notifications about bot events</p>
          <div>
            <Label htmlFor="webhookUrl" className="mb-2 block text-sm">Webhook URL</Label>
            <Input
              id="webhookUrl"
              type="url"
              placeholder="https://your-server.com/webhook"
              className="bg-secondary border-border text-foreground"
            />
          </div>
        </div>

        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
          <h3 className="font-semibold text-red-400 mb-2">Danger Zone</h3>
          <p className="text-sm text-muted-foreground mb-4">
            These actions are irreversible. Please be certain.
          </p>
          <div className="flex gap-3">
            <Button variant="outline" className="border-red-500/50 text-red-400 hover:bg-red-500/10">
              Reset Bot Data
            </Button>
            <Button variant="outline" className="border-red-500/50 text-red-400 hover:bg-red-500/10">
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Bot
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

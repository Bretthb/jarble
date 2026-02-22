"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, RotateCw, Play, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { vanillaClient } from "@/lib/trpc-vanilla";

interface ConfirmActionProps {
  action: "restart" | "stop" | "delete" | "start";
  deploymentName: string;
  deploymentId: string;
}

const ACTION_CONFIG = {
  restart: {
    icon: RotateCw,
    label: "Restart",
    description: "This will scale the pod down and back up. Active sessions may be interrupted.",
    variant: "default" as const,
  },
  stop: {
    icon: Square,
    label: "Stop",
    description: "This will scale the pod to 0. The bot will be offline until started again.",
    variant: "default" as const,
  },
  start: {
    icon: Play,
    label: "Start",
    description: "This will start the deployment and bring the bot online.",
    variant: "default" as const,
  },
  delete: {
    icon: Trash2,
    label: "Delete",
    description: "This will permanently delete the deployment and all its resources. This cannot be undone.",
    variant: "destructive" as const,
  },
};

export default function ConfirmAction({
  action,
  deploymentName,
  deploymentId,
}: ConfirmActionProps) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const config = ACTION_CONFIG[action as keyof typeof ACTION_CONFIG];
  if (!config) {
    return (
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
        Unknown action: {action}
      </div>
    );
  }
  const Icon = config.icon;

  const handleConfirm = async () => {
    setIsExecuting(true);
    try {
      switch (action) {
        case "restart":
          await vanillaClient.deployment.restart.mutate({ id: deploymentId });
          break;
        case "stop":
          await vanillaClient.deployment.stop.mutate({ id: deploymentId });
          break;
        case "start":
          await vanillaClient.deployment.start.mutate({ id: deploymentId });
          break;
        case "delete":
          await vanillaClient.deployment.delete.mutate({ id: deploymentId });
          break;
      }
      toast.success(`${config.label} successful!`);
      setIsDone(true);
    } catch {
      toast.error(`Failed to ${action} deployment`);
    } finally {
      setIsExecuting(false);
    }
  };

  if (isDone) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-center">
        <p className="text-sm text-muted-foreground">
          {action === "delete"
            ? `${deploymentName} has been deleted.`
            : `${config.label} initiated for ${deploymentName}.`}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          action === "delete" ? "bg-red-500/10" : "bg-primary/10"
        }`}>
          <Icon className={`w-5 h-5 ${
            action === "delete" ? "text-red-500" : "text-primary"
          }`} />
        </div>
        <div>
          <h4 className="text-sm font-semibold">
            {config.label} {deploymentName}?
          </h4>
          <p className="text-xs text-muted-foreground mt-1">
            {config.description}
          </p>
        </div>
      </div>

      {action === "delete" && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-xs text-red-500">
            This action is irreversible. All data will be lost.
          </p>
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <Button
          variant={config.variant}
          size="sm"
          onClick={handleConfirm}
          disabled={isExecuting}
          className="h-8"
        >
          {isExecuting && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
          {config.label}
        </Button>
      </div>
    </div>
  );
}

"use client";

/**
 * ConfigPanel -- slide-out left sidebar for deployment configuration.
 *
 * Direct tRPC-based config panel (no Tambo dependency).
 * Provides quick actions for common configuration tasks.
 */

import { memo, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  X,
  Loader2,
  Sparkles,
  Cpu,
  Send as SendIcon,
  FileText,
  ScrollText,
  RefreshCw,
  Square,
  Play,
  MessageSquare,
} from "lucide-react";

// ── ConfigPanel (outer shell) ───────────────────────────────────────────────

interface ConfigPanelProps {
  deploymentId: string;
  onClose: () => void;
}

function ConfigPanelInner({ deploymentId, onClose }: ConfigPanelProps) {
  return (
    <div className="h-full w-[360px] shrink-0 border-r border-border/60 bg-background flex flex-col relative">
      {/* Left accent line */}
      <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-primary/40 via-primary/20 to-transparent" />

      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary/70" />
          <div>
            <span className="text-sm font-semibold text-foreground">Configuration</span>
            <p className="text-[10px] text-muted-foreground leading-tight">Quick actions</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 w-8 p-0 rounded-md hover:bg-secondary/80 transition-colors"
          aria-label="Close config panel"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Config actions */}
      <ConfigActions deploymentId={deploymentId} />
    </div>
  );
}

export default memo(ConfigPanelInner);

// ── Config Actions ──────────────────────────────────────────────────────────

function ConfigActions({ deploymentId }: { deploymentId: string }) {
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const deploymentQuery = trpc.deployment.getById.useQuery({ id: deploymentId });
  const restartMutation = trpc.deployment.restart.useMutation({
    onSuccess: () => setFeedback({ type: "success", message: "Restart initiated" }),
    onError: (err) => setFeedback({ type: "error", message: err.message }),
  });
  const stopMutation = trpc.deployment.stop.useMutation({
    onSuccess: () => setFeedback({ type: "success", message: "Stop initiated" }),
    onError: (err) => setFeedback({ type: "error", message: err.message }),
  });
  const startMutation = trpc.deployment.start.useMutation({
    onSuccess: () => setFeedback({ type: "success", message: "Start initiated" }),
    onError: (err) => setFeedback({ type: "error", message: err.message }),
  });

  const isBusy = restartMutation.isPending || stopMutation.isPending || startMutation.isPending;
  const deployment = deploymentQuery.data;

  const clearFeedback = useCallback(() => setFeedback(null), []);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-4 space-y-4">
        {/* Deployment info */}
        {deployment && (
          <div className="rounded-lg border border-border/40 bg-secondary/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">Status</span>
              <span className="text-xs text-muted-foreground capitalize">{deployment.status}</span>
            </div>
            {deployment.llmProvider && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">LLM Provider</span>
                <span className="text-xs text-muted-foreground">{deployment.llmProvider}</span>
              </div>
            )}
            {deployment.llmModel && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">Model</span>
                <span className="text-xs text-muted-foreground font-mono text-[10px]">{deployment.llmModel}</span>
              </div>
            )}
          </div>
        )}

        {/* Lifecycle actions */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Lifecycle</span>
          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { clearFeedback(); startMutation.mutate({ id: deploymentId }); }}
              disabled={isBusy}
              className="h-9 text-xs gap-1.5"
            >
              {startMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              Start
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { clearFeedback(); restartMutation.mutate({ id: deploymentId }); }}
              disabled={isBusy}
              className="h-9 text-xs gap-1.5"
            >
              {restartMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Restart
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { clearFeedback(); stopMutation.mutate({ id: deploymentId }); }}
              disabled={isBusy}
              className="h-9 text-xs gap-1.5"
            >
              {stopMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
              Stop
            </Button>
          </div>
        </div>

        {/* Quick navigation hints */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Configuration</span>
          <div className="space-y-1">
            {[
              { icon: FileText, label: "Edit system prompt", hint: "Update your bot's personality and instructions" },
              { icon: Cpu, label: "Change LLM model", hint: "Switch provider or model" },
              { icon: SendIcon, label: "Connect platforms", hint: "Telegram, Discord, Slack, WhatsApp" },
              { icon: ScrollText, label: "View logs", hint: "Debug pod issues" },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-start gap-2.5 px-2.5 py-2 rounded-md bg-secondary/20 border border-border/30"
              >
                <item.icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-foreground">{item.label}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">{item.hint}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Empty state guidance */}
        <div className="flex flex-col items-center text-center px-2 pt-4 pb-2 space-y-3">
          <div className="w-10 h-10 rounded-full bg-secondary/60 flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-muted-foreground/70" />
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-[260px]">
            Use the deployment settings page for full configuration options including
            system prompt editing, platform connections, and LLM settings.
          </p>
        </div>

        {/* Feedback display */}
        {feedback && (
          <div
            className={`rounded-lg border px-3 py-2 text-xs ${
              feedback.type === "success"
                ? "border-green-500/30 bg-green-500/10 text-green-400"
                : "border-red-500/30 bg-red-500/10 text-red-400"
            }`}
          >
            {feedback.message}
          </div>
        )}
      </div>
    </div>
  );
}

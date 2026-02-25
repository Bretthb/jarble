"use client";

/**
 * EssentialControls — compact toolbar for deployment lifecycle actions.
 * Works WITHOUT Tambo — direct tRPC mutations.
 *
 * Visual polish:
 * - Status-aware button tints (green/start, red/stop, amber/restart)
 * - Radix tooltips on every action
 * - Subtle dividers between groups
 * - Spinner animations on loading states
 * - API key shown as a small key icon, expands inline on click
 */

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  RotateCcw,
  Play,
  Square,
  Key,
  Loader2,
  X,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface EssentialControlsProps {
  deploymentId: string;
  status: string;
}

export default function EssentialControls({
  deploymentId,
  status,
}: EssentialControlsProps) {
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);

  const restartMutation = trpc.deployment.restart.useMutation();
  const startMutation = trpc.deployment.start.useMutation();
  const stopMutation = trpc.deployment.stop.useMutation();
  const updateMutation = trpc.deployment.update.useMutation();

  const isTransitioning = [
    "creating",
    "restarting",
    "reloading",
    "stopping",
  ].includes(status);
  const isRunning = status === "running";
  const isStopped = status === "stopped";
  const isBusy =
    restartMutation.isPending ||
    startMutation.isPending ||
    stopMutation.isPending;

  const handleRestart = useCallback(() => {
    restartMutation.mutate({ id: deploymentId });
  }, [deploymentId, restartMutation]);

  const handleStartStop = useCallback(() => {
    if (isRunning) {
      stopMutation.mutate({ id: deploymentId });
    } else if (isStopped) {
      startMutation.mutate({ id: deploymentId });
    }
  }, [deploymentId, isRunning, isStopped, startMutation, stopMutation]);

  const handleApiKeySave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setApiKeySaving(true);
    try {
      await updateMutation.mutateAsync({
        id: deploymentId,
        llmApiKey: apiKey,
      });
      setApiKey("");
      setShowApiKeyInput(false);
    } finally {
      setApiKeySaving(false);
    }
  }, [apiKey, deploymentId, updateMutation]);

  return (
    <div className="flex items-center gap-0.5">
      {/* ── Lifecycle controls ── */}
      <div className="flex items-center gap-0.5 rounded-md bg-secondary/30 p-0.5">
        {/* Start / Stop toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleStartStop}
              disabled={isBusy || isTransitioning || (!isRunning && !isStopped)}
              className={cn(
                "h-7 w-7 p-0 rounded-md transition-colors",
                isRunning &&
                  "text-red-400 hover:text-red-300 hover:bg-red-500/10",
                isStopped &&
                  "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
              )}
            >
              {startMutation.isPending || stopMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : isRunning ? (
                <Square className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {isRunning ? "Stop deployment" : "Start deployment"}
          </TooltipContent>
        </Tooltip>

        {/* Restart */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRestart}
              disabled={isBusy || isTransitioning}
              className="h-7 w-7 p-0 rounded-md text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
            >
              {restartMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Restart deployment
          </TooltipContent>
        </Tooltip>
      </div>

      {/* ── Thin vertical divider ── */}
      <div className="mx-1 h-4 w-px bg-border/50" />

      {/* ── API Key ── */}
      {showApiKeyInput ? (
        <div className="flex items-center gap-1 rounded-md bg-secondary/30 p-0.5">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="New API key..."
            className="h-7 w-40 rounded-md border border-border/60 bg-background/60 px-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40 focus:border-amber-500/40 transition-colors"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleApiKeySave();
              if (e.key === "Escape") {
                setShowApiKeyInput(false);
                setApiKey("");
              }
            }}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleApiKeySave}
                disabled={!apiKey.trim() || apiKeySaving}
                className="h-7 w-7 p-0 rounded-md text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
              >
                {apiKeySaving ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Save API key
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowApiKeyInput(false);
                  setApiKey("");
                }}
                className="h-7 w-7 p-0 rounded-md text-stone-400 hover:text-stone-300 hover:bg-stone-500/10 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Cancel
            </TooltipContent>
          </Tooltip>
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowApiKeyInput(true)}
              className="h-7 w-7 p-0 rounded-md text-stone-400 hover:text-stone-300 hover:bg-stone-500/10 transition-colors"
            >
              <Key className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Change API key
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

"use client";

/**
 * EssentialControls — compact toolbar for deployment lifecycle actions.
 * Works WITHOUT Tambo — direct tRPC mutations.
 */

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  RotateCcw,
  Play,
  Square,
  Key,
  Loader2,
  X,
  Check,
} from "lucide-react";

interface EssentialControlsProps {
  deploymentId: string;
  status: string;
}

export default function EssentialControls({ deploymentId, status }: EssentialControlsProps) {
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);

  const restartMutation = trpc.deployment.restart.useMutation();
  const startMutation = trpc.deployment.start.useMutation();
  const stopMutation = trpc.deployment.stop.useMutation();
  const updateMutation = trpc.deployment.update.useMutation();

  const isTransitioning = ["creating", "restarting", "reloading", "stopping"].includes(status);
  const isRunning = status === "running";
  const isStopped = status === "stopped";
  const isBusy = restartMutation.isPending || startMutation.isPending || stopMutation.isPending;

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
      await updateMutation.mutateAsync({ id: deploymentId, llmApiKey: apiKey });
      setApiKey("");
      setShowApiKeyInput(false);
    } finally {
      setApiKeySaving(false);
    }
  }, [apiKey, deploymentId, updateMutation]);

  return (
    <div className="flex items-center gap-1">
      {/* Restart */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleRestart}
        disabled={isBusy || isTransitioning}
        className="h-7 w-7 p-0"
        title="Restart"
      >
        {restartMutation.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <RotateCcw className="w-3.5 h-3.5" />
        )}
      </Button>

      {/* Start / Stop toggle */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleStartStop}
        disabled={isBusy || isTransitioning || (!isRunning && !isStopped)}
        className="h-7 w-7 p-0"
        title={isRunning ? "Stop" : "Start"}
      >
        {(startMutation.isPending || stopMutation.isPending) ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : isRunning ? (
          <Square className="w-3.5 h-3.5" />
        ) : (
          <Play className="w-3.5 h-3.5" />
        )}
      </Button>

      {/* API Key */}
      {showApiKeyInput ? (
        <div className="flex items-center gap-1 ml-1">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="New API key..."
            className="h-7 w-40 rounded border border-border bg-secondary/50 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleApiKeySave();
              if (e.key === "Escape") setShowApiKeyInput(false);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleApiKeySave}
            disabled={!apiKey.trim() || apiKeySaving}
            className="h-7 w-7 p-0"
          >
            {apiKeySaving ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Check className="w-3 h-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setShowApiKeyInput(false); setApiKey(""); }}
            className="h-7 w-7 p-0"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowApiKeyInput(true)}
          className="h-7 w-7 p-0"
          title="Change API Key"
        >
          <Key className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}

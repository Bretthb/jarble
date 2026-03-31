"use client";

/**
 * ConfigPanel -- slide-out left sidebar for deployment configuration.
 *
 * Tabbed panel with Config (lifecycle buttons, model selector, system prompt) and Terminal (xterm.js shell).
 */

import { memo, useState, useCallback, useRef, lazy, Suspense } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { getModelsForProvider } from "@/views/onboarding/wizardStepConfig";
import {
  X,
  Loader2,
  Sparkles,
  RefreshCw,
  Square,
  Play,
  TerminalSquare,
  Settings2,
  Save,
} from "lucide-react";

const TerminalPanel = lazy(() => import("./TerminalPanel"));

// ── ConfigPanel (outer shell) ───────────────────────────────────────────────

interface ConfigPanelProps {
  deploymentId: string;
  liveStatus: string;
  onClose: () => void;
}

function ConfigPanelInner({ deploymentId, liveStatus, onClose }: ConfigPanelProps) {
  const [activeTab, setActiveTab] = useState("config");
  const isRunning = liveStatus === "running";

  return (
    <div
      className="h-full shrink-0 border-r border-border/60 bg-background flex flex-col relative transition-[width] duration-200 overflow-hidden"
      style={{ width: activeTab === "terminal" ? 640 : 360 }}
    >
      {/* Left accent line */}
      <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-primary/40 via-primary/20 to-transparent" />

      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary/70" />
          <div>
            <span className="text-sm font-semibold text-foreground">Configuration</span>
            <p className="text-[10px] text-muted-foreground leading-tight">Quick actions & OpenClaw CLI</p>
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

      {/* Tabbed content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="px-4 pt-2">
          <TabsList className="w-full">
            <TabsTrigger value="config" className="flex-1 gap-1.5">
              <Settings2 className="w-3.5 h-3.5" />
              Config
            </TabsTrigger>
            <TabsTrigger
              value="terminal"
              className="flex-1 gap-1.5"
              disabled={!isRunning}
              title={!isRunning ? "OpenClaw CLI requires a running deployment" : undefined}
            >
              <TerminalSquare className="w-3.5 h-3.5" />
              OpenClaw CLI
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="config" className="flex-1 overflow-y-auto">
          <ConfigActions deploymentId={deploymentId} />
        </TabsContent>

        <TabsContent value="terminal" className="flex-1 min-h-0 overflow-hidden">
          {isRunning && activeTab === "terminal" && (
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              }
            >
              <TerminalPanel deploymentId={deploymentId} />
            </Suspense>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default memo(ConfigPanelInner);

// ── Config Actions ──────────────────────────────────────────────────────────

function ConfigActions({ deploymentId }: { deploymentId: string }) {
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [editProvider, setEditProvider] = useState<string | null>(null);
  const [editModel, setEditModel] = useState<string | null>(null);
  const [customModelMode, setCustomModelMode] = useState(false);
  const [editPrompt, setEditPrompt] = useState<string | null>(null);

  const deploymentQuery = trpc.deployment.getById.useQuery({ id: deploymentId });
  const restartMutation = trpc.deployment.restart.useMutation({
    onSuccess: () => {
      setFeedback({ type: "success", message: "Restart initiated" });
      deploymentQuery.refetch();
    },
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
  // Ref (not state) so the onSuccess callback always reads the latest value
  const pendingRestartRef = useRef(false);

  const updateMutation = trpc.deployment.update.useMutation({
    onSuccess: () => {
      toast.success("Configuration saved");
      const shouldRestart = pendingRestartRef.current;
      pendingRestartRef.current = false;
      setEditProvider(null);
      setEditModel(null);
      setCustomModelMode(false);
      setEditPrompt(null);
      deploymentQuery.refetch();
      podConfigQuery.refetch();
      // Model/provider changes need a pod restart since OpenClaw reads config at startup
      if (shouldRestart) {
        restartMutation.mutate({ id: deploymentId });
      }
    },
    onError: (err) => toast.error(err.message || "Failed to save"),
  });

  // Introspect the pod's actual config
  const podConfigQuery = trpc.deployment.getPodConfig.useQuery(
    { id: deploymentId },
    { staleTime: 30_000, refetchInterval: 60_000 }
  );

  const isBusy = restartMutation.isPending || stopMutation.isPending || startMutation.isPending;
  const deployment = deploymentQuery.data;
  const dep = deployment as any;
  const podConfig = podConfigQuery.data;

  const clearFeedback = useCallback(() => setFeedback(null), []);

  // Get suggested models for the active provider (not exhaustive - user can type any model ID)
  const activeProvider = editProvider ?? dep?.llmProvider ?? "anthropic";
  const suggestedModels = getModelsForProvider(activeProvider);

  const handleSaveModel = () => {
    const updates: Record<string, string> = { id: deploymentId };
    if (editProvider && editProvider !== dep?.llmProvider) {
      updates.llmProvider = editProvider;
    }
    if (editModel && editModel !== dep?.llmModel) {
      updates.llmModel = editModel;
    }
    if (Object.keys(updates).length <= 1) return; // only has "id"
    // Model/provider changes need a pod restart to take effect
    pendingRestartRef.current = true;
    updateMutation.mutate(updates as any);
  };

  const handleSavePrompt = () => {
    if (editPrompt === null) return;
    updateMutation.mutate({ id: deploymentId, systemPrompt: editPrompt });
  };

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
            {dep?.llmProvider && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">Provider</span>
                <span className="text-xs text-muted-foreground">{dep.llmProvider}</span>
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

        {/* Provider + Model selector */}
        {deployment && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Provider</span>
            <select
              value={activeProvider}
              onChange={(e) => {
                setEditProvider(e.target.value);
                // Reset model when provider changes so they pick a new one
                setEditModel(null);
                setCustomModelMode(false);
              }}
              className="w-full px-2.5 py-1.5 bg-secondary/50 border border-border rounded-md text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="google">Google</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </div>
        )}
        {deployment && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Model</span>
            <div className="space-y-2">
              {!customModelMode ? (
                <>
                  <select
                    value={
                      (editModel ?? dep?.llmModel ?? "") &&
                      suggestedModels.some((m) => m.id === (editModel ?? dep?.llmModel))
                        ? (editModel ?? dep?.llmModel ?? "")
                        : "__current__"
                    }
                    onChange={(e) => {
                      if (e.target.value === "__custom__") {
                        setCustomModelMode(true);
                        setEditModel("");
                      } else if (e.target.value === "__current__") {
                        // noop - they re-selected the already-active unlisted model
                      } else {
                        setEditModel(e.target.value);
                      }
                    }}
                    className="w-full px-2.5 py-1.5 bg-secondary/50 border border-border rounded-md text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {/* Show current model if it's not in the suggestions list */}
                    {dep?.llmModel && !suggestedModels.some((m) => m.id === dep.llmModel) && (
                      <option value="__current__">{dep.llmModel} (current)</option>
                    )}
                    {suggestedModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                    <option value="__custom__">Custom model ID...</option>
                  </select>
                </>
              ) : (
                <div className="space-y-1.5">
                  <input
                    value={editModel ?? ""}
                    onChange={(e) => setEditModel(e.target.value)}
                    placeholder="e.g. claude-opus-4-6-20250610"
                    autoFocus
                    className="w-full px-2.5 py-1.5 bg-secondary/50 border border-border rounded-md text-foreground text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    onClick={() => { setCustomModelMode(false); setEditModel(null); }}
                    className="text-[10px] text-primary hover:underline"
                  >
                    Back to dropdown
                  </button>
                </div>
              )}
              {/* Pod config indicator */}
              {podConfig?.status === "live" && podConfig.model ? (
                podConfig.model !== dep?.llmModel ? (
                  <p className="text-[10px] text-amber-500">
                    Pod running <span className="font-mono">{podConfig.model}</span>
                    <span className="text-muted-foreground"> - DB: {dep?.llmModel}</span>
                  </p>
                ) : (
                  <p className="text-[10px] text-green-500">
                    Live: <span className="font-mono">{podConfig.model}</span>
                  </p>
                )
              ) : null}
              {((editModel && editModel !== dep?.llmModel && editModel !== "") ||
                (editProvider && editProvider !== dep?.llmProvider)) && (
                <Button
                  size="sm"
                  onClick={handleSaveModel}
                  disabled={updateMutation.isPending}
                  className="w-full h-8 text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Save className="w-3 h-3" />
                  )}
                  Save Changes
                </Button>
              )}
            </div>
          </div>
        )}

        {/* System prompt editor */}
        {deployment && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">System Prompt</span>
            <textarea
              value={editPrompt ?? dep?.systemPrompt ?? ""}
              onChange={(e) => setEditPrompt(e.target.value)}
              rows={5}
              className="w-full px-2.5 py-2 bg-secondary/50 border border-border rounded-md text-foreground text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-primary leading-relaxed"
              placeholder="You are a helpful assistant..."
            />
            {editPrompt !== null && editPrompt !== (dep?.systemPrompt ?? "") && (
              <Button
                size="sm"
                onClick={handleSavePrompt}
                disabled={updateMutation.isPending}
                className="w-full h-8 text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                Save Prompt
              </Button>
            )}
          </div>
        )}

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

"use client";

import { useParams, useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { StatusBadge } from "@/components/StatusBadge";
import { useStatusStream } from "@/hooks/useStatusStream";
import { ComponentCatalogProvider } from "@/components/ComponentCatalogProvider";
import DeploymentTamboProvider from "@/components/DeploymentTamboProvider";
import { useCanvasChat } from "@/hooks/useCanvasChat";
import { useOrchestration } from "@/hooks/useOrchestration";
import { useJarbleRuntime } from "@/lib/assistantRuntime";
import AssistantUIChat from "@/components/chat/AssistantUIChat";
import { SlashCommandMenu, getFilteredCommandCount } from "@/components/chat/SlashCommandMenu";
import { useCanvasPersistence } from "@/hooks/useCanvasPersistence";
import { saveComponentState } from "@/lib/componentState";
import { useArtifactSync } from "@/hooks/useArtifactSync";
import { canvasReducer, INITIAL_CANVAS_STATE } from "@/components/workspace/canvasReducer";
import SimpleCanvasGrid from "@/components/workspace/SimpleCanvasGrid";
import DashboardCanvas from "@/components/workspace/DashboardCanvas";
import EssentialControls from "@/components/workspace/EssentialControls";
import FilePanel from "@/components/workspace/FilePanel";
import KnowledgePanel from "@/components/workspace/KnowledgePanel";
import CanvasRenderer from "@/components/canvas/CanvasRenderer";
import EditableCanvas from "@/components/canvas/EditableCanvas";
import type { CanvasAction } from "@/components/canvas/CanvasActionContext";
import { Button } from "@/components/ui/button";
import ConversationHistoryPanel from "@/components/workspace/ConversationHistoryPanel";
import SubagentsPanel from "@/components/workspace/SubagentsPanel";
import TeamMembershipsPanel from "@/components/workspace/TeamMembershipsPanel";
import TeamSessionsPanel from "@/components/workspace/TeamSessionsPanel";
import DebugTracePanel from "@/components/workspace/DebugTracePanel";
import { MemoryDisclosureBanner, type MemoryScope } from "@/components/chat/MemoryDisclosureBanner";
import { CreditStatusBanner } from "@/components/chat/CreditStatusBanner";
import { ArrowLeft, Loader2, SendHorizontal, Square, Store, FolderOpen, MessageSquare, MessageSquareText, Layout, X, Brain, Bot, Users, Activity, ArrowUpRight } from "lucide-react";
import { useReducer, useRef, useState, useCallback, useEffect, useMemo, memo } from "react";
import { cn } from "@/lib/utils";
import { THEME_PRESETS, resolveThemeVars } from "@jarble/component-manifest";
import type { ThemeConfig } from "@jarble/component-manifest";
import { SandboxThemeProvider } from "@/components/canvas/SandboxThemeContext";
import "./chat-skins.css";
import { Skeleton } from "@/components/ui/skeleton";
import ProfileDropdown from "@/components/ProfileDropdown";
import ChatErrorCard from "@/components/workspace/ChatErrorCard";
import PageFullscreenOverlay from "@/components/workspace/PageFullscreenOverlay";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a friendly, concise display message for a UI action relay */
function formatActionDisplay(action: CanvasAction): string {
  const { component, action: actionType, payload } = action;
  const p = payload as Record<string, unknown>;

  switch (actionType) {
    case "click":
      if (component === "button_group") {
        const label = (p.label as string) || (p.buttonId as string) || "";
        return label ? `Clicked '${label}'` : "Clicked a button";
      }
      return `Clicked ${component.replace(/_/g, " ")} element`;

    case "row_click":
      return "Selected a row in table";

    case "submit":
      return "Submitted form";

    case "tab_change": {
      const tab = (p.value as string) || (p.label as string) || "";
      return tab ? `Switched to tab '${tab}'` : "Switched tab";
    }

    case "item_click": {
      const text = (p.text as string) || (p.label as string) || "";
      return text ? `Selected '${text}'` : "Selected an item";
    }

    case "stat_click": {
      const label = (p.label as string) || "";
      return label ? `Clicked '${label}'` : "Clicked a statistic";
    }

    case "point_click":
    case "slice_click":
    case "bar_click":
    case "node_click":
      return "Clicked chart element";

    case "page_change":
      return `Navigated to page ${p.page ?? ""}`.trim();

    case "sort_change":
      return "Changed sort order";

    case "selection_change":
      return "Updated selection";

    case "sandbox_action": {
      const act = (p.action as string) || "";
      return act ? `Sandbox: ${act}` : "Interacted with sandbox";
    }

    default:
      return `Interacted with ${component.replace(/_/g, " ")}`;
  }
}

// ── Subagents Badge Button ───────────────────────────────────────────────────

function SubagentsBadgeButton({ deploymentId, isOpen, onClick }: { deploymentId: string; isOpen: boolean; onClick: () => void }) {
  const listQuery = trpc.subagents.list.useQuery({ deploymentId }, {
    staleTime: 30_000,
  });
  const count = listQuery.data?.length ?? 0;

  return (
    <Button
      variant={isOpen ? "secondary" : "ghost"}
      size="sm"
      onClick={onClick}
      className={cn("h-8 p-0 gap-1 shrink-0 hidden sm:flex", count > 0 ? "px-2" : "w-8")}
      title="Subagents"
      aria-label={count > 0 ? `Subagents (${count})` : "Subagents"}
    >
      <Bot className="w-4 h-4" />
      {count > 0 && (
        <span className="text-xs font-medium tabular-nums">
          {count}
        </span>
      )}
    </Button>
  );
}

// ── Team Memberships Badge Button ────────────────────────────────────────────
//
// Shows how many teams this deployment is on. Closes the
// "Per-deployment team membership visibility" gap from
// docs/audits/fractal-vision-gap-audit.md — until this landed there
// was no way from the /d/[id] page to know whether the deployment was
// on any teams or who its teammates were.
function TeamsBadgeButton({ deploymentId, isOpen, onClick }: { deploymentId: string; isOpen: boolean; onClick: () => void }) {
  const listQuery = trpc.flows.listForDeployment.useQuery({ deploymentId }, {
    staleTime: 30_000,
  });
  const count = listQuery.data?.length ?? 0;

  return (
    <Button
      variant={isOpen ? "secondary" : "ghost"}
      size="sm"
      onClick={onClick}
      className={cn("h-8 p-0 gap-1 shrink-0 hidden sm:flex", count > 0 ? "px-2" : "w-8")}
      title="Team Memberships"
      aria-label={count > 0 ? `Teams (${count})` : "Teams"}
      type="button"
    >
      <Users className="w-4 h-4" />
      {count > 0 && (
        <span className="text-xs font-medium tabular-nums">
          {count}
        </span>
      )}
    </Button>
  );
}

// ── Example prompts for empty state ──────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  "What can you do?",
  "Show me a chart of something interesting",
  "Create an interactive 3D visualization",
];

/** Parse themeConfig JSON and resolve to inline CSS variables */
function useDeploymentTheme(themeConfigJson: string | null | undefined): React.CSSProperties {
  return useMemo(() => {
    if (!themeConfigJson) return {};
    try {
      const config: ThemeConfig = JSON.parse(themeConfigJson);
      return resolveThemeVars(config) as React.CSSProperties;
    } catch {
      return {};
    }
  }, [themeConfigJson]);
}

export default function DeploymentChatPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth0();

  // Auth redirect - must be before any early returns (hooks can't be after conditionals)
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  const deploymentQuery = trpc.deployment.getById.useQuery(
    { id },
    { enabled: isAuthenticated && !authLoading }
  );

  const { getStatus: getLiveStatus } = useStatusStream({
    enabled: isAuthenticated && !authLoading,
  });

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // redirect is handled by the useEffect above
  }

  if (deploymentQuery.isLoading) {
    return (
      <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
        {/* Header skeleton */}
        <header className="border-b border-border/60 bg-background/95 shrink-0">
          <div className="px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
          </div>
        </header>
        {/* Content skeleton */}
        <div className="flex-1 flex overflow-hidden">
          {/* Chat panel skeleton */}
          <div className="w-full md:w-[400px] flex flex-col border-r border-border/40">
            <div className="flex-1 p-4 space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={cn("flex gap-2", i % 2 === 0 ? "" : "justify-end")}>
                  <Skeleton className={cn("h-16 rounded-lg", i % 2 === 0 ? "w-3/4" : "w-1/2")} />
                </div>
              ))}
            </div>
            <div className="border-t border-border/60 p-4">
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          </div>
          {/* Canvas skeleton (hidden on mobile) */}
          <div className="hidden md:block flex-1 bg-secondary/10 p-6">
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-40 rounded-lg" />
              <Skeleton className="h-40 rounded-lg" />
              <Skeleton className="h-56 rounded-lg col-span-2" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // After isLoading settles, data will be undefined AND isError will be true
  // if the deployment doesn't exist or the user doesn't own it. Show a proper
  // not-found UI with a back-to-dashboard action so the page isn't blank.
  if (deploymentQuery.isError || !deploymentQuery.data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4 max-w-md px-6">
          <Bot className="w-12 h-12 text-muted-foreground mx-auto" />
          <h2 className="text-lg font-medium">Deployment not found</h2>
          <p className="text-sm text-muted-foreground">
            This deployment doesn't exist or you don't have access to it.
          </p>
          <Button variant="outline" onClick={() => router.push("/dashboard")}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const deployment = deploymentQuery.data;
  const liveStatus = getLiveStatus(deployment.id)?.status || deployment.status;

  if (liveStatus === "creating" || liveStatus === "pending") {
    return (
      <div className="h-screen bg-background text-foreground flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold">Provisioning your agent...</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            Setting up your deployment. This usually takes 1-2 minutes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ComponentCatalogProvider deploymentId={id}>
      <DeploymentTamboProvider deploymentId={id} deploymentName={deployment.name}>
        <WorkspacePage
          deploymentId={id}
          deploymentName={deployment.name}
          liveStatus={liveStatus}
          themeConfig={(deployment as any).themeConfig}
          memoryScope={(deployment as any).memoryScope ?? "global"}
          onRefetchDeployment={() => deploymentQuery.refetch()}
        />
      </DeploymentTamboProvider>
    </ComponentCatalogProvider>
  );
}

// ── Full Workspace Page ───────────────────────────────────────────────────────

function WorkspacePage({
  deploymentId,
  deploymentName,
  liveStatus,
  themeConfig,
  memoryScope,
  onRefetchDeployment,
}: {
  deploymentId: string;
  deploymentName: string;
  liveStatus: string;
  themeConfig?: string | null;
  /** JAR memory-scoping foundation: passed straight through to
   *  CanvasWorkspace which renders the disclosure banner. Defaults
   *  to "global" if the deployment record predates the column. */
  memoryScope?: string | null;
  onRefetchDeployment?: () => void;
}) {
  const router = useRouter();
  // controlMode removed — replaced by chatMode "webui" toggle (Control Panel)
  const [filesOpen, setFilesOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [teamSessionsOpen, setTeamSessionsOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [chatMode, setChatMode] = useState<"workspace" | "webui">("workspace");
  // chatMode is declared here in WorkspacePage and passed to CanvasWorkspace
  const [liveThemeConfig, setLiveThemeConfig] = useState(themeConfig);
  // Track whether theme was set by SSE (takes priority over prop sync for 5s)
  const themeSetBySse = useRef(false);
  // Sync liveThemeConfig when the deployment refetch returns updated themeConfig
  // BUT skip if SSE just set it (prevents race where stale refetch overwrites fresh SSE value)
  useEffect(() => {
    if (themeConfig !== undefined && !themeSetBySse.current) setLiveThemeConfig(themeConfig);
  }, [themeConfig]);
  const themeStyle = useDeploymentTheme(liveThemeConfig);

  const currentSkin = useMemo(() => {
    if (!liveThemeConfig) return undefined;
    try {
      const config = JSON.parse(liveThemeConfig);
      return config.skin || undefined;
    } catch {
      return undefined;
    }
  }, [liveThemeConfig]);

  // Resolved theme vars for sandbox injection (same data as themeStyle but typed as Record)
  const sandboxThemeVars = useMemo<Record<string, string>>(() => {
    if (!liveThemeConfig) return {};
    try {
      const config: ThemeConfig = JSON.parse(liveThemeConfig);
      return resolveThemeVars(config);
    } catch {
      return {};
    }
  }, [liveThemeConfig]);

  // Listen for bot-triggered theme changes via SSE
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setLiveThemeConfig(detail ? JSON.stringify(detail) : null);
      // Block prop sync from overwriting this SSE value for 5s
      themeSetBySse.current = true;
      setTimeout(() => { themeSetBySse.current = false; }, 5000);
    };
    window.addEventListener("jarble:theme-updated", handler);
    return () => window.removeEventListener("jarble:theme-updated", handler);
  }, []);

  return (
    <SandboxThemeProvider themeVars={sandboxThemeVars}>
      <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden" data-skin={currentSkin} style={themeStyle}>
      {/* Header */}
      <header className="border-b border-border/60 bg-background/95 backdrop-blur-sm z-10 shrink-0">
        <div className="px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/dashboard")}
              className="h-8 w-8 p-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{deploymentName}</span>
                <StatusBadge status={liveStatus} />
              </div>
              <TeamIndicator deploymentId={deploymentId} />
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto scrollbar-none">
            <EssentialControls deploymentId={deploymentId} status={liveStatus} />
            <div className="w-px h-5 bg-border/60 hidden sm:block" />
            {/* Chat mode toggle: Workspace (Jarble canvas) vs Control Panel */}
            <div className="flex items-center bg-muted rounded-md p-0.5 gap-0.5">
              <Button
                variant={chatMode === "workspace" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setChatMode("workspace")}
              >
                Workspace
              </Button>
              <Button
                variant={chatMode === "webui" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setChatMode("webui")}
              >
                Control Panel
              </Button>
            </div>
            <div className="w-px h-5 bg-border/60 hidden sm:block" />
            <Button
              variant={historyOpen ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setHistoryOpen((v) => {
                  if (!v) { setFilesOpen(false); setKnowledgeOpen(false); setSubagentsOpen(false); }
                  return !v;
                });
              }}
              className="h-8 w-8 p-0 shrink-0"
              title="Conversation history"
            >
              <MessageSquareText className="w-4 h-4" />
            </Button>
            {/* Team Sessions removed — now integrated into Conversation History panel */}
            <Button
              variant={filesOpen ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setFilesOpen((v) => {
                  if (!v) { setHistoryOpen(false); setKnowledgeOpen(false); setSubagentsOpen(false); }
                  return !v;
                });
              }}
              className="h-8 w-8 p-0 shrink-0 hidden sm:flex"
              title="Files"
            >
              <FolderOpen className="w-4 h-4" />
            </Button>
            <Button
              variant={knowledgeOpen ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setKnowledgeOpen((v) => {
                  if (!v) { setFilesOpen(false); setHistoryOpen(false); setSubagentsOpen(false); }
                  return !v;
                });
              }}
              className="h-8 w-8 p-0 shrink-0 hidden sm:flex"
              title="Knowledge Base"
            >
              <Brain className="w-4 h-4" />
            </Button>
            <SubagentsBadgeButton
              deploymentId={deploymentId}
              isOpen={subagentsOpen}
              onClick={() => {
                setSubagentsOpen((v) => {
                  if (!v) { setFilesOpen(false); setKnowledgeOpen(false); setHistoryOpen(false); setTeamsOpen(false); }
                  return !v;
                });
              }}
            />
            <TeamsBadgeButton
              deploymentId={deploymentId}
              isOpen={teamsOpen}
              onClick={() => {
                setTeamsOpen((v) => {
                  if (!v) { setFilesOpen(false); setKnowledgeOpen(false); setHistoryOpen(false); setSubagentsOpen(false); }
                  return !v;
                });
              }}
            />
            <Button
              variant={debugOpen ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setDebugOpen((v) => {
                  if (!v) { setFilesOpen(false); setKnowledgeOpen(false); setSubagentsOpen(false); setTeamsOpen(false); }
                  return !v;
                });
              }}
              className="h-8 w-8 p-0 shrink-0 hidden sm:flex"
              title="Debug Traces"
            >
              <Activity className="w-4 h-4" />
            </Button>
            <ProfileDropdown />
          </div>
        </div>
      </header>

      {/* Main area: workspace panels + canvas */}
      <div className="flex-1 flex overflow-hidden">
          <>
            {filesOpen && (
              <FilePanel
                deploymentId={deploymentId}
                onClose={() => setFilesOpen(false)}
              />
            )}
            {knowledgeOpen && (
              <KnowledgePanel
                deploymentId={deploymentId}
                onClose={() => setKnowledgeOpen(false)}
              />
            )}
            {subagentsOpen && (
              <SubagentsPanel
                deploymentId={deploymentId}
                onClose={() => setSubagentsOpen(false)}
              />
            )}
            {teamsOpen && (
              <TeamMembershipsPanel
                deploymentId={deploymentId}
                onClose={() => setTeamsOpen(false)}
              />
            )}
            {debugOpen && (
              <DebugTracePanel
                deploymentId={deploymentId}
                onClose={() => setDebugOpen(false)}
              />
            )}
            <CanvasWorkspace
              deploymentId={deploymentId}
              liveStatus={liveStatus}
              historyOpen={historyOpen}
              onHistoryClose={() => setHistoryOpen(false)}
              onRefetchDeployment={onRefetchDeployment}
              memoryScope={memoryScope}
              chatMode={chatMode}
            />
          </>
      </div>
    </div>
    </SandboxThemeProvider>
  );
}

// ── Keyed Chat Panel - remounts on conversation switch to reset assistant-ui runtime ──

function KeyedChatPanel({
  messages,
  streamingText,
  streamingReasoning,
  isStreaming,
  sendMessage,
  suggestions,
  toolStatus,
  activeAgentCall,
  orchestrationSteps,
  stopGeneration,
  editMessage,
  onExamplePrompt,
}: {
  messages: import("@/hooks/useCanvasChat").ChatMessage[];
  streamingText: string;
  streamingReasoning: string;
  isStreaming: boolean;
  sendMessage: (text: string, displayText?: string) => Promise<void>;
  suggestions: Array<{ prompt: string }>;
  toolStatus?: string | null;
  activeAgentCall?: { serviceId: string; skillName: string; agentName?: string } | null;
  orchestrationSteps?: import("@/components/chat/OrchestrationSteps").OrchestrationStep[];
  stopGeneration: () => void;
  editMessage: (messageId: string, newText: string) => Promise<void>;
  onExamplePrompt: (prompt: string) => void;
}) {
  const runtime = useJarbleRuntime({ messages, streamingText, streamingReasoning, isStreaming, sendMessage, suggestions, stopGeneration, editMessage });

  return (
    <AssistantUIChat
      runtime={runtime}
      isStreaming={isStreaming}
      suggestions={suggestions}
      onSuggestionClick={(prompt) => sendMessage(prompt)}
      toolStatus={toolStatus}
      activeAgentCall={activeAgentCall}
      orchestrationSteps={orchestrationSteps}
      emptyState={
        <div className="h-full flex flex-col items-center justify-center gap-4 px-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/10 flex items-center justify-center">
            <MessageSquare className="w-6 h-6 text-primary/50" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-foreground/70">Start a conversation</p>
            <p className="text-xs text-muted-foreground-subtle">
              Send a message to interact with your agent
            </p>
          </div>
          <div className="flex flex-col gap-2 w-full max-w-xs mt-2">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onExamplePrompt(prompt)}
                className="text-left text-xs px-3 py-2 rounded-lg border border-border/60 bg-secondary/20 text-muted-foreground hover:bg-secondary/40 hover:text-foreground hover:border-border transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      }
    />
  );
}

// ── Canvas Workspace ──────────────────────────────────────────────────────────

/** Compact inline team membership indicator — shows under bot name */
function TeamIndicator({ deploymentId }: { deploymentId: string }) {
  const query = trpc.flows.listForDeployment.useQuery(
    { deploymentId },
    { staleTime: 60_000 },
  );
  const flows = query.data ?? [];
  if (flows.length === 0) return null;

  // Show the first team with member names
  const flow = flows[0] as any;
  const members = (flow.members ?? [])
    .filter((m: any) => m.deploymentId !== deploymentId)
    .map((m: any) => m.name || m.deploymentId?.slice(0, 8))
    .slice(0, 3);

  if (members.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      <span className="text-[10px] text-muted-foreground">
        Team: {flow.name || "Unnamed"} with {members.join(", ")}
        {flows.length > 1 && ` (+${flows.length - 1} more)`}
      </span>
      <a
        href={`/deployments?tab=botteams&flow=${flow.id}`}
        className="text-[10px] text-primary/70 hover:text-primary"
      >
        View →
      </a>
    </div>
  );
}

function CanvasWorkspace({
  deploymentId,
  liveStatus,
  historyOpen,
  onHistoryClose,
  onRefetchDeployment,
  memoryScope,
  chatMode,
}: {
  deploymentId: string;
  liveStatus: string;
  historyOpen: boolean;
  onHistoryClose: () => void;
  onRefetchDeployment?: () => void;
  /** JAR memory-scoping foundation: drives the disclosure banner above
   *  the chat. Read from the deployment record on the parent. */
  memoryScope?: string | null;
  chatMode: "workspace" | "webui";
}) {
  const router = useRouter();
  const { getAccessTokenSilently } = useAuth0();
  const startMutation = trpc.deployment.start.useMutation();
  const [state, dispatch] = useReducer(canvasReducer, INITIAL_CANVAS_STATE);
  const {
    sendMessage, isStreaming, streamingCardIds, messages, streamingText, streamingReasoning,
    lastChatError, lastUserMessage, clearChatError, suggestions, toolStatus, activeAgentCall, orchestrationSteps,
    stopGeneration, editMessage,
    conversations, activeConversationId, switchConversation, newConversation, deleteConversation,
  } = useCanvasChat(deploymentId, state, dispatch, liveStatus, onRefetchDeployment);

  // Real-time orchestration events via WebSocket - supersedes legacy predictive steps
  const { steps: wsOrchestrationSteps, isConnected: orchWsConnected, clearSteps: clearOrchSteps } = useOrchestration(deploymentId);

  // Merge WS steps with legacy SSE-based predictive steps. Real WS events take priority.
  const mergedOrchestrationSteps = useMemo(() => {
    if (wsOrchestrationSteps.length > 0) {
      // Map WS steps to the OrchestrationStep component format (agent field = agentType)
      return wsOrchestrationSteps.map((s) => ({
        id: s.id,
        label: s.label,
        status: s.status,
        agent: (s.agentType || "tool") as import("@/components/chat/OrchestrationSteps").OrchestrationStep["agent"],
        detail: s.detail,
        duration: s.duration,
        agentType: s.agentType,
        toolName: s.toolName,
        targetDeploymentId: s.targetDeploymentId,
      }));
    }
    return orchestrationSteps; // Fall back to legacy SSE-based steps
  }, [wsOrchestrationSteps, orchestrationSteps]);

  // runtime created inside KeyedChatPanel - keyed by activeConversationId
  useCanvasPersistence(deploymentId, state, dispatch, activeConversationId);
  useArtifactSync(deploymentId, state, dispatch);
  const [input, setInput] = useState("");
  const [showCanvas, setShowCanvas] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Stable callback for canvas onHide - avoids breaking memo on DashboardCanvas / SimpleCanvasGrid
  const handleHideCanvas = useCallback(() => setShowCanvas(false), []);

  // Slash command menu state
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);

  // ── Resizable chat panel state ──
  const [chatWidth, setChatWidth] = useState(400);
  const [isResizingChat, setIsResizingChat] = useState(false);
  const resizeRef = useRef({ startX: 0, startWidth: 0 });

  // Mouse handlers for resize drag
  useEffect(() => {
    if (!isResizingChat) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeRef.current.startX;
      const newWidth = Math.min(700, Math.max(300, resizeRef.current.startWidth + delta));
      setChatWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingChat(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizingChat]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      resizeRef.current = { startX: e.clientX, startWidth: chatWidth };
      setIsResizingChat(true);
    },
    [chatWidth]
  );

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 150) + "px";
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!input.trim()) return;
      const text = input;
      setInput("");
      // Reset textarea height after clearing
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + "px";
      }
      await sendMessage(text);
      textareaRef.current?.focus();
    },
    [input, sendMessage]
  );

  const handleSlashSelect = useCallback((command: string) => {
    setSlashMenuOpen(false);
    // Commands without arguments: auto-submit immediately
    const autoSubmitCommands = ["/clear", "/reset", "/commands", "/help"];
    if (autoSubmitCommands.includes(command.toLowerCase())) {
      setInput("");
      sendMessage(command);
      textareaRef.current?.focus();
      return;
    }
    // Commands with arguments: populate input and let user type the arg
    setInput(command + " ");
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Slash command menu navigation
      if (slashMenuOpen) {
        const query = input.slice(1); // strip "/"
        const count = getFilteredCommandCount(query);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashMenuIndex((prev) => (prev + 1) % count);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashMenuIndex((prev) => (prev - 1 + count) % count);
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          // Find the filtered command at the selected index
          const commands = ["/theme", "/skin", "/reset", "/clear", "/commands"];
          const filtered = commands.filter((cmd) => cmd.slice(1).startsWith(query.toLowerCase()));
          if (filtered[slashMenuIndex]) {
            handleSlashSelect(filtered[slashMenuIndex]);
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, slashMenuOpen, input, slashMenuIndex, handleSlashSelect]
  );

  // Render function for cards in the grid
  const renderCard = useCallback(
    (card: import("@/components/workspace/types").CanvasCard) => (
      <CardContent card={card} deploymentId={deploymentId} sendMessage={sendMessage} canvasDispatch={dispatch} getAuthToken={getAccessTokenSilently} />
    ),
    [deploymentId, sendMessage, dispatch, getAccessTokenSilently]
  );

  const selectedCard = state.cards.find((c) => c.selected) || null;
  const hasCanvasCards = state.cards.length > 0;
  const canvasSidebarVisible = showCanvas;

  // Keep a ref so the keydown handler doesn't need selectedCard in its deps
  const selectedCardRef = useRef(selectedCard);
  selectedCardRef.current = selectedCard;

  // Escape key deselects the selected card
  useEffect(() => {
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedCardRef.current) {
        dispatch({ type: "DESELECT_CARD" });
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [dispatch]); // stable - selectedCard accessed via ref, dispatch is stable from useReducer

  // Handle example prompt click
  const handleExamplePrompt = useCallback(
    (prompt: string) => {
      if (isStreaming) return;
      setInput("");
      sendMessage(prompt);
    },
    [isStreaming, sendMessage]
  );

  return (
    <div className="flex-1 flex overflow-hidden relative">
      {/* Control Panel mode: full-screen iframe to the Control Panel sidecar */}
      {chatMode === "webui" ? (
        <OpenWebUIFrame deploymentId={deploymentId} />
      ) : (
      <>
      {/* Conversation history panel */}
      {historyOpen && (
        <ConversationHistoryPanel
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelectConversation={switchConversation}
          onNewConversation={newConversation}
          onDeleteConversation={deleteConversation}
          onClose={onHistoryClose}
          isStreaming={isStreaming}
          deploymentId={deploymentId}
        />
      )}

      {/* Chat Panel -- always visible; full-width on mobile, resizable on desktop */}
      <div
        className={cn(
          "flex flex-col bg-background",
          canvasSidebarVisible
            ? "w-full md:shrink-0"
            : "flex-1 max-w-3xl mx-auto border-x border-border/40"
        )}
        style={canvasSidebarVisible ? { ["--chat-width" as string]: `${chatWidth}px` } : undefined}
      >
        {/* Apply desktop chat width via inline style only at md+ */}
        <style>{`
          @media (min-width: 768px) {
            [style*="--chat-width"] { width: var(--chat-width) !important; }
          }
        `}</style>
        {/* JAR memory-scoping disclosure: tells the user how memory is
            scoped before they share anything personal. Reads the
            memoryScope field from the deployment record (defaults to
            "global" until set). The banner is intentionally persistent
            in global mode — that's the privacy-loaded default. */}
        <MemoryDisclosureBanner scope={(memoryScope ?? null) as MemoryScope | null} />
        <CreditStatusBanner deploymentId={deploymentId} className="mx-3 mt-2" />
        {/* Chat messages via assistant-ui - keyed so runtime resets on conversation switch */}
        <KeyedChatPanel
          key={activeConversationId ?? "default"}
          messages={messages}
          streamingText={streamingText}
          streamingReasoning={streamingReasoning}
          isStreaming={isStreaming}
          sendMessage={sendMessage}
          suggestions={suggestions}
          toolStatus={toolStatus}
          activeAgentCall={activeAgentCall}
          orchestrationSteps={mergedOrchestrationSteps}
          stopGeneration={stopGeneration}
          editMessage={editMessage}
          onExamplePrompt={handleExamplePrompt}
        />

        {/* Chat error card - diagnosis auto-runs inline in chat */}
        {lastChatError && !isStreaming && (
          <div className="px-4 pb-2">
            <ChatErrorCard
              error={lastChatError}
              onRetry={lastUserMessage ? () => sendMessage(lastUserMessage) : undefined}
              onStartBot={lastChatError.canStart ? () => {
                startMutation.mutate({ id: deploymentId }, {
                  onSuccess: () => clearChatError(),
                  onError: (err) => console.error("[Jarble:Chat] Start bot failed:", err.message),
                });
              } : undefined}
              onTopUp={lastChatError.canTopUp ? () => {
                router.push(`/d/${deploymentId}?tab=model`);
              } : undefined}
            />
          </div>
        )}

        {/* Chat input */}
        <div className="border-t border-border/60 bg-background/95 backdrop-blur-sm shrink-0 p-4 relative">
          {/* Selected card reference chip */}
          {selectedCard && (
            <div className="flex items-center gap-1 mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500 text-white text-xs font-medium">
                @{selectedCard.title || selectedCard.component.replace(/_/g, " ")}
                <button
                  type="button"
                  onClick={() => dispatch({ type: "DESELECT_CARD" })}
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-blue-600 transition-colors"
                  title="Remove card reference"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
              <span className="text-xs text-muted-foreground">
                Your message will reference this card
              </span>
            </div>
          )}
          {/* Slash command autocomplete menu */}
          {slashMenuOpen && (
            <SlashCommandMenu
              query={input.slice(1)} // strip leading "/"
              onSelect={handleSlashSelect}
              onClose={() => setSlashMenuOpen(false)}
              selectedIndex={slashMenuIndex}
            />
          )}
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                const val = e.target.value;
                setInput(val);
                // Show slash command menu when input starts with "/"
                if (val.startsWith("/") && !val.includes(" ")) {
                  setSlashMenuOpen(true);
                  setSlashMenuIndex(0);
                } else {
                  setSlashMenuOpen(false);
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder={selectedCard ? `Message about ${selectedCard.title || selectedCard.component.replace(/_/g, " ")}...` : "Type a message..."}
              rows={1}
              className={cn(
                "flex-1 rounded-lg border bg-secondary/50 px-4 py-2.5 text-sm resize-none",
                "focus:outline-none focus:ring-2 focus:border-primary focus:shadow-[0_0_12px_-3px_hsl(var(--primary)/0.3)]",
                "transition-shadow",
                selectedCard
                  ? "border-blue-500/50 focus:ring-blue-500/50"
                  : "border-border focus:ring-primary/50"
              )}
              style={{ maxHeight: 150 }}
            />
            {isStreaming && !input.trim() ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={stopGeneration}
                className="h-10 w-10 p-0 transition-transform hover:scale-105 active:scale-95 shrink-0"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="sm"
                disabled={!input.trim()}
                className="h-10 w-10 p-0 transition-transform hover:scale-105 active:scale-95 shrink-0"
              >
                <SendHorizontal className="w-4 h-4" />
              </Button>
            )}
          </form>
        </div>
      </div>

      {/* Resize handle -- between chat panel and dashboard grid (hidden on mobile) */}
      {canvasSidebarVisible && (
        <div
          onMouseDown={handleResizeStart}
          className={cn(
            "w-1.5 shrink-0 cursor-col-resize relative z-10 group",
            "hidden md:flex items-center justify-center",
            isResizingChat ? "bg-primary/30" : "bg-transparent hover:bg-border/60",
            "transition-colors duration-150"
          )}
        >
          {/* Visual handle indicator */}
          <div className={cn(
            "w-0.5 h-8 rounded-full transition-colors duration-150",
            isResizingChat ? "bg-primary/60" : "bg-border/40 group-hover:bg-border"
          )} />
        </div>
      )}

      {/* Dashboard Grid Panel -- for UI blocks only (hidden on mobile - chat is full-width) */}
      {canvasSidebarVisible && (
        <div className="hidden md:flex flex-1 flex-col overflow-hidden relative min-w-[300px] bg-secondary/10 border-l border-border/40">
          {state.mode === "dashboard" ? (
            <DashboardCanvas
              cards={state.cards}
              dispatch={dispatch}
              renderCard={renderCard}
              focusedCardId={state.focusedCardId}
              streamingCardIds={streamingCardIds}
              deploymentId={deploymentId}
              onHide={handleHideCanvas}
            />
          ) : (
            <SimpleCanvasGrid
              cards={state.cards}
              dispatch={dispatch}
              renderCard={renderCard}
              focusedCardId={state.focusedCardId}
              streamingCardIds={streamingCardIds}
              deploymentId={deploymentId}
              onHide={handleHideCanvas}
              dashboardGroups={state.dashboardGroups}
              zoom={state.zoom}
              onSendMessage={sendMessage}
              isChatStreaming={isStreaming}
              strokes={state.strokes}
            />
          )}

          {/* Page fullscreen overlay */}
          {state.fullscreenPageId && (() => {
            const pageCard = state.cards.find((c) => c.id === state.fullscreenPageId);
            if (!pageCard || pageCard.component !== "page") return null;
            return (
              <PageFullscreenOverlay
                card={pageCard}
                onClose={() => dispatch({ type: "CLOSE_PAGE_FULLSCREEN" })}
                onUngroup={() => dispatch({ type: "UNGROUP_PAGE", cardId: pageCard.id })}
                onSelect={() => dispatch({ type: "TOGGLE_SELECT_CARD", id: pageCard.id })}
                onAsk={() => {
                  dispatch({ type: "SELECT_CARD", id: pageCard.id });
                  // Close fullscreen and let the chat input take focus
                }}
              />
            );
          })()}
        </div>
      )}

      {/* Show dashboard button when hidden */}
      {!showCanvas && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCanvas(true)}
          className="absolute top-2 right-2 z-20"
        >
          <Layout className="w-4 h-4 mr-1" />
          {hasCanvasCards ? `Show Dashboard (${state.cards.length})` : "Show Dashboard"}
        </Button>
      )}
      </>
      )}
    </div>
  );
}

// ── OpenClaw Control Panel — iframe via direct subdomain ─────────────────────
// Each deployment gets https://{id}.agents.jarble.ai via Traefik ingress.
// Auth: signed cookie acquired via /api/auth/agent-session before iframe loads.
// Traefik forward auth verifies cookie + injects gateway token on every request.

function OpenWebUIFrame({ deploymentId }: { deploymentId: string }) {
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Use the shared token getter (same one tRPC uses — handles refresh gracefully)
        const { getToken } = await import("@/lib/trpc-vanilla");
        const jwt = await getToken();

        if (!jwt) {
          // No token available — try loading iframe with existing cookie
          if (!cancelled) setIframeSrc(`https://${deploymentId}.agents.jarble.ai`);
          return;
        }

        // Acquire signed cookie for *.agents.jarble.ai
        const sessionRes = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/auth/agent-session`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              Authorization: `Bearer ${jwt}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ deploymentId }),
          },
        );

        if (sessionRes.status === 403) {
          const body = await sessionRes.json();
          if (body.error === "mfa_required") {
            if (!cancelled) setError("MFA verification required for agent access");
            return;
          }
        }

        // Whether session succeeded or not, try loading the iframe
        // (cookie might already exist from a previous session)
        if (!cancelled) {
          setIframeSrc(`https://${deploymentId}.agents.jarble.ai`);
        }
      } catch {
        if (!cancelled) setError("Could not load Control Panel");
      }
    })();
    return () => { cancelled = true; };
  }, [deploymentId]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        {error}
      </div>
    );
  }

  if (!iframeSrc) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading Control Panel...
      </div>
    );
  }

  return (
    <iframe
      src={iframeSrc}
      className="w-full flex-1 border-0"
      allow="clipboard-write"
      title="OpenClaw Control Panel"
    />
  );
}

// ── Card Content Renderer (UI blocks only -- chat messages are separate) ───────

const CardContent = memo(function CardContent({
  card,
  deploymentId,
  sendMessage,
  canvasDispatch,
  getAuthToken,
}: {
  card: import("@/components/workspace/types").CanvasCard;
  deploymentId: string;
  sendMessage: (text: string, displayText?: string) => Promise<void>;
  canvasDispatch: React.Dispatch<import("@/components/workspace/types").CanvasAction>;
  getAuthToken?: () => Promise<string>;
}) {
  const isDev = process.env.NODE_ENV === "development";

  // ── Error relay throttle ──────────────────────────────────────────────────
  // Prevents cascading "Fix this component" messages when a sandbox/component
  // keeps erroring. Each card gets max 2 auto-fix attempts with a 30s cooldown.
  const errorRelayTracker = useRef<Map<string, { count: number; lastSentAt: number }>>(new Map());
  const ERROR_RELAY_COOLDOWN_MS = 30_000; // 30s between auto-fix attempts per card
  const ERROR_RELAY_MAX_ATTEMPTS = 2; // stop auto-fixing after 2 failed attempts

  // Handle actions from interactive components -- relay ALL actions to the bot as chat messages
  const handleAction = useCallback(
    async (action: CanvasAction) => {
      const actionStart = Date.now();
      isDev && console.log(`[Jarble:ActionRelay] Action received: ${action.component} → ${action.action} (blockId: ${action.blockId})`);

      // Content edit - user modified component content (code, text, etc.)
      // Update card props locally + debounced save to pod PVC for persistence
      if (action.action === "content_edit") {
        isDev && console.log(`[Jarble:ActionRelay] Content edit: ${action.blockId} (${action.component})`);
        const mergedProps = { ...card.props, ...action.payload };
        canvasDispatch({ type: "UPDATE_CARD_PROPS", id: action.blockId, props: action.payload, merge: true });
        // Persist merged state to pod PVC - debounced, fire-and-forget
        if (getAuthToken) {
          getAuthToken().then((token: string) => {
            saveComponentState(deploymentId, action.blockId, mergedProps, token);
          }).catch(() => {});
        }
        return;
      }

      // Confirmation response - user approved/rejected a confirm_action card
      if (action.action === "confirmation_response") {
        const { confirmationId, actionId, status: responseStatus } = action.payload as {
          confirmationId: string;
          actionId: string | null;
          status: "approved" | "rejected" | "expired";
        };
        isDev && console.log(`[Jarble:ActionRelay] Confirmation response: ${confirmationId} → ${responseStatus} (action: ${actionId})`);
        // Update the card props to reflect the resolved state
        canvasDispatch({
          type: "UPDATE_CARD_PROPS",
          id: action.blockId,
          props: { status: responseStatus, selectedActionId: actionId },
          merge: true,
        });
        // Send the response to the bot as a specially formatted message
        const confirmMsg = `[CONFIRMATION_RESPONSE] confirmationId=${confirmationId} action=${actionId ?? "none"} status=${responseStatus}`;
        const displayText = responseStatus === "approved" ? "Approved" : responseStatus === "rejected" ? "Rejected" : "Expired";
        try {
          await sendMessage(confirmMsg, displayText);
        } catch (err) {
          console.error(`[Jarble:ActionRelay] Failed to send confirmation response: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }

      // ── Error relay throttle check ──────────────────────────────────────
      // Prevents cascading auto-fix messages. Returns true if the relay should
      // be suppressed (cooldown active or max attempts reached).
      const shouldThrottleErrorRelay = (cardId: string): boolean => {
        const tracker = errorRelayTracker.current;
        const entry = tracker.get(cardId);
        const now = Date.now();
        if (entry) {
          if (entry.count >= ERROR_RELAY_MAX_ATTEMPTS) {
            isDev && console.log(`[Jarble:ActionRelay] Suppressing error relay for ${cardId} - max attempts (${ERROR_RELAY_MAX_ATTEMPTS}) reached. User can click "Fix" manually.`);
            return true;
          }
          if (now - entry.lastSentAt < ERROR_RELAY_COOLDOWN_MS) {
            isDev && console.log(`[Jarble:ActionRelay] Suppressing error relay for ${cardId} - cooldown (${Math.round((ERROR_RELAY_COOLDOWN_MS - (now - entry.lastSentAt)) / 1000)}s remaining)`);
            return true;
          }
        }
        tracker.set(cardId, { count: (entry?.count ?? 0) + 1, lastSentAt: now });
        return false;
      };

      // Component render error - auto-relay to bot (throttled)
      // Include card ID so the bot uses jarble_ui_update to fix in-place
      if (action.action === "component_error") {
        const { error, component } = action.payload as { error: string; component: string };
        if (shouldThrottleErrorRelay(action.blockId)) return;
        const errorMsg = `[COMPONENT_ERROR] cardId=${action.blockId} component=${component}\nThe component failed to render with this error:\n${error}\n\nPlease fix the component by outputting a \`\`\`jarble_ui_update\`\`\` block with card_id="${action.blockId}" and corrected props. Do NOT create a new component - update the existing one in place.`;
        isDev && console.log("[Jarble:ActionRelay] Forwarding component error to bot for fix");
        try {
          await sendMessage(errorMsg, "Fix this component");
        } catch (err) {
          console.error(`[Jarble:ActionRelay] Failed to send error to bot: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }

      // Component abandon - user clicked "Remove" on error card
      if (action.action === "component_abandon") {
        isDev && console.log("[Jarble:ActionRelay] Removing broken card:", action.blockId);
        canvasDispatch({ type: "REMOVE_CARD", id: action.blockId });
        // Clear error tracking so a new component with same ID gets fresh attempts
        errorRelayTracker.current.delete(action.blockId);
        return;
      }

      // Special handling for sandbox errors - auto-relay to bot (throttled)
      if (action.action === "sandbox_error") {
        const error = action.payload.error as { message: string; line: number; column: number; stack?: string } | undefined;
        if (error) {
          if (shouldThrottleErrorRelay(action.blockId)) return;
          const errorMsg = `[SANDBOX_ERROR] cardId=${action.blockId}\nThe sandbox component threw an error:\nError: ${error.message}${error.line ? `\nAt line ${error.line}, column ${error.column}` : ""}${error.stack ? `\nStack: ${error.stack.slice(0, 500)}` : ""}\n\nPlease fix the JavaScript code by outputting a \`\`\`jarble_ui_update\`\`\` block with card_id="${action.blockId}" and corrected props (merge: false for sandbox). Do NOT create a new component.`;
          const displayText = "Fix this component";
          isDev && console.log("[Jarble:ActionRelay] Forwarding sandbox error to bot");
          try {
            await sendMessage(errorMsg, displayText);
          } catch (err) {
            console.error(`[Jarble:ActionRelay] Failed to send action to bot: ${err instanceof Error ? err.message : String(err)}`);
          }
          return;
        }
      }

      // Build a friendly display message based on action type and component
      const displayText = formatActionDisplay(action);

      // Generic action relay -- forward all user interactions to the bot
      const actionMsg = `[UI_ACTION] cardId=${action.blockId} component=${action.component} action=${action.action}\n${JSON.stringify(action.payload)}`;
      isDev && console.log(`[Jarble:ActionRelay] Relaying UI action to bot (${Date.now() - actionStart}ms prep)`);
      try {
        await sendMessage(actionMsg, displayText);
      } catch (err) {
        console.error(`[Jarble:ActionRelay] Failed to send action to bot: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [sendMessage, canvasDispatch]
  );

  // Editable UI block -- use EditableCanvas for save support
  if (card.editable) {
    return (
      <EditableCanvas
        block={{
          id: card.id,
          component: card.component,
          props: card.props,
          editable: card.editable,
          fileId: card.fileId,
          saveMethod: card.saveMethod,
          llmProvider: card.llmProvider,
          llmModel: card.llmModel,
        }}
        deploymentId={deploymentId}
        sendMessage={sendMessage}
        onAction={handleAction}
        onPropsUpdate={(id, props) => {
          canvasDispatch({ type: "UPDATE_CARD_PROPS", id, props, merge: false });
        }}
      />
    );
  }

  // Standard read-only canvas component
  return (
    <CanvasRenderer
      block={{
        id: card.id,
        component: card.component,
        props: card.props,
        llmProvider: card.llmProvider,
        llmModel: card.llmModel,
      }}
      onAction={handleAction}
    />
  );
});

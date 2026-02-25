"use client";

import { useParams, useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { StatusBadge } from "@/components/StatusBadge";
import { useStatusStream } from "@/hooks/useStatusStream";
import { ComponentCatalogProvider } from "@/components/ComponentCatalogProvider";
import DeploymentTamboProvider from "@/components/DeploymentTamboProvider";
import { useCanvasChat, type ChatMessage } from "@/hooks/useCanvasChat";
import { useCanvasPersistence } from "@/hooks/useCanvasPersistence";
import { canvasReducer, INITIAL_CANVAS_STATE } from "@/components/workspace/canvasReducer";
import DashboardGrid from "@/components/workspace/DashboardGrid";
import EssentialControls from "@/components/workspace/EssentialControls";
import ConfigPanel from "@/components/workspace/ConfigPanel";
import CanvasRenderer from "@/components/canvas/CanvasRenderer";
import EditableCanvas from "@/components/canvas/EditableCanvas";
import type { CanvasAction } from "@/components/canvas/CanvasActionContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, SendHorizontal, Settings, MessageSquare, Layout } from "lucide-react";
import { useReducer, useRef, useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import MarkdownMessage from "@/components/MarkdownMessage";
import ProfileDropdown from "@/components/ProfileDropdown";

export default function DeploymentChatPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth0();

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
    router.replace("/login");
    return null;
  }

  if (deploymentQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading deployment...</p>
        </div>
      </div>
    );
  }

  if (!deploymentQuery.data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Deployment not found</p>
      </div>
    );
  }

  const deployment = deploymentQuery.data;
  const liveStatus = getLiveStatus(deployment.id)?.status || deployment.status;

  return (
    <ComponentCatalogProvider deploymentId={id}>
      <DeploymentTamboProvider deploymentId={id} deploymentName={deployment.name}>
        <WorkspacePage
          deploymentId={id}
          deploymentName={deployment.name}
          liveStatus={liveStatus}
        />
      </DeploymentTamboProvider>
    </ComponentCatalogProvider>
  );
}

// ── Full Workspace Page (needs Tambo context for ConfigPanel) ─────────────────

function WorkspacePage({
  deploymentId,
  deploymentName,
  liveStatus,
}: {
  deploymentId: string;
  deploymentName: string;
  liveStatus: string;
}) {
  const router = useRouter();
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
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
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{deploymentName}</span>
              <StatusBadge status={liveStatus} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <EssentialControls deploymentId={deploymentId} status={liveStatus} />
            <div className="w-px h-5 bg-border/60" />
            <Button
              variant={configOpen ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setConfigOpen((v) => !v)}
              className="h-8 w-8 p-0"
              title="Configuration"
            >
              <Settings className="w-4 h-4" />
            </Button>
            <ProfileDropdown />
          </div>
        </div>
      </header>

      {/* Main area: optional config panel + canvas */}
      <div className="flex-1 flex overflow-hidden">
        {configOpen && (
          <ConfigPanel
            deploymentId={deploymentId}
            onClose={() => setConfigOpen(false)}
          />
        )}
        <CanvasWorkspace deploymentId={deploymentId} />
      </div>
    </div>
  );
}

// ── Canvas Workspace ──────────────────────────────────────────────────────────

function CanvasWorkspace({ deploymentId }: { deploymentId: string }) {
  const [state, dispatch] = useReducer(canvasReducer, INITIAL_CANVAS_STATE);
  const { sendMessage, isStreaming, streamingCardIds, messages, streamingText } = useCanvasChat(deploymentId, state, dispatch);
  useCanvasPersistence(deploymentId, state, dispatch);
  const [input, setInput] = useState("");
  const [showCanvas, setShowCanvas] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isStreaming) return;
      const text = input;
      setInput("");
      await sendMessage(text);
      inputRef.current?.focus();
    },
    [input, isStreaming, sendMessage]
  );

  // Render function for cards in the grid
  const renderCard = useCallback(
    (card: import("@/components/workspace/types").CanvasCard) => (
      <CardContent card={card} deploymentId={deploymentId} sendMessage={sendMessage} />
    ),
    [deploymentId, sendMessage]
  );

  const hasCanvasCards = state.cards.length > 0;

  return (
    <div className="flex-1 flex overflow-hidden relative">
      {/* Chat Panel — always visible */}
      <div className={cn(
        "flex flex-col border-r border-border bg-background transition-all",
        showCanvas && hasCanvasCards ? "w-[400px]" : "flex-1 max-w-3xl mx-auto"
      )}>
        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && !streamingText && (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              Start a conversation with your bot
            </div>
          )}
          {messages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} />
          ))}
          {/* Streaming text indicator */}
          {streamingText && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-xs font-medium text-primary">AI</span>
              </div>
              <div className="flex-1 rounded-lg bg-secondary/50 px-4 py-3">
                <MarkdownMessage content={streamingText} />
                <span className="inline-block w-2 h-4 bg-primary/60 animate-pulse ml-1" />
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Chat input */}
        <div className="border-t border-border bg-background/95 backdrop-blur-sm shrink-0 p-4">
          <form onSubmit={handleSubmit} className="flex gap-2 items-center">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 rounded-lg border border-border bg-secondary/50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              disabled={isStreaming}
            />
            <Button
              type="submit"
              size="sm"
              disabled={!input.trim() || isStreaming}
              className="h-10 w-10 p-0"
            >
              {isStreaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <SendHorizontal className="w-4 h-4" />
              )}
            </Button>
          </form>
        </div>
      </div>

      {/* Dashboard Grid Panel — for UI blocks only */}
      {showCanvas && hasCanvasCards && (
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Toggle button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCanvas(false)}
            className="absolute top-2 left-2 z-20 h-8 px-2 bg-background/80 backdrop-blur-sm"
          >
            <MessageSquare className="w-4 h-4 mr-1" />
            Hide Dashboard
          </Button>

          {/* Dashboard Grid (Grafana-style) */}
          <DashboardGrid
            cards={state.cards}
            dispatch={dispatch}
            renderCard={renderCard}
            focusedCardId={state.focusedCardId}
            streamingCardIds={streamingCardIds}
          />
        </div>
      )}

      {/* Show dashboard button when hidden but cards exist */}
      {!showCanvas && hasCanvasCards && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCanvas(true)}
          className="absolute top-2 right-2 z-20"
        >
          <Layout className="w-4 h-4 mr-1" />
          Show Dashboard ({state.cards.length})
        </Button>
      )}
    </div>
  );
}

// ── Chat Bubble Component ────────────────────────────────────────────────────

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
        isUser ? "bg-primary text-primary-foreground" : "bg-primary/10"
      )}>
        <span className="text-xs font-medium">
          {isUser ? "You" : "AI"}
        </span>
      </div>
      <div className={cn(
        "flex-1 max-w-[80%] rounded-lg px-4 py-3",
        isUser ? "bg-primary text-primary-foreground" : "bg-secondary/50"
      )}>
        {isUser ? (
          <p className="text-sm">{message.content}</p>
        ) : (
          <MarkdownMessage content={message.content} />
        )}
      </div>
    </div>
  );
}

// ── Card Content Renderer (UI blocks only — chat messages are separate) ───────

function CardContent({
  card,
  deploymentId,
  sendMessage,
}: {
  card: import("@/components/workspace/types").CanvasCard;
  deploymentId: string;
  sendMessage: (text: string) => Promise<void>;
}) {
  // Handle actions from interactive components (including sandbox errors)
  const handleAction = useCallback(
    (action: CanvasAction) => {
      console.log("[CardContent] Action received:", action);

      // Forward sandbox errors to the bot for self-correction
      if (action.action === "sandbox_error") {
        const error = action.payload.error as { message: string; line: number; column: number; stack?: string } | undefined;
        if (error) {
          const errorMsg = `[SANDBOX_ERROR] The sandbox component threw an error:\nError: ${error.message}${error.line ? `\nAt line ${error.line}, column ${error.column}` : ""}${error.stack ? `\nStack: ${error.stack.slice(0, 500)}` : ""}\n\nPlease fix the JavaScript code and try again.`;
          console.log("[CardContent] Forwarding sandbox error to bot:", errorMsg);
          sendMessage(errorMsg);
        }
      }
    },
    [sendMessage]
  );

  // Editable UI block — use EditableCanvas for save support
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
        }}
        deploymentId={deploymentId}
        sendMessage={sendMessage}
        onAction={handleAction}
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
      }}
      onAction={handleAction}
    />
  );
}

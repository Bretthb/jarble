"use client";

import { useParams, useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { StatusBadge } from "@/components/StatusBadge";
import { useStatusStream } from "@/hooks/useStatusStream";
import { ComponentCatalogProvider } from "@/components/ComponentCatalogProvider";
import DeploymentTamboProvider from "@/components/DeploymentTamboProvider";
import { useCanvasChat } from "@/hooks/useCanvasChat";
import { useCanvasPersistence } from "@/hooks/useCanvasPersistence";
import { canvasReducer, INITIAL_CANVAS_STATE } from "@/components/workspace/canvasReducer";
import InfiniteCanvas, { isCardVisible } from "@/components/workspace/InfiniteCanvas";
import CanvasCardWrapper from "@/components/workspace/CanvasCardWrapper";
import EssentialControls from "@/components/workspace/EssentialControls";
import ConfigPanel from "@/components/workspace/ConfigPanel";
import MiniMap from "@/components/workspace/MiniMap";
import CanvasRenderer from "@/components/canvas/CanvasRenderer";
import EditableCanvas from "@/components/canvas/EditableCanvas";
import CanvasTextMessage from "@/components/canvas/components/CanvasTextMessage";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, SendHorizontal, Settings } from "lucide-react";
import { useReducer, useRef, useState, useCallback, useMemo } from "react";
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
  const { sendMessage, isStreaming, streamingCardIds } = useCanvasChat(deploymentId, state, dispatch);
  useCanvasPersistence(deploymentId, state, dispatch);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Viewport culling: only render cards within visible area + buffer
  const visibleCards = useMemo(() => {
    const w = typeof window !== "undefined" ? window.innerWidth : 1200;
    const h = typeof window !== "undefined" ? window.innerHeight : 800;
    return state.cards.filter((card) =>
      isCardVisible(card, state.viewportOffset, state.zoom, w, h)
    );
  }, [state.cards, state.viewportOffset, state.zoom]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Infinite Canvas — fills remaining space */}
      <InfiniteCanvas state={state} dispatch={dispatch}>
        {visibleCards.map((card) => (
          <CanvasCardWrapper
            key={card.id}
            card={card}
            dispatch={dispatch}
            focused={card.id === state.focusedCardId}
            streaming={streamingCardIds.has(card.id)}
          >
            <CardContent card={card} deploymentId={deploymentId} sendMessage={sendMessage} />
          </CanvasCardWrapper>
        ))}
      </InfiniteCanvas>

      {/* MiniMap overlay */}
      <MiniMap state={state} dispatch={dispatch} />

      {/* Fixed chat input bar */}
      <div className="border-t border-border bg-background/95 backdrop-blur-sm shrink-0 z-10">
        <form
          onSubmit={handleSubmit}
          className="max-w-3xl mx-auto px-4 py-3 flex gap-2 items-center"
        >
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
  );
}

// ── Card Content Renderer ─────────────────────────────────────────────────────

function CardContent({
  card,
  deploymentId,
  sendMessage,
}: {
  card: import("@/components/workspace/types").CanvasCard;
  deploymentId: string;
  sendMessage: (text: string) => Promise<void>;
}) {
  // Text message card
  if (card.component === "text_message") {
    return (
      <CanvasTextMessage
        botText={card.props.botText as string}
        userText={card.props.userText as string}
      />
    );
  }

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
    />
  );
}

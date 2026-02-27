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
import SimpleCanvasGrid from "@/components/workspace/SimpleCanvasGrid";
import DashboardCanvas from "@/components/workspace/DashboardCanvas";
import EssentialControls from "@/components/workspace/EssentialControls";
import ConfigPanel from "@/components/workspace/ConfigPanel";
import CanvasRenderer from "@/components/canvas/CanvasRenderer";
import EditableCanvas from "@/components/canvas/EditableCanvas";
import type { CanvasAction } from "@/components/canvas/CanvasActionContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, SendHorizontal, Settings, MessageSquare, Layout, X, Sparkles } from "lucide-react";
import { useReducer, useRef, useState, useCallback, useEffect, memo } from "react";
import { cn } from "@/lib/utils";
import MarkdownMessage from "@/components/MarkdownMessage";
import ProfileDropdown from "@/components/ProfileDropdown";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format a createdAt timestamp into a short time string */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

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

// ── Typing Indicator ─────────────────────────────────────────────────────────

function ThinkingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500/20 to-primary/20 border border-primary/10 flex items-center justify-center shrink-0">
        <Sparkles className="w-3.5 h-3.5 text-primary/70" />
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-secondary/30 px-4 py-3">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce"
          style={{ animationDelay: "0ms", animationDuration: "1s" }}
        />
        <span
          className="inline-block w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce"
          style={{ animationDelay: "150ms", animationDuration: "1s" }}
        />
        <span
          className="inline-block w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce"
          style={{ animationDelay: "300ms", animationDuration: "1s" }}
        />
        <span className="text-xs text-muted-foreground/70 ml-1">Thinking...</span>
      </div>
    </div>
  );
}

// ── Example prompts for empty state ──────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  "What can you do?",
  "Show me a chart of something interesting",
  "Create an interactive 3D visualization",
];

export default function DeploymentChatPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth0();

  // Auth redirect — must be before any early returns (hooks can't be after conditionals)
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

// ── Full Workspace Page ───────────────────────────────────────────────────────

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

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

  // Auto-scroll chat to bottom on new messages (not on every streaming update)
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Also scroll when thinking indicator appears (isStreaming starts)
  useEffect(() => {
    if (isStreaming) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isStreaming]);

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
      if (!input.trim() || isStreaming) return;
      const text = input;
      setInput("");
      // Reset textarea height after clearing
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      await sendMessage(text);
      textareaRef.current?.focus();
    },
    [input, isStreaming, sendMessage]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  // Render function for cards in the grid
  const renderCard = useCallback(
    (card: import("@/components/workspace/types").CanvasCard) => (
      <CardContent card={card} deploymentId={deploymentId} sendMessage={sendMessage} canvasDispatch={dispatch} />
    ),
    [deploymentId, sendMessage, dispatch]
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
  }, [dispatch]); // stable — selectedCard accessed via ref, dispatch is stable from useReducer

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
      {/* Chat Panel -- always visible */}
      <div
        className={cn(
          "flex flex-col bg-background",
          canvasSidebarVisible ? "shrink-0" : "flex-1 max-w-3xl mx-auto border-x border-border/40"
        )}
        style={canvasSidebarVisible ? { width: chatWidth } : undefined}
      >
        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Empty state */}
          {messages.length === 0 && !streamingText && !isStreaming && (
            <div className="h-full flex flex-col items-center justify-center gap-4 px-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/10 flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-primary/50" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-foreground/70">Start a conversation</p>
                <p className="text-xs text-muted-foreground/60">
                  Send a message to interact with your bot
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-xs mt-2">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => handleExamplePrompt(prompt)}
                    className="text-left text-xs px-3 py-2 rounded-lg border border-border/60 bg-secondary/20 text-muted-foreground hover:bg-secondary/40 hover:text-foreground hover:border-border transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} />
          ))}

          {/* Thinking indicator -- shown when streaming but no text yet */}
          {isStreaming && !streamingText && (
            <ThinkingIndicator />
          )}

          {/* Streaming text bubble */}
          {streamingText && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500/20 to-primary/20 border border-primary/10 flex items-center justify-center shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-primary/70" />
              </div>
              <div className="flex flex-col gap-1 flex-1 max-w-[80%]">
                <div className="rounded-lg bg-secondary/30 px-4 py-3 animate-[shimmer_2s_ease-in-out_infinite]" style={{
                  backgroundSize: "200% 100%",
                  backgroundImage: "linear-gradient(90deg, transparent 0%, hsl(var(--secondary)/0.15) 50%, transparent 100%)",
                }}>
                  <MarkdownMessage content={streamingText} />
                  <span className="inline-block w-2 h-4 bg-primary/60 animate-pulse ml-1 align-middle" />
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Chat input */}
        <div className="border-t border-border/60 bg-background/95 backdrop-blur-sm shrink-0 p-4">
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
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
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
              disabled={isStreaming}
            />
            <Button
              type="submit"
              size="sm"
              disabled={!input.trim() || isStreaming}
              className="h-10 w-10 p-0 transition-transform hover:scale-105 active:scale-95 shrink-0"
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

      {/* Resize handle -- between chat panel and dashboard grid */}
      {canvasSidebarVisible && (
        <div
          onMouseDown={handleResizeStart}
          className={cn(
            "w-1.5 shrink-0 cursor-col-resize relative z-10 group",
            "flex items-center justify-center",
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

      {/* Dashboard Grid Panel -- for UI blocks only */}
      {canvasSidebarVisible && (
        <div className="flex-1 flex flex-col overflow-hidden relative min-w-[300px] bg-secondary/10 border-l border-border/40">
          {state.mode === "dashboard" ? (
            <DashboardCanvas
              cards={state.cards}
              dispatch={dispatch}
              renderCard={renderCard}
              focusedCardId={state.focusedCardId}
              streamingCardIds={streamingCardIds}
              deploymentId={deploymentId}
              onHide={() => setShowCanvas(false)}
            />
          ) : (
            <SimpleCanvasGrid
              cards={state.cards}
              dispatch={dispatch}
              renderCard={renderCard}
              focusedCardId={state.focusedCardId}
              streamingCardIds={streamingCardIds}
              deploymentId={deploymentId}
              onHide={() => setShowCanvas(false)}
            />
          )}
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
    </div>
  );
}

// ── Chat Bubble Component ────────────────────────────────────────────────────

const ChatBubble = memo(function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isAction = message.isActionRelay;
  const displayContent = message.displayText || message.content;

  // Action relay messages render as compact, muted inline notes (no avatar, no full bubble)
  if (isUser && isAction) {
    return (
      <div className="flex justify-end">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/50 border border-border/40 max-w-[70%]">
          <span className="text-xs italic text-muted-foreground">{displayContent}</span>
          {message.createdAt > 0 && (
            <span className="text-[10px] text-muted-foreground/30 select-none shrink-0">
              {formatTime(message.createdAt)}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center shrink-0 border",
        isUser
          ? "bg-primary/90 text-primary-foreground border-primary/20"
          : "bg-gradient-to-br from-violet-500/20 to-primary/20 border-primary/10"
      )}>
        {isUser ? (
          <span className="text-[10px] font-semibold">Y</span>
        ) : (
          <Sparkles className="w-3.5 h-3.5 text-primary/70" />
        )}
      </div>

      {/* Message content + timestamp */}
      <div className={cn("flex flex-col gap-0.5", isUser ? "items-end" : "items-start", "flex-1 max-w-[80%]")}>
        <div className={cn(
          "rounded-lg px-4 py-3",
          isUser
            ? "bg-primary/90 text-primary-foreground shadow-sm"
            : "bg-secondary/30"
        )}>
          {isUser ? (
            <p className="text-sm">{displayContent}</p>
          ) : (
            <MarkdownMessage content={displayContent} />
          )}
        </div>
        {/* Timestamp */}
        {message.createdAt > 0 && (
          <span className="text-[10px] text-muted-foreground/40 px-1 select-none">
            {formatTime(message.createdAt)}
          </span>
        )}
      </div>
    </div>
  );
});

// ── Card Content Renderer (UI blocks only -- chat messages are separate) ───────

const CardContent = memo(function CardContent({
  card,
  deploymentId,
  sendMessage,
  canvasDispatch,
}: {
  card: import("@/components/workspace/types").CanvasCard;
  deploymentId: string;
  sendMessage: (text: string, displayText?: string) => Promise<void>;
  canvasDispatch: React.Dispatch<import("@/components/workspace/types").CanvasAction>;
}) {
  // Handle actions from interactive components -- relay ALL actions to the bot as chat messages
  const handleAction = useCallback(
    (action: CanvasAction) => {
      const actionStart = Date.now();
      console.log(`[Jarble:ActionRelay] Action received: ${action.component} → ${action.action} (blockId: ${action.blockId})`);

      // Component render error — user clicked "Fix Component"
      // Include card ID so the bot uses jarble_ui_update to fix in-place
      if (action.action === "component_error") {
        const { error, component } = action.payload as { error: string; component: string };
        const errorMsg = `[COMPONENT_ERROR] cardId=${action.blockId} component=${component}\nThe component failed to render with this error:\n${error}\n\nPlease fix the component by outputting a \`\`\`jarble_ui_update\`\`\` block with card_id="${action.blockId}" and corrected props. Do NOT create a new component — update the existing one in place.`;
        console.log("[Jarble:ActionRelay] Forwarding component error to bot for fix");
        try {
          sendMessage(errorMsg, "Fix this component");
        } catch (err) {
          console.error(`[Jarble:ActionRelay] Failed to send error to bot: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }

      // Component abandon — user clicked "Remove" on error card
      if (action.action === "component_abandon") {
        console.log("[Jarble:ActionRelay] Removing broken card:", action.blockId);
        canvasDispatch({ type: "REMOVE_CARD", id: action.blockId });
        return;
      }

      // Special handling for sandbox errors -- include detailed error info
      if (action.action === "sandbox_error") {
        const error = action.payload.error as { message: string; line: number; column: number; stack?: string } | undefined;
        if (error) {
          const errorMsg = `[SANDBOX_ERROR] cardId=${action.blockId}\nThe sandbox component threw an error:\nError: ${error.message}${error.line ? `\nAt line ${error.line}, column ${error.column}` : ""}${error.stack ? `\nStack: ${error.stack.slice(0, 500)}` : ""}\n\nPlease fix the JavaScript code by outputting a \`\`\`jarble_ui_update\`\`\` block with card_id="${action.blockId}" and corrected props (merge: false for sandbox). Do NOT create a new component.`;
          const displayText = "Fix this component";
          console.log("[Jarble:ActionRelay] Forwarding sandbox error to bot");
          try {
            sendMessage(errorMsg, displayText);
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
      console.log(`[Jarble:ActionRelay] Relaying UI action to bot (${Date.now() - actionStart}ms prep)`);
      try {
        sendMessage(actionMsg, displayText);
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
});

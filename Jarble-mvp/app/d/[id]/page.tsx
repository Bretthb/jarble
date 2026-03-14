"use client";

import { useParams, useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { StatusBadge } from "@/components/StatusBadge";
import { useStatusStream } from "@/hooks/useStatusStream";
import { useDirectChat } from "@/hooks/useDirectChat";
import { useJarbleRuntime } from "@/lib/assistantRuntime";
import AssistantUIChat from "@/components/chat/AssistantUIChat";
import EssentialControls from "@/components/workspace/EssentialControls";
import ConfigPanel from "@/components/workspace/ConfigPanel";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, SendHorizontal, Settings, MessageSquare } from "lucide-react";
import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import ProfileDropdown from "@/components/ProfileDropdown";
import ChatErrorCard from "@/components/workspace/ChatErrorCard";
import { useDiagnose } from "@/hooks/useDiagnose";
import { ChatSessionSidebar } from "@/components/chat/ChatSessionSidebar";
import { useChatSessions } from "@/hooks/useChatSessions";

// ── Example prompts for empty state ──────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  "What can you do?",
  "Tell me a joke",
  "Help me brainstorm ideas",
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
    <WorkspacePage
      deploymentId={id}
      deploymentName={deployment.name}
      liveStatus={liveStatus}
    />
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
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
              variant={sidebarOpen ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setSidebarOpen((v) => !v)}
              className="h-8 w-8 p-0"
              title="Chat history"
            >
              <MessageSquare className="w-4 h-4" />
            </Button>
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

      {/* Main area: optional config panel + chat */}
      <div className="flex-1 flex overflow-hidden">
        {configOpen && (
          <ConfigPanel
            deploymentId={deploymentId}
            onClose={() => setConfigOpen(false)}
          />
        )}
        <ChatPanel
          deploymentId={deploymentId}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />
      </div>
    </div>
  );
}

// ── Chat Panel (full-width, centered) ─────────────────────────────────────────

function ChatPanel({
  deploymentId,
  sidebarOpen,
  onToggleSidebar,
}: {
  deploymentId: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const startMutation = trpc.deployment.start.useMutation();
  const { messages, isStreaming, sendMessage, loadMessages, clearMessages, setSessionId } = useDirectChat(deploymentId);
  const {
    sessions,
    isLoading: sessionsLoading,
    activeSessionId,
    loadSession,
    startNewChat,
    refreshSessions,
  } = useChatSessions(deploymentId);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      const msgs = await loadSession(sessionId);
      loadMessages(msgs, sessionId);
    },
    [loadSession, loadMessages]
  );

  const handleNewChat = useCallback(() => {
    startNewChat();
    clearMessages();
  }, [startNewChat, clearMessages]);
  // Adapt DirectChatMessage to the ChatMessage shape expected by useJarbleRuntime.
  // Uses a stable cache so unchanged messages keep the same object reference,
  // preventing unnecessary re-renders of completed message bubbles.
  const adaptCacheRef = useRef(new WeakMap<object, { id: string; role: "user" | "assistant"; content: string; createdAt: number; thinkingText?: string; displayText?: string; isActionRelay?: boolean }>());
  const adaptedMessages = useMemo(() =>
    messages.map((m) => {
      const cached = adaptCacheRef.current.get(m);
      if (cached && cached.content === m.content && cached.thinkingText === m.thinkingText) return cached;
      const adapted = {
        ...m,
        createdAt: (m as any).createdAt
          ? new Date((m as any).createdAt).getTime()
          : Date.now(),
      };
      adaptCacheRef.current.set(m, adapted);
      return adapted;
    }),
    [messages]
  );
  const runtime = useJarbleRuntime({ messages: adaptedMessages, isStreaming, sendMessage });
  const { result: diagnosis, isLoading: isDiagnosing, runDiagnosis } = useDiagnose(deploymentId);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      await sendMessage(text);
      textareaRef.current?.focus();
      // Refresh sessions list after message exchange so new sessions appear
      refreshSessions();
    },
    [input, isStreaming, sendMessage, refreshSessions]
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

  // Handle example prompt click
  const handleExamplePrompt = useCallback(
    async (prompt: string) => {
      if (isStreaming) return;
      setInput("");
      await sendMessage(prompt);
      refreshSessions();
    },
    [isStreaming, sendMessage, refreshSessions]
  );

  return (
    <div className="flex-1 flex h-full relative">
      {/* Session sidebar */}
      <ChatSessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        isLoading={sessionsLoading}
        isOpen={sidebarOpen}
        onToggle={onToggleSidebar}
      />

      {/* Chat area */}
      <div className="flex-1 flex flex-col max-w-3xl mx-auto border-x border-border/40 bg-background">
      {/* Chat messages via assistant-ui */}
      <AssistantUIChat
        runtime={runtime}
        isStreaming={isStreaming}
        emptyState={
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
        }
      />

      {/* Chat input */}
      <div className="border-t border-border/60 bg-background/95 backdrop-blur-sm shrink-0 p-4">
        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className={cn(
              "flex-1 rounded-lg border bg-secondary/50 px-4 py-2.5 text-sm resize-none",
              "focus:outline-none focus:ring-2 focus:border-primary focus:shadow-[0_0_12px_-3px_hsl(var(--primary)/0.3)]",
              "transition-shadow",
              "border-border focus:ring-primary/50"
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
    </div>
  );
}

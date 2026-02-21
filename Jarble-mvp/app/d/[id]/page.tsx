"use client";

import { useParams, useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { StatusBadge } from "@/components/StatusBadge";
import { useStatusStream } from "@/hooks/useStatusStream";
import { useAgentChat } from "@/hooks/useAgentChat";
import type { ChatMessage, ToolCall } from "@/hooks/useAgentChat";
import { TOOL_COMPONENTS } from "@/components/tambo/loaders";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Loader2,
  SendHorizontal,
  Bot,
  User,
  Activity,
  Plug,
  FileText,
  Brain,
  Cpu,
  Puzzle,
  RotateCw,
} from "lucide-react";
import { useRef, useEffect, useState } from "react";
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
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="border-b border-border/60 bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
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
              <span className="font-semibold text-sm">{deployment.name}</span>
              <StatusBadge status={liveStatus} />
            </div>
          </div>
          <ProfileDropdown />
        </div>
      </header>

      {/* Chat area */}
      <ChatInterface deploymentId={id} deployment={deployment} liveStatus={liveStatus} />
    </div>
  );
}

// ─── Action Button Config ─────────────────────────────────────────────────────

const ACTION_BUTTONS = [
  { icon: Activity, label: "Status", tool: "get_deployment_info" },
  { icon: Plug, label: "Platforms", tool: "get_platforms" },
  { icon: FileText, label: "Logs", tool: "get_logs" },
  { icon: Brain, label: "Prompt", tool: "update_system_prompt" },
  { icon: Cpu, label: "LLM", tool: "update_llm_config" },
  { icon: Puzzle, label: "Skills", tool: "list_skills" },
  { icon: RotateCw, label: "Restart", tool: "restart_bot" },
] as const;

function ChatInterface({
  deploymentId,
  deployment,
  liveStatus,
}: {
  deploymentId: string;
  deployment: any;
  liveStatus: string;
}) {
  const { messages, isStreaming, isConnecting, sendMessage, invokeTool } = useAgentChat(deploymentId);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Greeting message shown before any API interaction
  const greeting: ChatMessage = {
    id: "greeting",
    role: "assistant",
    content: `Hi! I'm ${deployment.name}. Type a message to chat, or use the buttons below to manage your bot.`,
  };

  const allMessages = [greeting, ...messages];

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [allMessages.length, messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    const text = input;
    setInput("");
    await sendMessage(text);
  };

  return (
    <>
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          {allMessages
            .filter((msg) => msg.role !== "system")
            .map((msg) => (
              <MessageBubble key={msg.id} message={msg} deploymentId={deploymentId} />
            ))}
          {isStreaming && isConnecting && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Connecting to bot...</span>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons + Input */}
      <div className="border-t border-border bg-background/95 backdrop-blur-sm sticky bottom-0">
        {/* Action buttons row */}
        <div className="max-w-3xl mx-auto px-4 pt-3 pb-1">
          <div className="flex gap-2 overflow-x-auto scrollbar-none">
            {ACTION_BUTTONS.map(({ icon: Icon, label, tool }) => (
              <button
                key={tool}
                onClick={() => invokeTool(tool)}
                disabled={isStreaming}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-border/60 bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Chat input */}
        <form
          onSubmit={handleSubmit}
          className="max-w-3xl mx-auto px-4 py-2 flex gap-2"
        >
          <input
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
    </>
  );
}

function MessageBubble({
  message,
  deploymentId,
}: {
  message: ChatMessage;
  deploymentId: string;
}) {
  const isUser = message.role === "user";
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? "bg-primary/10" : "bg-secondary"
        }`}
      >
        {isUser ? (
          <User className="w-4 h-4 text-primary" />
        ) : (
          <Bot className="w-4 h-4 text-muted-foreground" />
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 ${isUser ? "text-right" : ""} space-y-3`}>
        {/* Text content */}
        {message.content && (
          <div
            className={`inline-block rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
              isUser
                ? "bg-primary text-primary-foreground"
                : "bg-secondary/50 text-foreground"
            }`}
          >
            <span className="whitespace-pre-wrap">{message.content}</span>
          </div>
        )}

        {/* Rendered components from tool calls */}
        {hasToolCalls &&
          message.toolCalls!.map((tc) => {
            const Component = TOOL_COMPONENTS[tc.name];
            if (!Component) return null;
            let args: any = {};
            try {
              args = JSON.parse(tc.args);
            } catch {
              // use empty args
            }
            return (
              <div key={tc.id} className="max-w-md">
                <Component deploymentId={deploymentId} args={args} />
              </div>
            );
          })}
      </div>
    </div>
  );
}

"use client";

import { memo } from "react";
import { Plus, MessageSquare, Trash2, X, ArrowUpRight, ArrowDownLeft, Clock, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import type { ConversationMeta } from "@/lib/conversationStorage";

interface ConversationHistoryPanelProps {
  conversations: ConversationMeta[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onClose: () => void;
  isStreaming: boolean;
  deploymentId?: string;
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function stripControlTags(text: string): string {
  return text
    .replace(/\[(?:CANVAS_STATE|DELEGATION_CONTEXT|FLOW CONTEXT|FLOW SYSTEM INSTRUCTIONS[^\]]*)\][\s\S]*?\[\/(?:CANVAS_STATE|DELEGATION_CONTEXT|FLOW CONTEXT|FLOW SYSTEM INSTRUCTIONS)\]/gi, "")
    .replace(/```jarble_delegate\s*\n[\s\S]*?```/g, "")
    .replace(/```json\s*\n\s*\{[^}]*"tool"\s*:\s*"delegate_to_[^}]*\}\s*```/g, "")
    .trim();
}

function formatTeamTime(date: Date | string | null): string {
  if (!date) return "";
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function ConversationHistoryPanel({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onClose,
  isStreaming,
  deploymentId,
}: ConversationHistoryPanelProps) {
  const teamQuery = trpc.deployment.listTeamSessions.useQuery(
    { id: deploymentId!, limit: 15 },
    { enabled: !!deploymentId, staleTime: 15_000, refetchInterval: 30_000 },
  );
  const teamSessions = teamQuery.data?.sessions ?? [];
  return (
    <div className="h-full w-[360px] shrink-0 border-r border-border/60 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary/70" />
          <span className="text-sm font-semibold text-foreground">Conversations</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 w-8 p-0 rounded-md hover:bg-secondary/80 transition-colors"
          aria-label="Close history panel"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* New Chat button */}
      <div className="px-3 pt-3 pb-1">
        <Button
          onClick={onNewConversation}
          disabled={isStreaming}
          className="w-full justify-start gap-2 h-9"
          variant="default"
        >
          <Plus className="w-4 h-4" />
          New Chat
        </Button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-1">
        {conversations.length === 0 && teamSessions.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">No conversations yet</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">Start chatting to create one</p>
          </div>
        ) : (
        <div>
        {conversations.length > 0 && (
          <div className="px-3 pt-1 pb-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">Personal</span>
          </div>
        )}
        {conversations.length > 0 && (
          conversations.map((conv) => (
            <div
              key={conv.id}
              role="button"
              tabIndex={0}
              onClick={() => !isStreaming && onSelectConversation(conv.id)}
              onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !isStreaming) { e.preventDefault(); onSelectConversation(conv.id); } }}
              aria-current={activeConversationId === conv.id ? "true" : undefined}
              className={cn(
                "w-full text-left px-3 py-2.5 transition-colors relative group cursor-pointer",
                activeConversationId === conv.id
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                isStreaming && "opacity-60 cursor-not-allowed pointer-events-none"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="truncate text-xs font-medium leading-relaxed">
                    {stripControlTags(conv.title || "") || "New Conversation"}
                  </div>
                  {conv.preview && (
                    <div className="truncate text-[10px] text-muted-foreground/60 mt-0.5">
                      {stripControlTags(conv.preview || "")}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground/50">
                    <span>{formatRelativeTime(conv.updatedAt)}</span>
                    <span>{conv.messageCount} msg{conv.messageCount !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(conv.id);
                  }}
                  className={cn(
                    "p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors shrink-0",
                    "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                    isStreaming && "hidden"
                  )}
                  aria-label="Delete conversation"
                  tabIndex={isStreaming ? -1 : 0}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))
        )}

        {/* Team Sessions (agent-to-agent, read-only) */}
        {teamSessions.length > 0 && (
          <>
            <div className="px-3 pt-3 pb-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">Team Delegations</span>
            </div>
            {teamSessions.map((s: any) => (
              <div key={s.id} className="px-3 py-2 text-xs">
                <div className="flex items-center gap-1.5">
                  {s.direction === "sent" ? (
                    <ArrowUpRight className="w-3 h-3 text-sky-400 shrink-0" />
                  ) : (
                    <ArrowDownLeft className="w-3 h-3 text-violet-400 shrink-0" />
                  )}
                  <span className="font-medium truncate text-[11px]">
                    {s.direction === "sent" ? `To ${s.otherDeploymentName || "bot"}` : `From ${s.otherDeploymentName || "bot"}`}
                  </span>
                  <span className={cn("text-[10px] ml-auto", s.status === "completed" ? "text-emerald-400" : s.status === "failed" ? "text-rose-400" : "text-muted-foreground")}>
                    {s.status}
                  </span>
                </div>
                {s.task && <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{typeof s.task === "string" ? s.task.slice(0, 80) : ""}</p>}
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground/50">
                  <span>{formatTeamTime(s.createdAt)}</span>
                  {s.durationMs != null && (
                    <span><Clock className="w-2 h-2 inline mr-0.5" />{s.durationMs < 1000 ? s.durationMs + "ms" : (s.durationMs / 1000).toFixed(1) + "s"}</span>
                  )}
                  {s.costCents > 0 && (
                    <span className="text-amber-400/60"><DollarSign className="w-2 h-2 inline mr-0.5" />{"$" + (s.costCents / 100).toFixed(2)}</span>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
        </div>
        )}
      </div>
    </div>
  );
}

export default memo(ConversationHistoryPanel);

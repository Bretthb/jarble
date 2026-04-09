"use client";

/**
 * TeamSessionsPanel — shows delegation conversations this bot
 * participated in, from both the coordinator and specialist perspective.
 *
 * Fractal Piece 6: "I go to t2's page and I see the delegations it
 * sent/received" — the user's original request.
 *
 * Uses `deployment.listTeamSessions` which queries agent_calls for
 * delegation rows involving this deployment.
 */

import { trpc } from "@/lib/trpc";
import { X, ArrowUpRight, ArrowDownLeft, Loader2, Clock, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TeamSessionsPanelProps {
  deploymentId: string;
  onClose: () => void;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function formatCost(cents: number | null | undefined): string {
  if (cents == null || cents <= 0) return "";
  return `$${(cents / 100).toFixed(2)}`;
}

function statusColor(status: string | null): string {
  switch (status) {
    case "completed": return "text-emerald-400";
    case "failed": return "text-rose-400";
    case "pending": return "text-sky-400";
    default: return "text-muted-foreground";
  }
}

function timeAgo(date: Date | string | null): string {
  if (!date) return "";
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export default function TeamSessionsPanel({
  deploymentId,
  onClose,
}: TeamSessionsPanelProps) {
  const query = trpc.deployment.listTeamSessions.useQuery(
    { id: deploymentId, limit: 30 },
    { staleTime: 15_000, refetchInterval: 30_000 },
  );

  const sessions = query.data?.sessions ?? [];
  const isLoading = query.isLoading;
  const isError = query.isError;

  return (
    <div className="w-80 border-r border-border/40 flex flex-col bg-background/50 backdrop-blur-sm">
      <div className="flex items-center justify-between px-4 py-4 border-b border-border/40">
        <div className="flex items-center gap-2">
          <ArrowUpRight className="w-4 h-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">Team Sessions</div>
            <div className="text-xs text-muted-foreground">Delegation conversations</div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-7 w-7 p-0"
          aria-label="Close team sessions panel"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {isLoading && (
          <div className="flex items-center gap-2 py-8 justify-center text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading team sessions...
          </div>
        )}
        {isError && (
          <div className="py-8 text-center text-xs text-rose-400">Failed to load team sessions</div>
        )}
        {!isLoading && !isError && sessions.length === 0 && (
          <div className="py-8 text-center">
            <ArrowUpRight className="w-6 h-6 mx-auto text-muted-foreground/40 mb-2" />
            <div className="text-xs text-muted-foreground">
              No delegation sessions yet. Team conversations will appear here when bots delegate tasks to each other.
            </div>
          </div>
        )}
        {sessions.length > 0 && (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="rounded-lg border border-border/40 bg-secondary/20 p-3 space-y-1.5"
              >
                {/* Direction + other bot */}
                <div className="flex items-center gap-2">
                  {s.direction === "sent" ? (
                    <ArrowUpRight className="w-3 h-3 text-sky-400 shrink-0" />
                  ) : (
                    <ArrowDownLeft className="w-3 h-3 text-violet-400 shrink-0" />
                  )}
                  <span className="text-xs font-medium truncate">
                    {s.direction === "sent"
                      ? `Delegated to ${s.otherDeploymentName || "unknown"}`
                      : `Received from ${s.otherDeploymentName || "unknown"}`}
                  </span>
                  <span className={cn("text-[10px] ml-auto shrink-0", statusColor(s.status))}>
                    {s.status}
                  </span>
                </div>

                {/* Task preview */}
                {s.task && (
                  <p className="text-[11px] text-foreground/70 line-clamp-2">{s.task}</p>
                )}

                {/* Response preview */}
                {s.responsePreview && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2 italic">
                    {s.responsePreview}
                  </p>
                )}

                {/* Meta row: time, duration, cost */}
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
                  <span>{timeAgo(s.createdAt)}</span>
                  {s.durationMs != null && (
                    <span className="flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {formatDuration(s.durationMs)}
                    </span>
                  )}
                  {formatCost(s.costCents) && (
                    <span className="flex items-center gap-0.5 text-amber-400/60">
                      <DollarSign className="w-2.5 h-2.5" />
                      {formatCost(s.costCents)}
                    </span>
                  )}
                  {s.depth != null && s.depth > 1 && (
                    <span>depth {s.depth}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

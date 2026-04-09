"use client";

/**
 * DebugTracePanel — shows recent agent_calls trees for this deployment.
 *
 * Part of JAR-51 Phase 5 (observability drawer). Pulls rows from the
 * `deployment.listRecentTraces` + `deployment.getAgentCallsByTrace`
 * procedures added in the same PR, and renders a click-to-expand
 * fractal tree of the delegation chain for each trace.
 *
 * Each row shows:
 *  - depth (indented)
 *  - span_name (jarble.chat.turn / jarble.delegation.hop / etc)
 *  - skill_name
 *  - status badge (completed / failed / abandoned / pending)
 *  - duration (ms)
 *  - caller → callee (as short deployment ids)
 *  - link to Langfuse trace if LANGFUSE_HOST is exposed (optional)
 *
 * The debug drawer is ONLY shown to authed users who own the deployment
 * (the tRPC procedures enforce this). We still gate rendering on
 * deployment.status so a fresh deployment doesn't show empty state forever.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { X, Activity, ChevronDown, ChevronRight, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DebugTracePanelProps {
  deploymentId: string;
  onClose: () => void;
}

type TraceRow = {
  traceId: string | null;
  rootCallId: string;
  kind: string | null;
  skillName: string | null;
  spanName: string | null;
  status: string | null;
  durationMs: number | null;
  createdAt: Date | string | null;
  callerDeploymentId: string | null;
  calleeDeploymentId: string | null;
  spanCount: number;
  maxDepth: number;
  totalCredits: number;
};

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
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

function statusClass(status: string | null): string {
  switch (status) {
    case "completed": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "failed": return "bg-rose-500/10 text-rose-400 border-rose-500/20";
    case "abandoned": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "pending": return "bg-sky-500/10 text-sky-400 border-sky-500/20";
    default: return "bg-muted text-muted-foreground border-border/40";
  }
}

function TraceTreeRow({ row, depth }: { row: {
  id: string;
  parentCallId: string | null;
  kind: string | null;
  skillName: string | null;
  spanName: string | null;
  depth: number;
  status: string | null;
  durationMs: number | null;
  callerDeploymentId: string | null;
  calleeDeploymentId: string | null;
  creditsCharged?: number | null;
}; depth: number }) {
  const cost = formatCost(row.creditsCharged);
  return (
    <div
      className="flex items-center gap-2 py-1 text-xs"
      style={{ paddingLeft: `${depth * 16}px` }}
    >
      <span className="text-muted-foreground font-mono">{depth}</span>
      <span className="text-foreground font-medium truncate max-w-[180px]">
        {row.spanName || row.skillName || row.kind || "span"}
      </span>
      <span className={cn("px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide", statusClass(row.status))}>
        {row.status}
      </span>
      {cost && <span className="text-amber-400 font-mono text-[10px]">{cost}</span>}
      <span className="text-muted-foreground ml-auto">{formatDuration(row.durationMs)}</span>
    </div>
  );
}

function ExpandedTrace({ traceId }: { traceId: string }) {
  const query = trpc.deployment.getAgentCallsByTrace.useQuery(
    { traceId },
    { staleTime: 30_000 },
  );
  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" /> loading tree…
      </div>
    );
  }
  if (query.isError) {
    return <div className="py-2 px-3 text-xs text-rose-400">Failed to load trace tree</div>;
  }
  const rows = query.data?.rows ?? [];
  if (rows.length === 0) {
    return <div className="py-2 px-3 text-xs text-muted-foreground">No spans in this trace.</div>;
  }
  return (
    <div className="py-1 px-3 bg-secondary/10 border-t border-border/30">
      {rows.map((r) => (
        <TraceTreeRow key={r.id} row={r} depth={r.depth ?? 0} />
      ))}
    </div>
  );
}

export default function DebugTracePanel({ deploymentId, onClose }: DebugTracePanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const query = trpc.deployment.listRecentTraces.useQuery(
    { id: deploymentId, limit: 25 },
    {
      // Traces update often — 10s stale is reasonable for a debug panel
      staleTime: 10_000,
      refetchInterval: 15_000,
    },
  );

  const traces = (query.data?.traces ?? []) as TraceRow[];
  const isLoading = query.isLoading;
  const isError = query.isError;

  const toggle = (traceId: string | null) => {
    if (!traceId) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(traceId)) next.delete(traceId);
      else next.add(traceId);
      return next;
    });
  };

  // Langfuse deep-link base URL — optional; only renders when the env
  // var is exposed via NEXT_PUBLIC_LANGFUSE_UI_URL. No sensitive info.
  const langfuseBase = process.env.NEXT_PUBLIC_LANGFUSE_UI_URL;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-4 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">Debug Traces</div>
            <div className="text-xs text-muted-foreground">Recent delegation + chat activity</div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-7 w-7 p-0"
          aria-label="Close debug panel"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="px-4 py-3">
        {isLoading && (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" /> loading traces…
          </div>
        )}
        {isError && (
          <div className="py-4 text-xs text-rose-400">Failed to load traces</div>
        )}
        {!isLoading && !isError && traces.length === 0 && (
          <div className="py-8 text-center">
            <Activity className="w-6 h-6 mx-auto text-muted-foreground/40 mb-2" />
            <div className="text-xs text-muted-foreground">
              No recent traces. Try chatting with the bot or delegating a task.
            </div>
          </div>
        )}
        {!isLoading && traces.length > 0 && (
          <div className="space-y-1">
            {traces.map((t) => {
              const isExpanded = t.traceId ? expanded.has(t.traceId) : false;
              return (
                <div key={t.rootCallId} className="rounded border border-border/40 bg-secondary/20 overflow-hidden">
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-secondary/30 flex items-center gap-2"
                    onClick={() => toggle(t.traceId)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium truncate">
                          {t.spanName || t.skillName || t.kind || "trace"}
                        </span>
                        <span className={cn("px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide shrink-0", statusClass(t.status))}>
                          {t.status}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2 font-mono">
                        <span>trace:{truncate(t.traceId, 12)}</span>
                        <span>•</span>
                        <span>{t.spanCount} spans</span>
                        <span>•</span>
                        <span>depth {t.maxDepth}</span>
                        <span>•</span>
                        <span>{formatDuration(t.durationMs)}</span>
                        {t.totalCredits > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-amber-400">{formatCost(t.totalCredits)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {langfuseBase && t.traceId && (
                      <a
                        href={`${langfuseBase.replace(/\/+$/, "")}/traces/${t.traceId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 shrink-0"
                      >
                        Langfuse <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </button>
                  {isExpanded && t.traceId && <ExpandedTrace traceId={t.traceId} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

/**
 * DebugTracePanel — shows recent agent_calls trees for this deployment.
 *
 * Each trace expands into a tree of delegation hops. Each hop is expandable
 * to show the full task/response content, deployment names, per-span
 * Langfuse links, and copy buttons.
 */

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
  X, Activity, ChevronDown, ChevronRight, Loader2, ExternalLink,
  Copy, Check, ArrowRight,
} from "lucide-react";
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

function statusClass(status: string | null): string {
  switch (status) {
    case "completed": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "failed": return "bg-rose-500/10 text-rose-400 border-rose-500/20";
    case "abandoned": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "pending": return "bg-sky-500/10 text-sky-400 border-sky-500/20";
    default: return "bg-muted text-muted-foreground border-border/40";
  }
}

function statusBorderClass(status: string | null): string {
  switch (status) {
    case "completed": return "border-l-emerald-500/40";
    case "failed": return "border-l-rose-500/40";
    case "pending": return "border-l-sky-500/40";
    default: return "border-l-border/40";
  }
}

/** Extract the task text from requestBody (may be JSON with a .task field or plain text) */
function extractTask(requestBody: string | null): string | null {
  if (!requestBody) return null;
  try {
    const parsed = JSON.parse(requestBody);
    return parsed.task || parsed.message || requestBody;
  } catch {
    return requestBody;
  }
}

/** Copy text to clipboard with visual feedback */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

// ── Deployment name cache (avoids N+1 queries) ─────────────────────────────

const deploymentNameCache = new Map<string, string>();

function useDeploymentNames(ids: string[]) {
  // Batch-fetch deployment names for all unique IDs in the trace
  const unique = [...new Set(ids.filter(Boolean))];
  const missing = unique.filter((id) => !deploymentNameCache.has(id));

  // Only fetch if we have missing IDs
  const listQuery = trpc.deployment.list.useQuery(undefined, {
    staleTime: 60_000,
    enabled: missing.length > 0,
  });

  if (listQuery.data) {
    for (const dep of listQuery.data as any[]) {
      deploymentNameCache.set(dep.id, dep.name);
    }
  }

  return (id: string | null) => {
    if (!id) return "unknown";
    return deploymentNameCache.get(id) || id.slice(0, 8);
  };
}

// ── Expandable trace tree row ───────────────────────────────────────────────

function TraceTreeRow({ row, depth, langfuseBase, getName }: {
  row: {
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
    traceId: string | null;
    spanId?: string | null;
    requestBody?: string | null;
    responseBody?: string | null;
    errorMessage?: string | null;
    creditsCharged?: number | null;
  };
  depth: number;
  langfuseBase?: string;
  getName: (id: string | null) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = !!(row.requestBody || row.responseBody || row.errorMessage);
  const task = extractTask(row.requestBody ?? null);
  const callerName = getName(row.callerDeploymentId);
  const calleeName = getName(row.calleeDeploymentId);
  const showRoute = row.callerDeploymentId && row.calleeDeploymentId && row.callerDeploymentId !== row.calleeDeploymentId;

  return (
    <div className={cn("border-l-2 ml-1", statusBorderClass(row.status))} style={{ marginLeft: `${depth * 12}px` }}>
      <button
        className={cn(
          "w-full text-left px-2 py-1.5 flex items-center gap-1.5 text-xs hover:bg-secondary/30 transition-colors",
          hasContent ? "cursor-pointer" : "cursor-default"
        )}
        onClick={() => hasContent && setExpanded(!expanded)}
      >
        {hasContent ? (
          expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        ) : (
          <span className="w-3 shrink-0" />
        )}

        <span className="text-foreground font-medium truncate max-w-[140px]">
          {row.spanName || row.skillName || row.kind || "span"}
        </span>

        <span className={cn("px-1 py-0 rounded border text-[9px] uppercase tracking-wide shrink-0", statusClass(row.status))}>
          {row.status}
        </span>

        {showRoute && (
          <span className="text-[9px] text-muted-foreground flex items-center gap-0.5 shrink-0">
            {callerName} <ArrowRight className="w-2.5 h-2.5" /> {calleeName}
          </span>
        )}

        <span className="text-muted-foreground ml-auto shrink-0">{formatDuration(row.durationMs)}</span>

        {row.creditsCharged != null && row.creditsCharged > 0 && (
          <span className="text-amber-400 text-[9px] shrink-0">${(row.creditsCharged / 100).toFixed(2)}</span>
        )}

        {langfuseBase && row.spanId && row.traceId && (
          <a
            href={`${langfuseBase.replace(/\/+$/, "")}/traces/${row.traceId}?observation=${row.spanId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:text-foreground shrink-0"
            title="View in Langfuse"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </button>

      {expanded && hasContent && (
        <div className="px-3 py-2 bg-secondary/10 border-t border-border/20 space-y-2 text-[11px]">
          {task && (
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-sky-400">Task</span>
                <CopyButton text={task} />
              </div>
              <pre className="whitespace-pre-wrap break-words text-foreground/80 font-mono bg-background/50 rounded px-2 py-1.5 max-h-[120px] overflow-y-auto">
                {task}
              </pre>
            </div>
          )}
          {row.responseBody && (
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-400">Response</span>
                <CopyButton text={row.responseBody} />
              </div>
              <pre className="whitespace-pre-wrap break-words text-foreground/80 font-mono bg-background/50 rounded px-2 py-1.5 max-h-[200px] overflow-y-auto">
                {row.responseBody}
              </pre>
            </div>
          )}
          {row.errorMessage && (
            <div>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-rose-400">Error</span>
              <pre className="whitespace-pre-wrap break-words text-rose-300/80 font-mono bg-rose-500/5 rounded px-2 py-1.5 mt-1">
                {row.errorMessage}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Expanded trace tree ─────────────────────────────────────────────────────

function ExpandedTrace({ traceId, langfuseBase }: { traceId: string; langfuseBase?: string }) {
  const query = trpc.deployment.getAgentCallsByTrace.useQuery(
    { traceId },
    { staleTime: 5_000, refetchInterval: 3_000 },
  );

  // Collect deployment IDs for name resolution
  const allIds: string[] = [];
  if (query.data?.rows) {
    for (const r of query.data.rows) {
      if (r.callerDeploymentId) allIds.push(r.callerDeploymentId);
      if (r.calleeDeploymentId) allIds.push(r.calleeDeploymentId);
    }
  }
  const getName = useDeploymentNames(allIds);

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
    <div className="py-1 px-1 bg-secondary/10 border-t border-border/30">
      {rows.map((r: any) => (
        <TraceTreeRow key={r.id} row={r} depth={r.depth ?? 0} langfuseBase={langfuseBase} getName={getName} />
      ))}
    </div>
  );
}

// ── Main panel ──────────────────────────────────────────────────────────────

export default function DebugTracePanel({ deploymentId, onClose }: DebugTracePanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const depQuery = trpc.deployment.getById.useQuery({ id: deploymentId }, { staleTime: 30_000 });
  const maxBudgetCents = (depQuery.data as any)?.maxBudgetCents as number | null | undefined;

  const query = trpc.deployment.listRecentTraces.useQuery(
    { id: deploymentId, limit: 25 },
    { staleTime: 5_000, refetchInterval: 5_000 },
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

  const langfuseBase = process.env.NEXT_PUBLIC_LANGFUSE_UI_URL;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-4 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">Debug Traces</div>
            <div className="text-xs text-muted-foreground">
              Recent delegation + chat activity
              {maxBudgetCents != null && (
                <span className="ml-2 text-amber-400">
                  Budget: ${(maxBudgetCents / 100).toFixed(2)}/turn
                </span>
              )}
            </div>
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
              No recent traces. Try chatting with the agent or delegating a task.
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
                        {(t as any).totalCredits > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-amber-400">${((t as any).totalCredits / 100).toFixed(2)}</span>
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
                  {isExpanded && t.traceId && <ExpandedTrace traceId={t.traceId} langfuseBase={langfuseBase} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

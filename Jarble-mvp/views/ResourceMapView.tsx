"use client";

import { useMemo, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type EdgeProps,
  Handle,
  Position,
  ReactFlowProvider,
  BaseEdge,
  getBezierPath,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Bot, Key, Cpu, MessageSquare, Zap, Network, X } from "lucide-react";
import { motion } from "framer-motion";
import ErrorBoundary from "@/components/ErrorBoundary";
import { trpc } from "@/lib/trpc";

// ─── Types ────────────────────────────────────────────────────────────

interface DeploymentData {
  id: string;
  name: string;
  status: string;
  runtime: string;
  description: string | null;
  llmMode: string;
  llmApiKeyId: string | null;
  llmApiKeySourceDeploymentId: string | null;
  llmCreditLimitDollars: number | null;
}

type ResourceEdgeType =
  | "api_key_share"
  | "agent_call"
  | "flow_connection"
  | "shared_platform"
  | "shared_secret";

interface ResourceMapNodeData extends DeploymentData {
  [key: string]: unknown;
}

interface ResourceMapEdgeData {
  edgeType: ResourceEdgeType;
  label: string;
  active: boolean;
  /**
   * When multiple underlying relationships exist between the same pair of
   * deployments (e.g. a shared flow AND an agent_call AND a shared API key),
   * they're merged into a single composite edge. `relationships` holds the
   * individual rows so the edge label can show a count and the hover tooltip
   * can expand them. `edgeType` on the composite is the highest-priority type
   * in the set, which determines the visual color and dash pattern.
   */
  relationships?: Array<{ edgeType: ResourceEdgeType; label: string }>;
  [key: string]: unknown;
}

/**
 * Priority ordering for merging composite edges. When a pair of deployments
 * has multiple relationships, the HIGHEST-priority type (lowest index) wins
 * for visual styling — it picks the edge color, dash array, and the primary
 * label. The full set of underlying relationships is preserved in
 * `ResourceMapEdgeData.relationships` for the hover tooltip.
 *
 * Order rationale: flows represent the most structural / permanent
 * relationship between bots, followed by API key sharing (billing coupling),
 * then agent calls (runtime behavior), then platform/secret sharing
 * (loose config coupling).
 */
const EDGE_TYPE_PRIORITY: ResourceEdgeType[] = [
  "flow_connection",
  "api_key_share",
  "agent_call",
  "shared_platform",
  "shared_secret",
];

function pickPriorityType(types: ResourceEdgeType[]): ResourceEdgeType {
  for (const t of EDGE_TYPE_PRIORITY) {
    if (types.includes(t)) return t;
  }
  return types[0] ?? "agent_call";
}

// ─── Edge type config ─────────────────────────────────────────────────

const EDGE_CONFIG: Record<
  ResourceEdgeType,
  { color: string; label: string; dashArray: string }
> = {
  api_key_share: {
    color: "#22c55e",
    label: "Shared API Key",
    dashArray: "0", // solid
  },
  agent_call: {
    color: "#a855f7",
    label: "Agent Call",
    dashArray: "8 4", // dashed
  },
  flow_connection: {
    color: "#3b82f6",
    label: "Flow",
    dashArray: "0", // solid
  },
  shared_platform: {
    color: "#f97316",
    label: "Shared Platform",
    dashArray: "2 4", // dotted
  },
  shared_secret: {
    color: "#ec4899",
    label: "Shared Secret",
    dashArray: "4 2", // short dash
  },
};

// ─── Status helpers ───────────────────────────────────────────────────

function statusDotClass(status: string): string {
  switch (status) {
    case "running":
      return "bg-emerald-500";
    case "creating":
    case "restarting":
      return "bg-amber-400";
    case "stopping":
      return "bg-orange-400";
    case "stopped":
      return "bg-muted-foreground";
    case "failed":
      return "bg-red-500";
    default:
      return "bg-muted-foreground";
  }
}

function statusRingClass(status: string): string {
  switch (status) {
    case "running":
      return "ring-emerald-500/30";
    case "creating":
    case "restarting":
      return "ring-amber-400/30";
    case "failed":
      return "ring-red-500/30";
    default:
      return "";
  }
}

function isAnimatedStatus(status: string): boolean {
  return ["running", "creating", "restarting", "stopping"].includes(status);
}

function runtimeLabel(runtime: string): string {
  if (runtime.toLowerCase().includes("openclaw")) return "OpenClaw";
  if (runtime.toLowerCase().includes("zeroclaw")) return "ZeroClaw";
  return runtime;
}

function llmLabel(mode: string): string {
  switch (mode) {
    case "included":
      return "Included";
    case "byok":
      return "BYOK";
    case "linked":
      return "Linked";
    default:
      return mode;
  }
}

// ─── Dagre layout ─────────────────────────────────────────────────────

const RESOURCE_NODE_WIDTH = 200;
const RESOURCE_NODE_HEIGHT = 100;

function layoutResourceGraph<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[],
): { nodes: Node<T>[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    nodesep: 120,
    ranksep: 140,
    marginx: 60,
    marginy: 60,
  });

  for (const node of nodes) {
    g.setNode(node.id, {
      width: RESOURCE_NODE_WIDTH,
      height: RESOURCE_NODE_HEIGHT,
    });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) {
      return { ...node, position: node.position ?? { x: 0, y: 0 } };
    }
    return {
      ...node,
      position: {
        x: pos.x - RESOURCE_NODE_WIDTH / 2,
        y: pos.y - RESOURCE_NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ─── Custom Resource Map Node ─────────────────────────────────────────

function ResourceMapNode({
  data,
  selected,
}: {
  data: ResourceMapNodeData;
  selected?: boolean;
}) {
  const animated = isAnimatedStatus(data.status);
  const ringClass = statusRingClass(data.status);

  return (
    <div
      className={`
        w-[200px] rounded-xl border bg-card shadow-sm transition-all cursor-pointer group
        hover:shadow-lg hover:border-primary/40
        ${selected ? "border-primary ring-2 ring-primary/30 shadow-md" : "border-border"}
        ${animated && ringClass ? `ring-2 ${ringClass}` : ""}
      `}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-muted-foreground/40 !border-2 !border-card hover:!bg-primary !transition-colors"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-muted-foreground/40 !border-2 !border-card hover:!bg-primary !transition-colors"
      />

      <div className="p-3">
        {/* Top row: icon + name + status dot */}
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate leading-tight">
              {data.name}
            </p>
          </div>
          <div className="relative shrink-0">
            <div
              className={`w-2.5 h-2.5 rounded-full ${statusDotClass(data.status)} ${animated ? "animate-pulse" : ""}`}
            />
          </div>
        </div>

        {/* Badges row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 h-5 font-medium"
          >
            <Cpu className="w-2.5 h-2.5 mr-0.5" />
            {runtimeLabel(data.runtime)}
          </Badge>
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 h-5 font-medium"
          >
            <Key className="w-2.5 h-2.5 mr-0.5" />
            {llmLabel(data.llmMode)}
          </Badge>
        </div>
      </div>
    </div>
  );
}

// ─── Custom Resource Edge ─────────────────────────────────────────────

function ResourceEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
}: EdgeProps) {
  const edgeData = data as ResourceMapEdgeData | undefined;
  const edgeType = edgeData?.edgeType ?? "api_key_share";
  const config = EDGE_CONFIG[edgeType];
  const isActive = edgeData?.active ?? false;
  const label = edgeData?.label ?? config.label;
  const relationships = edgeData?.relationships ?? [];
  const isComposite = relationships.length > 1;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      {/* Glow effect for active edges */}
      {isActive && (
        <BaseEdge
          id={`${id}-glow`}
          path={edgePath}
          style={{
            stroke: config.color,
            strokeWidth: 8,
            strokeOpacity: 0.12,
            strokeDasharray: config.dashArray !== "0" ? config.dashArray : undefined,
          }}
        />
      )}

      {/* Main edge */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: config.color,
          // Composite edges get a slightly thicker stroke so users can see
          // at a glance that the line represents multiple relationships.
          strokeWidth: isActive ? 2.5 : isComposite ? 2.5 : 2,
          strokeDasharray: config.dashArray !== "0" ? config.dashArray : undefined,
          animation:
            isActive && config.dashArray !== "0"
              ? "resource-dash 1s linear infinite"
              : undefined,
        }}
      />

      {/* Edge label — composite edges get a hover tooltip listing all the
          underlying relationships so the "3 connections" count is expandable
          into a concrete list (e.g. "Flow: Main Team", "Shared API Key",
          "Agent Call"). Single-relationship edges skip the tooltip. */}
      <foreignObject
        x={labelX - 80}
        y={labelY - 14}
        width={160}
        height={28}
        className="overflow-visible"
        style={{ pointerEvents: isComposite ? "auto" : "none" }}
      >
        <div className="flex items-center justify-center">
          {isComposite ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur-sm border cursor-help inline-flex items-center gap-1"
                  style={{
                    color: config.color,
                    backgroundColor: `${config.color}15`,
                    borderColor: `${config.color}40`,
                  }}
                >
                  <span
                    className="inline-flex items-center justify-center rounded-full text-[9px] font-semibold w-4 h-4"
                    style={{
                      backgroundColor: `${config.color}30`,
                      color: config.color,
                    }}
                  >
                    {relationships.length}
                  </span>
                  {label}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px] text-[11px] leading-relaxed">
                <div className="font-semibold mb-1">
                  {relationships.length} relationships between these bots
                </div>
                <ul className="space-y-0.5">
                  {relationships.map((r, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: EDGE_CONFIG[r.edgeType].color }}
                      />
                      <span>{r.label}</span>
                    </li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur-sm border"
              style={{
                color: config.color,
                backgroundColor: `${config.color}10`,
                borderColor: `${config.color}30`,
              }}
            >
              {label}
            </span>
          )}
        </div>
      </foreignObject>
    </>
  );
}

// ─── Node/Edge type registrations ─────────────────────────────────────

const resourceNodeTypes: NodeTypes = {
  resourceNode: ResourceMapNode,
};

const resourceEdgeTypes: EdgeTypes = {
  resourceEdge: ResourceEdge,
};

// ─── Legend ────────────────────────────────────────────────────────────

function ResourceMapLegend() {
  return (
    <div className="absolute bottom-4 left-4 z-10 bg-card/95 backdrop-blur-sm border border-border rounded-xl p-3 shadow-lg">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
        Relationships
      </p>
      <div className="space-y-1.5">
        {(
          Object.entries(EDGE_CONFIG) as [
            ResourceEdgeType,
            (typeof EDGE_CONFIG)[ResourceEdgeType],
          ][]
        ).map(([type, config]) => (
          <div key={type} className="flex items-center gap-2">
            <svg width="28" height="8" className="shrink-0">
              <line
                x1="0"
                y1="4"
                x2="28"
                y2="4"
                stroke={config.color}
                strokeWidth="2"
                strokeDasharray={
                  config.dashArray !== "0" ? config.dashArray : undefined
                }
              />
            </svg>
            <span className="text-[11px] text-muted-foreground">
              {config.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Build edges from deployment data ─────────────────────────────────

function buildResourceEdges(deployments: DeploymentData[]): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();

  for (const dep of deployments) {
    // API key sharing edges
    if (dep.llmApiKeySourceDeploymentId) {
      const sourceExists = deployments.some(
        (d) => d.id === dep.llmApiKeySourceDeploymentId,
      );
      if (sourceExists) {
        const edgeId = `apikey-${dep.llmApiKeySourceDeploymentId}-${dep.id}`;
        if (!seen.has(edgeId)) {
          seen.add(edgeId);
          edges.push({
            id: edgeId,
            source: dep.llmApiKeySourceDeploymentId,
            target: dep.id,
            type: "resourceEdge",
            data: {
              edgeType: "api_key_share" as ResourceEdgeType,
              label: "Shared API Key",
              active: dep.status === "running",
            } satisfies ResourceMapEdgeData,
          });
        }
      }
    }

    // Shared LLM API key edges: deployments sharing the same llmApiKeyId
    if (dep.llmApiKeyId && !dep.llmApiKeySourceDeploymentId) {
      for (const other of deployments) {
        if (
          other.id !== dep.id &&
          other.llmApiKeyId === dep.llmApiKeyId &&
          !other.llmApiKeySourceDeploymentId &&
          other.id > dep.id // avoid duplicates
        ) {
          const edgeId = `samekey-${dep.id}-${other.id}`;
          if (!seen.has(edgeId)) {
            seen.add(edgeId);
            edges.push({
              id: edgeId,
              source: dep.id,
              target: other.id,
              type: "resourceEdge",
              data: {
                edgeType: "api_key_share" as ResourceEdgeType,
                label: "Same API Key",
                active:
                  dep.status === "running" && other.status === "running",
              } satisfies ResourceMapEdgeData,
            });
          }
        }
      }
    }

    // Shared runtime edges: group deployments on the same runtime
    // (only show if 3+ deployments share the same runtime to avoid noise)
    // This is handled at the graph level instead
  }

  return edges;
}

// ─── Inner graph (requires ReactFlowProvider) ─────────────────────────

function DeploymentEnvPanel({ deploymentId, deployment, onClose, sharedSecretKeys }: {
  deploymentId: string;
  deployment: DeploymentData;
  onClose: () => void;
  sharedSecretKeys?: string[];
}) {
  const router = useRouter();
  const envQuery = trpc.deployment.getById.useQuery({ id: deploymentId }, { staleTime: 30_000 });
  const envVarQuery = trpc.deployment.getEnvVarMap.useQuery({ id: deploymentId }, { staleTime: 30_000 });
  const dep = envQuery.data as any;
  const allVars = envVarQuery.data?.vars ?? [];
  const botVars = allVars.filter((v: any) => v.visible === "bot");
  const systemVars = allVars.filter((v: any) => v.visible === "system");
  return (
    <div className="absolute top-0 right-0 bottom-0 w-80 bg-card/98 backdrop-blur-md border-l border-border z-20 overflow-y-auto shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <div>
          <h3 className="text-sm font-semibold">{deployment.name}</h3>
          <p className="text-[10px] text-muted-foreground">{deployment.runtime} &middot; {deployment.status}</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Environment</p>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between py-1 border-b border-border/30">
              <span className="text-muted-foreground">LLM Mode</span>
              <span className="font-medium">{dep?.llmMode ?? deployment.llmMode ?? "—"}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/30">
              <span className="text-muted-foreground">Provider</span>
              <span className="font-medium">{dep?.llmProvider ?? "—"}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/30">
              <span className="text-muted-foreground">Model</span>
              <span className="font-medium">{dep?.llmModel ?? "auto"}</span>
            </div>
            {dep?.llmApiKeySourceDeploymentId && (
              <div className="flex justify-between py-1 border-b border-border/30">
                <span className="text-muted-foreground">API Key From</span>
                <span className="font-medium text-emerald-400">{dep.llmApiKeySourceDeploymentId.slice(0, 12)}...</span>
              </div>
            )}
            <div className="flex justify-between py-1 border-b border-border/30">
              <span className="text-muted-foreground">Memory Scope</span>
              <span className="font-medium">{dep?.memoryScope ?? "global"}</span>
            </div>
            {dep?.maxBudgetCents != null && (
              <div className="flex justify-between py-1 border-b border-border/30">
                <span className="text-muted-foreground">Budget Cap</span>
                <span className="font-medium text-amber-400">${(dep.maxBudgetCents / 100).toFixed(2)}/turn</span>
              </div>
            )}
            <div className="flex justify-between py-1 border-b border-border/30">
              <span className="text-muted-foreground">CPU / Memory</span>
              <span className="font-medium">{dep?.cpuLimit ?? "—"} / {dep?.memoryMb ? `${dep.memoryMb}MB` : "—"}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/30">
              <span className="text-muted-foreground">Storage</span>
              <span className="font-medium">{dep?.storageMb ? `${(dep.storageMb / 1024).toFixed(1)}GB` : "—"}</span>
            </div>
          </div>
        </div>
        {/* Bot-visible env vars (the bot can access these) */}
        {botVars.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              Bot Environment ({botVars.length})
            </p>
            <div className="space-y-1 text-xs">
              {botVars.map((v: any) => (
                <div key={v.key} className="flex items-center justify-between py-1 border-b border-border/30">
                  <div className="flex items-center gap-1.5">
                    <Key className={`w-3 h-3 shrink-0 ${v.source === "user" || v.source === "agent" ? "text-amber-400" : "text-emerald-400"}`} />
                    <span className="font-mono text-[11px]">{v.key}</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    v.source === "user" ? "bg-amber-500/10 text-amber-400" :
                    v.source === "agent" ? "bg-purple-500/10 text-purple-400" :
                    "bg-emerald-500/10 text-emerald-400"
                  }`}>{v.source}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* System env vars (bot can't see, used by runtime) */}
        {systemVars.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              System Credentials ({systemVars.length})
            </p>
            <div className="space-y-1 text-xs">
              {systemVars.map((v: any) => (
                <div key={v.key} className="flex items-center justify-between py-1 border-b border-border/30 opacity-60">
                  <div className="flex items-center gap-1.5">
                    <Key className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="font-mono text-[11px]">{v.key}</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{v.source}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">System credentials are used by the runtime. The bot cannot read these directly.</p>
          </div>
        )}

        {allVars.length === 0 && !envVarQuery.isLoading && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Credentials</p>
            <p className="text-[10px] text-muted-foreground">No credentials configured.</p>
          </div>
        )}

        {/* Shared secret key names (never values) */}
        {sharedSecretKeys && sharedSecretKeys.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Shared Secrets</p>
            <div className="flex flex-wrap gap-1">
              {sharedSecretKeys.map((k) => (
                <span key={k} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-pink-500/10 text-pink-400 border border-pink-500/20">
                  {k}
                </span>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => router.push(`/d/${deploymentId}`)}
          className="w-full text-xs font-medium py-2 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          Open Deployment
        </button>
      </div>
    </div>
  );
}

function ResourceMapGraph({
  deployments,
}: {
  deployments: DeploymentData[];
}) {
  const router = useRouter();
  const { fitView } = useReactFlow();
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);

  // Fetch server-side resource graph (flow connections, agent calls, platform + secret sharing)
  const graphQuery = trpc.deployment.getResourceGraph.useQuery(undefined, { staleTime: 30_000 });
  const serverEdges = graphQuery.data?.edges ?? [];

  const { nodes, edges, hasEdges } = useMemo(() => {
    // Client-side edges (API key sharing from deployment data)
    const clientEdges = buildResourceEdges(deployments);

    // Merge server-side edges (flow, agent_call, platform, secret) with client
    // edges. Filter:
    //   1. Dangling references to deployments not in the current list
    //   2. Self-loops (source === target) — these render as strands that
    //      go nowhere and add visual noise. The Resource Map is about
    //      inter-deployment connections; a bot calling itself isn't one.
    const depIdSet = new Set(deployments.map((d) => d.id));
    const mergedServerEdges: Edge[] = serverEdges
      .filter(
        (e: any) =>
          depIdSet.has(e.source) &&
          depIdSet.has(e.target) &&
          e.source !== e.target,
      )
      .map((e: any, i: number) => {
        const edgeType = (e.type || "api_key_share") as ResourceEdgeType;
        const config = EDGE_CONFIG[edgeType] || EDGE_CONFIG.api_key_share;
        return {
          id: `server-${edgeType}-${e.source}-${e.target}-${i}`,
          source: e.source,
          target: e.target,
          type: "resourceEdge",
          data: {
            edgeType,
            label: e.secretKey ? `Secret: ${e.secretKey}` : e.flowName ? `Flow: ${e.flowName}` : config.label,
            active: false,
          } satisfies ResourceMapEdgeData,
        };
      });

    // Combine client and server edges, also filtering client self-loops
    // defensively (shouldn't happen, but the client builder has no explicit
    // guard either).
    const rawEdges = [...clientEdges, ...mergedServerEdges].filter(
      (e) => e.source !== e.target,
    );

    // Merge edges by UNORDERED pair. The Resource Map displays relationships,
    // not directed calls, so drawing two curves for A→B and B→A creates
    // visual noise that doesn't convey information. Collapse both directions
    // into a single edge keyed by `min(a,b)|max(a,b)` so the pair renders as
    // one line with the union of relationship types on it.
    //
    // The merged edge picks its color/style from the HIGHEST-PRIORITY type
    // (see EDGE_TYPE_PRIORITY) and preserves the full relationship list in
    // `data.relationships` so the hover tooltip can expand it.
    //
    // Before Cycle 16 follow-up: a 4-node team with a Main Team flow was
    // rendering as 7 strands (agent_call both directions + flow_connection
    // + a self-loop). After this merge + the self-loop filter: 3 clean
    // lines, one per actual relationship pair.
    const pairMap = new Map<string, Edge[]>();
    for (const edge of rawEdges) {
      const [a, b] = [edge.source, edge.target].sort();
      const pairKey = `${a}|${b}`;
      const bucket = pairMap.get(pairKey) ?? [];
      bucket.push(edge);
      pairMap.set(pairKey, bucket);
    }

    const allEdges: Edge[] = [];
    for (const [pairKey, bucket] of pairMap) {
      if (bucket.length === 0) continue;
      const [a, b] = pairKey.split("|");
      // Gather the unique relationship types + labels. De-dupe by
      // type+label pair so two identical agent_call edges (A→B and B→A)
      // don't show up twice in the tooltip.
      const seen = new Set<string>();
      const relationships: Array<{ edgeType: ResourceEdgeType; label: string }> = [];
      for (const e of bucket) {
        const d = e.data as ResourceMapEdgeData | undefined;
        if (!d) continue;
        const key = `${d.edgeType}|${d.label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        relationships.push({ edgeType: d.edgeType, label: d.label });
      }
      if (relationships.length === 0) continue;

      const types = relationships.map((r) => r.edgeType);
      const priorityType = pickPriorityType(types);
      const anyActive = bucket.some(
        (e) => (e.data as ResourceMapEdgeData | undefined)?.active,
      );

      // Build the primary label:
      //   1 relationship  → the single label ("Shared API Key", "Flow: Main Team")
      //   2+ relationships → a count ("3 connections") so the edge pill stays compact
      const primaryLabel =
        relationships.length === 1
          ? relationships[0].label
          : `${relationships.length} connections`;

      allEdges.push({
        id: `merged-${pairKey}`,
        source: a,
        target: b,
        type: "resourceEdge",
        data: {
          edgeType: priorityType,
          label: primaryLabel,
          active: anyActive,
          relationships,
        } satisfies ResourceMapEdgeData,
      });
    }

    const nodeList: Node<ResourceMapNodeData>[] = deployments.map((dep) => ({
      id: dep.id,
      type: "resourceNode",
      position: { x: 0, y: 0 },
      data: { ...dep },
    }));

    if (nodeList.length === 0) {
      return { nodes: [], edges: [], hasEdges: false };
    }

    const layouted = layoutResourceGraph(nodeList, allEdges);
    return {
      nodes: layouted.nodes,
      edges: layouted.edges,
      hasEdges: allEdges.length > 0,
    };
  }, [deployments, serverEdges]);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node<ResourceMapNodeData>) => {
      setSelectedDeploymentId((prev) => prev === node.id ? null : node.id);
    },
    [],
  );

  const onInit = useCallback(() => {
    setTimeout(() => fitView({ padding: 0.4, maxZoom: 1 }), 50);
  }, [fitView]);

  // Empty state: fewer than 2 deployments or no edges
  if (deployments.length < 2 || !hasEdges) {
    return (
      <div className="flex items-center justify-center h-full">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-sm px-6"
        >
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
            <Network className="w-8 h-8 text-primary/60" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No resource connections yet
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Deploy more bots to see how they connect! Resource sharing happens
            automatically when you link API keys or create flows.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%" }} className="relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={resourceNodeTypes}
        edgeTypes={resourceEdgeTypes}
        onInit={onInit}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.4, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={true}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable={true}
        deleteKeyCode={null}
      >
        <Background gap={20} size={1} className="!bg-background" />
        <Controls
          showInteractive={false}
          className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-secondary"
        />
        <MiniMap
          nodeColor={() => "hsl(var(--primary))"}
          maskColor="hsl(var(--background) / 0.8)"
          className="!bg-card !border-border !shadow-md !rounded-xl"
          pannable
          zoomable
        />
      </ReactFlow>
      <ResourceMapLegend />

      {/* Env var detail panel — slides in when a node is clicked */}
      {selectedDeploymentId && (() => {
        const dep = deployments.find((d) => d.id === selectedDeploymentId);
        if (!dep) return null;
        // Extract shared secret keys for this deployment from server edges
        const secretKeys = serverEdges
          .filter((e: any) => e.type === "shared_secret" && (e.source === selectedDeploymentId || e.target === selectedDeploymentId))
          .map((e: any) => e.secretKey)
          .filter(Boolean);
        return (
          <DeploymentEnvPanel
            deploymentId={selectedDeploymentId}
            deployment={dep}
            onClose={() => setSelectedDeploymentId(null)}
            sharedSecretKeys={[...new Set(secretKeys)]}
          />
        );
      })()}

      {/* CSS animation for dashed edge movement */}
      <style>{`
        @keyframes resource-dash {
          to {
            stroke-dashoffset: -12;
          }
        }
      `}</style>
    </div>
  );
}

// ─── Exported wrapper ─────────────────────────────────────────────────

export default function ResourceMapView({
  deployments,
}: {
  deployments: DeploymentData[];
}) {
  return (
    <div
      className="rounded-xl border border-border/60 overflow-hidden"
      style={{ height: "calc(100vh - 280px)", minHeight: "300px" }}
    >
      <ErrorBoundary>
        <ReactFlowProvider>
          <ResourceMapGraph deployments={deployments} />
        </ReactFlowProvider>
      </ErrorBoundary>
    </div>
  );
}

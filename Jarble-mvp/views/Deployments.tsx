"use client";

import { toast } from "sonner";
import { useAuth0 } from "@auth0/auth0-react";
import { useTheme } from "@/contexts/ThemeContext";
import Image from "next/image";
import { trpc, API_URL } from "@/lib/trpc";
import { vanillaClient } from "@/lib/trpc-vanilla";
import { useStatusStream } from "@/hooks/useStatusStream";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Layers,
  Crown,
  Link2,
  Key,
  Bot,
  Share2,
  X,
  ExternalLink,
  DollarSign,
  Play,
  Square,
  Save,
  Plus,
  LayoutGrid,
  GitBranch,
  CheckCircle2,
  XCircle,
  Circle,
  Pencil,
  Trash2,
  GripVertical,
  Coins,
  ChevronRight,
  RotateCcw,
  Pause,
  Send,
  Workflow,
  Star,
  ArrowRight,
  ArrowLeftRight,
  MessageSquare,
  Users,
  ChevronDown,
  ChevronUp,
  Network,
  Zap,
  Shield,
  Eye,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import ProfileDropdown from "@/components/ProfileDropdown";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import ErrorBoundary from "@/components/ErrorBoundary";
import ResourceMapView from "./ResourceMapView";
import FlowNodeConfigPanel from "@/components/workspace/FlowNodeConfigPanel";
import type { FlowNodeConfig } from "@/components/workspace/FlowNodeConfigPanel";
import FlowExecutionTimeline from "@/components/workspace/FlowExecutionTimeline";
import type { FlowExecutionStep } from "@/components/workspace/FlowExecutionTimeline";
import TeamChatCanvasCard, {
  type TeamCanvasCardData,
} from "@/components/workspace/TeamChatCanvasCard";
import { runtimeNeedsLlm } from "./onboarding/wizardStepConfig";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  Handle,
  Position,
  useReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  ReactFlowProvider,
  BaseEdge,
  getBezierPath,
  getStraightPath,
  EdgeLabelRenderer,
  type EdgeProps,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import {
  useFlowExecution,
  type FlowStepStatus,
} from "@/hooks/useFlowExecution";

// ─── Types ───────────────────────────────────────────────────────────

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

type DeploymentNodeData = DeploymentData & {
  nodeType: "owner" | "linked" | "standalone";
  [key: string]: unknown;
};

/** Edge type for orchestration edges */
type FlowEdgeType = "delegates" | "reports" | "collaborates";

/** Context scope for delegation */
type ContextScope = "task" | "summary" | "full";

/** Team topology type */
type TeamType = "hierarchy" | "pipeline" | "collaborative";

/** Data shape for nodes on the flow canvas */
type FlowNodeData = DeploymentData & {
  /** Role of this bot in the team */
  role?: string;
  /** Goal / mission for this bot */
  goal?: string;
  /** Whether this bot can delegate to connected bots */
  canDelegate?: boolean;
  /** Context scope for delegation from this node */
  contextScope?: ContextScope;
  /** Whether this is the entry point (user talks to this bot) */
  isEntryPoint?: boolean;
  /** Current execution status for this step */
  executionStatus?: FlowStepStatus["status"];
  /** Credits charged for this step in current execution */
  executionCredits?: number;
  /** Duration in ms for this step */
  executionDurationMs?: number;
  /** Error from execution */
  executionError?: string;
  /** Streaming inner text from a running deployment step */
  executionInnerText?: string;
  /** Whether this node is paused waiting for human input */
  executionPaused?: boolean;
  /** Current iteration for cycle/loop nodes */
  executionIteration?: number;
  /** Max iterations for cycle/loop nodes */
  executionMaxIterations?: number;
  /** Substeps for nested/subflow nodes */
  executionSubsteps?: FlowStepStatus[];
  /** Callback for resuming paused nodes */
  onResumeInput?: (input: string) => void;
  /** Capabilities: subagents and skills this deployment has */
  capabilities?: {
    supportsSubagents: boolean;
    subagents: Array<{ slug: string; name: string; source: string }>;
    skills: Array<{ name: string }>;
  };
  [key: string]: unknown;
};

/** Data shape for flow edges */
type FlowEdgeData = {
  /** Edge type: delegates, reports, or collaborates */
  edgeType?: FlowEdgeType;
  /** Execution status for animation */
  executionStatus?: FlowStepStatus["status"];
  [key: string]: unknown;
};

/** Shape returned by the tRPC flows.list / flows.getById API */
interface ApiFlow {
  id: string;
  name: string;
  description: string | null;
  definition: string; // JSON: { nodes: FlowNode[], edges: FlowEdge[] }
  status: string;
  isPublic: boolean;
  forkCount: number;
  forkedFromId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/** Parsed flow definition for the canvas UI */
interface FlowDefinition {
  id: string;
  name: string;
  description: string | null;
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  status: string;
  teamType: TeamType;
  createdAt: number;
  updatedAt: number;
}

/** Parse an API flow row into a FlowDefinition for the canvas */
function parseApiFlow(row: ApiFlow): FlowDefinition {
  let nodes: Node<FlowNodeData>[] = [];
  let edges: Edge[] = [];
  try {
    const def = JSON.parse(row.definition);
    nodes = Array.isArray(def.nodes)
      ? def.nodes.map((n: any) => {
          // Restore orchestration fields from config
          const config = n.config || {};
          return {
            ...n,
            type: "flowDeployment",
            data: {
              ...(n.data || {}),
              id: n.deploymentId || n.data?.id || n.id,
              name: n.label || n.data?.name || n.id,
              role: config.role || n.data?.role || "",
              goal: config.goal || n.data?.goal || "",
              canDelegate: config.canDelegate ?? n.data?.canDelegate ?? true,
              contextScope: config.contextScope || n.data?.contextScope || "task",
              isEntryPoint: config.isEntryPoint || n.data?.isEntryPoint || false,
            },
          };
        })
      : [];
    // Restore edge types from label field (where we store them)
    edges = Array.isArray(def.edges)
      ? def.edges.map((e: any) => ({
          ...e,
          data: {
            ...(e.data || {}),
            edgeType: e.label && ["delegates", "reports", "collaborates"].includes(e.label)
              ? e.label
              : (e.data?.edgeType || "delegates"),
          },
        }))
      : [];
  } catch {
    // Corrupted definition - treat as empty
  }
  // Extract teamType from definition or API row
  let teamType: TeamType = "hierarchy";
  try {
    const def = JSON.parse(row.definition);
    if (def.teamType && ["hierarchy", "pipeline", "collaborative"].includes(def.teamType)) {
      teamType = def.teamType;
    }
  } catch { /* ignore */ }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    nodes,
    edges,
    status: row.status,
    teamType,
    createdAt: new Date(row.createdAt).getTime(),
    updatedAt: new Date(row.updatedAt).getTime(),
  };
}

// ─── Status color mapping ────────────────────────────────────────────

function statusDotColor(status: string): string {
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
    case "pending":
    default:
      return "bg-muted-foreground";
  }
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    running: "Running",
    creating: "Starting",
    restarting: "Restarting",
    stopping: "Stopping",
    stopped: "Stopped",
    pending: "Pending",
    failed: "Failed",
  };
  return labels[status] || status;
}

function isAnimatedStatus(status: string): boolean {
  return ["running", "creating", "restarting", "stopping"].includes(status);
}

function llmModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    included: "Included Credits",
    byok: "BYOK (Own Key)",
    linked: "Linked to Pool",
  };
  return labels[mode] || mode;
}

// ─── Dagre layout ────────────────────────────────────────────────────

const NODE_WIDTH = 72;
const NODE_HEIGHT = 92;
const FLOW_NODE_W = 260;
const FLOW_NODE_H = 140;

function getLayoutedElements<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB",
  nodeWidth = NODE_WIDTH,
  nodeHeight = NODE_HEIGHT,
): { nodes: Node<T>[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: direction === "LR" ? 80 : 100,
    ranksep: direction === "LR" ? 160 : 100,
    marginx: 40,
    marginy: 40,
  });

  for (const node of nodes) {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - nodeWidth / 2,
        y: pos.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

/** Layout for flow canvas with team topology awareness */
function getFlowLayoutedElements(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  teamType: TeamType,
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges };

  if (teamType === "collaborative") {
    // Circular layout for collaborative teams
    const entryNode = nodes.find((n) => n.data?.isEntryPoint);
    const otherNodes = nodes.filter((n) => n.id !== entryNode?.id);
    const count = otherNodes.length;
    const radius = Math.max(200, count * 60);
    const cx = 400;
    const cy = 400;

    const layouted: Node<FlowNodeData>[] = [];

    // Entry node in center
    if (entryNode) {
      layouted.push({
        ...entryNode,
        position: { x: cx - FLOW_NODE_W / 2, y: cy - FLOW_NODE_H / 2 },
      });
    }

    // Other nodes in a circle
    otherNodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      layouted.push({
        ...node,
        position: {
          x: cx + radius * Math.cos(angle) - FLOW_NODE_W / 2,
          y: cy + radius * Math.sin(angle) - FLOW_NODE_H / 2,
        },
      });
    });

    return { nodes: layouted, edges };
  }

  // Hierarchy (TB) or Pipeline (LR)
  const direction = teamType === "pipeline" ? "LR" : "TB";
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: direction === "LR" ? 100 : 120,
    ranksep: direction === "LR" ? 200 : 160,
    marginx: 60,
    marginy: 60,
  });

  for (const node of nodes) {
    g.setNode(node.id, { width: FLOW_NODE_W, height: FLOW_NODE_H });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layouted = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - FLOW_NODE_W / 2,
        y: pos.y - FLOW_NODE_H / 2,
      },
    };
  });

  return { nodes: layouted, edges };
}

// ─── Execution status helpers ────────────────────────────────────────

function executionStatusColor(
  status?: FlowStepStatus["status"] | "paused"
): string {
  switch (status) {
    case "running":
      return "border-blue-500";
    case "paused":
      return "border-amber-500";
    case "completed":
      return "border-emerald-500";
    case "failed":
      return "border-red-500";
    case "skipped":
      return "border-stone-400";
    case "pending":
    default:
      return "border-border";
  }
}

function executionStatusRingColor(
  status?: FlowStepStatus["status"] | "paused"
): string {
  switch (status) {
    case "running":
      return "ring-blue-500/30";
    case "paused":
      return "ring-amber-500/30";
    case "completed":
      return "ring-emerald-500/30";
    case "failed":
      return "ring-red-500/30";
    default:
      return "";
  }
}

function executionEdgeColor(
  status?: FlowStepStatus["status"]
): string {
  switch (status) {
    case "running":
      return "hsl(217, 91%, 60%)"; // blue-500
    case "completed":
      return "hsl(160, 84%, 39%)"; // emerald-500
    case "failed":
      return "hsl(0, 84%, 60%)"; // red-500
    case "skipped":
      return "hsl(25, 5%, 45%)"; // stone-500
    case "pending":
    default:
      return "hsl(var(--border))";
  }
}

// ─── Custom Node Components (Existing Deployment Graph) ──────────────

function OwnerNode({
  data,
  selected,
}: {
  data: DeploymentNodeData;
  selected?: boolean;
}) {
  return (
    <div className="flex flex-col items-center cursor-pointer group">
      <div className="relative">
        <div
          className={`w-14 h-14 rounded-full border-2 bg-card flex items-center justify-center shadow-md group-hover:shadow-lg transition-all ${selected ? "border-primary ring-2 ring-primary/30" : "border-primary group-hover:border-primary/80"}`}
        >
          <Crown className="w-6 h-6 text-primary" />
        </div>
        <div
          className={`absolute bottom-1 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${statusDotColor(data.status)} ${isAnimatedStatus(data.status) ? "animate-pulse" : ""}`}
        />
      </div>
      <span className="mt-1.5 text-[11px] font-medium text-foreground max-w-[90px] truncate text-center">
        {data.name}
      </span>
      <span className="text-[9px] text-muted-foreground">
        {statusLabel(data.status)}
      </span>
      {data.llmCreditLimitDollars != null && (
        <span className="text-[9px] text-primary font-medium">
          ${data.llmCreditLimitDollars}/mo
        </span>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-primary !w-2 !h-2 !border-0"
      />
    </div>
  );
}

function LinkedNode({
  data,
  selected,
}: {
  data: DeploymentNodeData;
  selected?: boolean;
}) {
  return (
    <div className="flex flex-col items-center cursor-pointer group">
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-border !w-2 !h-2 !border-0"
      />
      <div className="relative">
        <div
          className={`w-14 h-14 rounded-full border-2 border-dashed bg-card flex items-center justify-center shadow-sm group-hover:shadow-md transition-all ${selected ? "border-primary ring-2 ring-primary/30" : "border-border group-hover:border-primary/40"}`}
        >
          <Link2 className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
        </div>
        <div
          className={`absolute bottom-1 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${statusDotColor(data.status)} ${isAnimatedStatus(data.status) ? "animate-pulse" : ""}`}
        />
      </div>
      <span className="mt-1.5 text-[11px] font-medium text-foreground max-w-[90px] truncate text-center">
        {data.name}
      </span>
      <span className="text-[9px] text-muted-foreground">
        {statusLabel(data.status)}
      </span>
    </div>
  );
}

function StandaloneNode({
  data,
  selected,
}: {
  data: DeploymentNodeData;
  selected?: boolean;
}) {
  return (
    <div className="flex flex-col items-center cursor-pointer group">
      <div className="relative">
        <div
          className={`w-14 h-14 rounded-full border-2 bg-card flex items-center justify-center shadow-sm group-hover:shadow-md transition-all ${selected ? "border-primary ring-2 ring-primary/30" : "border-border group-hover:border-primary/40"}`}
        >
          {data.llmMode === "byok" ? (
            <Key className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          ) : (
            <Bot className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          )}
        </div>
        <div
          className={`absolute bottom-1 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${statusDotColor(data.status)} ${isAnimatedStatus(data.status) ? "animate-pulse" : ""}`}
        />
      </div>
      <span className="mt-1.5 text-[11px] font-medium text-foreground max-w-[90px] truncate text-center">
        {data.name}
      </span>
      <span className="text-[9px] text-muted-foreground">
        {statusLabel(data.status)}
      </span>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  owner: OwnerNode,
  linked: LinkedNode,
  standalone: StandaloneNode,
};

// ─── Detail Panel (Existing) ─────────────────────────────────────────

function DeploymentDetailPanel({
  deployment,
  allDeployments,
  runtimeNames,
  onClose,
}: {
  deployment: DeploymentData;
  allDeployments: DeploymentData[];
  runtimeNames: Record<string, string>;
  onClose: () => void;
}) {
  const router = useRouter();
  const isPending = deployment.status === "pending";

  const sourceDeployment = deployment.llmApiKeySourceDeploymentId
    ? allDeployments.find(
        (d) => d.id === deployment.llmApiKeySourceDeploymentId
      )
    : null;

  const linkedChildren = allDeployments.filter(
    (d) => d.llmApiKeySourceDeploymentId === deployment.id
  );

  return (
    <motion.div
      initial={{ x: -320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -320, opacity: 0 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="fixed left-0 top-[57px] bottom-0 z-40 w-full sm:w-80 border-r border-border bg-card shadow-xl flex flex-col overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold text-sm truncate flex-1 mr-2">
          {deployment.name}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Status
          </p>
          <StatusBadge status={deployment.status} />
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Runtime
          </p>
          <p className="text-sm font-medium">
            {runtimeNames[deployment.runtime] || deployment.runtime}
          </p>
        </div>

        {runtimeNeedsLlm(deployment.runtime) && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              LLM Mode
            </p>
            <Badge variant="secondary" className="text-xs">
              {deployment.llmApiKeySourceDeploymentId
                ? "Linked to Pool"
                : llmModeLabel(deployment.llmMode)}
            </Badge>
          </div>
        )}

        {deployment.llmCreditLimitDollars != null && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Credit Limit
            </p>
            <div className="flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-primary" />
              <span className="text-sm font-medium">
                ${deployment.llmCreditLimitDollars}/mo
              </span>
            </div>
          </div>
        )}

        {sourceDeployment && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Credit Pool Owner
            </p>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
              <Crown className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-xs font-medium truncate">
                {sourceDeployment.name}
              </span>
            </div>
          </div>
        )}

        {linkedChildren.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Linked Deployments ({linkedChildren.length})
            </p>
            <div className="space-y-1.5">
              {linkedChildren.map((child) => (
                <div
                  key={child.id}
                  className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50"
                >
                  <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-medium truncate flex-1">
                    {child.name}
                  </span>
                  <div
                    className={`w-2 h-2 rounded-full ${statusDotColor(child.status)}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {deployment.description && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Description
            </p>
            <p className="text-xs text-muted-foreground">
              {deployment.description}
            </p>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-border">
        <Button
          onClick={() =>
            router.push(
              isPending
                ? `/onboarding/${deployment.id}`
                : `/d/${deployment.id}/configure`
            )
          }
          className="w-full"
          size="sm"
        >
          {isPending ? "Continue Setup" : "Open Config"}
          <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Existing Graph Component (inside ReactFlowProvider) ─────────────

function DeploymentGraph({
  deployments,
  showCreditPools,
  activeRuntime,
  selectedId,
  onSelectDeployment,
}: {
  deployments: DeploymentData[];
  showCreditPools: boolean;
  activeRuntime: string;
  selectedId: string | null;
  onSelectDeployment: (id: string | null) => void;
}) {
  const { fitView } = useReactFlow();

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node<DeploymentNodeData>) => {
      onSelectDeployment(node.id);
    },
    [onSelectDeployment]
  );

  const onPaneClick = useCallback(() => {
    onSelectDeployment(null);
  }, [onSelectDeployment]);

  const filtered = useMemo(() => {
    if (activeRuntime === "all") return deployments;
    return deployments.filter((d) => d.runtime === activeRuntime);
  }, [deployments, activeRuntime]);

  const { nodes, edges } = useMemo(() => {
    const nodeList: Node<DeploymentNodeData>[] = [];
    const edgeList: Edge[] = [];

    for (const dep of filtered) {
      const isOwner =
        dep.llmMode === "included" && !dep.llmApiKeySourceDeploymentId;
      const isLinked = !!dep.llmApiKeySourceDeploymentId;

      let nodeType: "owner" | "linked" | "standalone";
      if (isOwner) nodeType = "owner";
      else if (isLinked) nodeType = "linked";
      else nodeType = "standalone";

      nodeList.push({
        id: dep.id,
        type: nodeType,
        position: { x: 0, y: 0 },
        selected: dep.id === selectedId,
        data: { ...dep, nodeType },
      });

      if (isLinked && showCreditPools && dep.llmApiKeySourceDeploymentId) {
        const sourceExists = filtered.some(
          (d) => d.id === dep.llmApiKeySourceDeploymentId
        );
        if (sourceExists) {
          edgeList.push({
            id: `edge-${dep.llmApiKeySourceDeploymentId}-${dep.id}`,
            source: dep.llmApiKeySourceDeploymentId,
            target: dep.id,
            animated: true,
            style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
          });
        }
      }
    }

    if (nodeList.length > 0) {
      return getLayoutedElements(nodeList, edgeList);
    }

    return { nodes: nodeList, edges: edgeList };
  }, [filtered, showCreditPools, selectedId]);

  const onInit = useCallback(() => {
    setTimeout(() => fitView({ padding: 0.3, maxZoom: 1 }), 50);
  }, [fitView]);

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No deployments match this filter.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={onInit}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
      >
        <Background variant={"dots" as any} gap={20} size={1.5} className="!bg-background" color="hsl(var(--muted-foreground) / 0.15)" />
        <Controls
          showInteractive={false}
          className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-secondary"
        />
      </ReactFlow>
    </div>
  );
}

// =====================================================================
// ─── FLOW ORCHESTRATION CANVAS ──────────────────────────────────────
// =====================================================================

// ─── Flow Node: deployment step in the orchestration flow ───────────

const FLOW_NODE_WIDTH = 260;
const FLOW_NODE_HEIGHT = 140;

/** Get the left border color based on node role characteristics */
function getNodeBorderColor(data: FlowNodeData): string {
  if (data.isEntryPoint) return "border-l-blue-500";
  if (data.canDelegate !== false) return "border-l-emerald-500";
  if (data.role && /review|report|qa|audit/i.test(data.role)) return "border-l-amber-500";
  return "border-l-zinc-500";
}

/** Get the left border accent as an HSL value for glow effects */
function getNodeAccentHsl(data: FlowNodeData): string {
  if (data.isEntryPoint) return "hsl(217, 91%, 60%)";
  if (data.canDelegate !== false) return "hsl(160, 84%, 39%)";
  if (data.role && /review|report|qa|audit/i.test(data.role)) return "hsl(38, 92%, 50%)";
  return "hsl(240, 5%, 65%)";
}

/** Get context scope label */
function contextScopeLabel(scope?: ContextScope): string {
  switch (scope) {
    case "task": return "Task";
    case "summary": return "Summary";
    case "full": return "Full";
    default: return "Task";
  }
}

/** Get context scope color */
function contextScopeColor(scope?: ContextScope): string {
  switch (scope) {
    case "full": return "bg-red-500/10 text-red-400 border-red-500/20";
    case "summary": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

function FlowDeploymentNode({
  data,
  selected,
}: {
  data: FlowNodeData;
  selected?: boolean;
}) {
  const execStatus = data.executionPaused ? ("paused" as const) : data.executionStatus;
  const isRunning = execStatus === "running";
  const isPaused = execStatus === "paused";
  const isCompleted = execStatus === "completed";
  const isFailed = execStatus === "failed";
  const isSkipped = execStatus === "skipped";
  const hasIteration = data.executionIteration != null;
  const hasSubsteps = data.executionSubsteps && data.executionSubsteps.length > 0;

  const [hitlInput, setHitlInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmitInput = useCallback(() => {
    if (!hitlInput.trim() || !data.onResumeInput) return;
    setIsSubmitting(true);
    data.onResumeInput(hitlInput.trim());
    setHitlInput("");
    setIsSubmitting(false);
  }, [hitlInput, data]);

  const substepCompleted = hasSubsteps
    ? data.executionSubsteps!.filter((s) => s.status === "completed" || s.status === "failed").length
    : 0;
  const substepTotal = hasSubsteps ? data.executionSubsteps!.length : 0;
  const substepCredits = hasSubsteps
    ? data.executionSubsteps!.reduce((sum, s) => sum + (s.credits ?? 0), 0)
    : 0;

  const borderLeftClass = getNodeBorderColor(data);
  const accentHsl = getNodeAccentHsl(data);

  return (
    <div
      className={`
        relative rounded-xl border border-border/80 bg-card backdrop-blur-sm transition-all duration-200
        w-[260px] overflow-hidden border-l-[3px]
        ${borderLeftClass}
        ${execStatus && execStatus !== "pending" ? executionStatusColor(execStatus) : "border-border/80"}
        ${selected ? "ring-2 ring-primary/40 shadow-xl scale-[1.02]" : "shadow-lg hover:shadow-xl hover:scale-[1.01]"}
        ${isRunning || isPaused ? "ring-2 " + executionStatusRingColor(execStatus) : ""}
      `}
      style={{ borderLeftColor: undefined }}
    >
      {/* Animated conic gradient border for running state */}
      {isRunning && (
        <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none z-0">
          <div
            className="absolute inset-[-2px] rounded-xl"
            style={{
              background: `conic-gradient(from 0deg, transparent, ${accentHsl}, transparent 30%)`,
              animation: "flow-spin 2s linear infinite",
            }}
          />
          <div className="absolute inset-[2px] rounded-[10px] bg-card" />
        </div>
      )}

      {/* Animated border for paused state */}
      {isPaused && (
        <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none z-0">
          <div
            className="absolute inset-[-2px] rounded-xl"
            style={{
              background: "conic-gradient(from 0deg, transparent, hsl(38 92% 50%), transparent 30%)",
              animation: "flow-spin 3s linear infinite",
            }}
          />
          <div className="absolute inset-[2px] rounded-[10px] bg-card" />
        </div>
      )}

      {/* Iteration badge */}
      {hasIteration && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/25">
          <RotateCcw className="w-2.5 h-2.5 text-violet-400" />
          <span className="text-[9px] font-semibold text-violet-400">
            {data.executionIteration}/{data.executionMaxIterations ?? "?"}
          </span>
        </div>
      )}

      {/* Input handle (left) - always visible emerald, large hit area */}
      <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center z-20">
        <Handle
          type="target"
          position={Position.Left}
          className="!w-5 !h-5 !bg-emerald-500 !border-0 !rounded-full !ring-2 !ring-emerald-500/30 hover:!bg-emerald-400 hover:!shadow-[0_0_8px_rgba(16,185,129,0.6)] hover:!scale-150 !transition-all !relative !left-0 !top-0 !translate-x-0 !translate-y-0"
        />
      </div>

      {/* Output handle (right) - always visible blue, large hit area */}
      <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center z-20">
        <Handle
          type="source"
          position={Position.Right}
          className="!w-5 !h-5 !bg-blue-500 !border-0 !rounded-full !ring-2 !ring-blue-500/30 hover:!bg-blue-400 hover:!shadow-[0_0_8px_rgba(59,130,246,0.6)] hover:!scale-150 !transition-all !relative !left-0 !top-0 !translate-x-0 !translate-y-0"
        />
      </div>

      {/* Content */}
      <div className="relative z-10 p-3 space-y-2">
        {/* Row 1: Entry star + Icon + Bot Name + Execution status */}
        <div className="flex items-center gap-2">
          {data.isEntryPoint && (
            <Star className="w-3.5 h-3.5 text-blue-400 fill-blue-400 shrink-0" />
          )}
          {data.capabilities?.supportsSubagents && data.capabilities.subagents?.length > 0 ? (
            <svg className="w-4 h-4 text-violet-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="3" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="18" r="2.5" />
              <line x1="12" y1="11" x2="6" y2="15.5" /><line x1="12" y1="11" x2="18" y2="15.5" />
            </svg>
          ) : (
            <Bot className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <span className="text-base font-semibold text-foreground truncate flex-1 leading-tight">
            {data.name}
          </span>
          {isCompleted && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
          {isFailed && <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
          {isRunning && <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />}
          {isPaused && <Pause className="w-4 h-4 text-amber-500 shrink-0" />}
          {isSkipped && <Circle className="w-4 h-4 text-stone-400 shrink-0" />}
        </div>

        {/* Row 2: Role */}
        {data.role && (
          <p className="text-xs font-semibold text-primary truncate leading-tight">
            Role: {data.role}
          </p>
        )}

        {/* Row 3: Goal (truncated to 2 lines) */}
        {data.goal && (
          <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2">
            {data.goal}
          </p>
        )}

        {/* Row 4: Status + Runtime */}
        <div className="flex items-center gap-2">
          <StatusBadge status={data.status} compact />
          <span className="text-[10px] text-muted-foreground truncate">
            {data.runtime}
          </span>
        </div>

        {/* Row 5: Badges (delegation + context scope) */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium border ${
              data.canDelegate !== false
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            {data.canDelegate !== false ? (
              <>
                <Network className="w-2.5 h-2.5" />
                Can delegate
              </>
            ) : (
              <>
                <ArrowRight className="w-2.5 h-2.5" />
                Direct only
              </>
            )}
          </span>
          <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium border ${contextScopeColor(data.contextScope)}`}
          >
            <Eye className="w-2.5 h-2.5" />
            {contextScopeLabel(data.contextScope)}
          </span>
        </div>

        {/* Row 6: Subagent cluster pills */}
        {data.capabilities?.subagents && data.capabilities.subagents.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[9px] text-muted-foreground mr-0.5">Agents:</span>
            {data.capabilities.subagents.slice(0, 4).map((sa) => (
              <span
                key={sa.slug}
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-medium border ${
                  sa.source === "platform"
                    ? "bg-violet-500/10 text-violet-400 border-violet-500/20"
                    : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                }`}
              >
                {sa.name.replace(/ Agent$/, "")}
              </span>
            ))}
            {data.capabilities.subagents.length > 4 && (
              <span className="text-[8px] text-muted-foreground">
                +{data.capabilities.subagents.length - 4}
              </span>
            )}
          </div>
        )}

        {/* Execution info row */}
        {(data.executionCredits != null && data.executionCredits > 0 || data.executionDurationMs != null) && (
          <div className="flex items-center gap-3">
            {data.executionCredits != null && data.executionCredits > 0 && (
              <div className="flex items-center gap-0.5">
                <Coins className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] font-medium text-amber-400">
                  {data.executionCredits.toFixed(4)}
                </span>
              </div>
            )}
            {data.executionDurationMs != null && (
              <span className="text-[10px] text-muted-foreground">
                {data.executionDurationMs < 1000
                  ? `${data.executionDurationMs}ms`
                  : `${(data.executionDurationMs / 1000).toFixed(1)}s`}
              </span>
            )}
          </div>
        )}

        {/* Subflow progress indicator */}
        {hasSubsteps && (
          <div className="px-1.5 py-1 rounded bg-violet-500/5 border border-violet-500/10">
            <div className="flex items-center gap-1.5 mb-1">
              <Workflow className="w-3 h-3 text-violet-400" />
              <span className="text-[10px] font-medium text-violet-400">
                {isRunning ? "Running subflow..." : "Subflow"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                Step {substepCompleted}/{substepTotal}
              </span>
              <div className="flex-1 h-1 rounded-full bg-violet-500/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-violet-500/60 transition-all duration-300"
                  style={{
                    width: substepTotal > 0 ? `${(substepCompleted / substepTotal) * 100}%` : "0%",
                  }}
                />
              </div>
            </div>
            {isCompleted && substepCredits > 0 && (
              <div className="flex items-center gap-0.5 mt-0.5">
                <Coins className="w-2.5 h-2.5 text-amber-400" />
                <span className="text-[9px] font-medium text-amber-400">
                  {substepCredits.toFixed(4)} subflow credits
                </span>
              </div>
            )}
          </div>
        )}

        {/* Streaming inner text preview */}
        {isRunning && data.executionInnerText && (
          <div className="px-1.5 py-1 rounded bg-blue-500/5 border border-blue-500/10 max-h-[48px] overflow-hidden">
            <p className="text-[10px] text-blue-300/80 leading-tight line-clamp-3 whitespace-pre-wrap break-words">
              {data.executionInnerText.length > 200
                ? "\u2026" + data.executionInnerText.slice(-200)
                : data.executionInnerText}
            </p>
          </div>
        )}

        {/* HITL: Paused / waiting for input */}
        {isPaused && (
          <div className="px-1.5 py-1.5 rounded bg-amber-500/5 border border-amber-500/20">
            <p className="text-[10px] font-medium text-amber-500 mb-1.5 flex items-center gap-1">
              <Pause className="w-3 h-3" />
              Waiting for input...
            </p>
            <div className="flex items-center gap-1">
              <Input
                value={hitlInput}
                onChange={(e) => setHitlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmitInput(); }}
                placeholder="Type your response..."
                className="h-6 text-[10px] px-1.5 bg-card/80 border-amber-500/30 focus-visible:ring-amber-500/30"
                disabled={isSubmitting}
              />
              <Button
                size="sm"
                onClick={handleSubmitInput}
                disabled={!hitlInput.trim() || isSubmitting}
                className="h-6 w-6 p-0 bg-amber-600 hover:bg-amber-700 text-white shrink-0"
              >
                <Send className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}

        {/* Error message */}
        {data.executionError && (
          <p className="text-[10px] text-red-400 line-clamp-2">
            {data.executionError}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Edge color + style by type ──────────────────────────────────────

function edgeTypeColor(edgeType?: FlowEdgeType): string {
  switch (edgeType) {
    case "delegates": return "hsl(217, 91%, 60%)";   // blue-500
    case "reports": return "hsl(38, 92%, 50%)";       // amber-500
    case "collaborates": return "hsl(263, 70%, 50%)"; // violet-500
    default: return "hsl(217, 91%, 60%)";
  }
}

function edgeTypeLabel(edgeType?: FlowEdgeType): string {
  switch (edgeType) {
    case "delegates": return "delegates";
    case "reports": return "reports";
    case "collaborates": return "collaborates";
    default: return "delegates";
  }
}

function edgeTypeDashArray(edgeType?: FlowEdgeType): string | undefined {
  switch (edgeType) {
    case "reports": return "6 4";
    case "collaborates": return undefined;
    default: return undefined;
  }
}

// ─── Flow Edge: redesigned with type labels ──────────────────────────

function FlowEdge({
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
  const edgeData = data as FlowEdgeData | undefined;
  const edgeType = edgeData?.edgeType || "delegates";
  const execStatus = edgeData?.executionStatus;

  // During execution, use execution color; otherwise use edge type color
  const isExecuting = !!execStatus && execStatus !== "pending";
  const color = isExecuting ? executionEdgeColor(execStatus) : edgeTypeColor(edgeType);
  const isRunning = execStatus === "running";

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const dashArray = isRunning ? "8 4" : edgeTypeDashArray(edgeType);

  // Edge type dropdown state
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <>
      {/* Invisible wide hit area for easier selection */}
      <BaseEdge
        id={`${id}-hitarea`}
        path={edgePath}
        style={{
          stroke: "transparent",
          strokeWidth: 20,
          fill: "none",
        }}
      />

      {/* Main edge path */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: color,
          strokeWidth: edgeType === "collaborates" ? 2.5 : 2,
          strokeDasharray: dashArray,
          animation: isRunning ? "flow-dash 0.6s linear infinite" : undefined,
        }}
        markerEnd={edgeType !== "collaborates" ? `url(#marker-${edgeType}-${id})` : undefined}
      />

      {/* Glow effect for running edges */}
      {isRunning && (
        <BaseEdge
          id={`${id}-glow`}
          path={edgePath}
          style={{
            stroke: color,
            strokeWidth: 8,
            strokeOpacity: 0.12,
            strokeDasharray: "8 4",
            animation: "flow-dash 0.6s linear infinite",
          }}
        />
      )}

      {/* SVG defs for arrow markers */}
      <defs>
        <marker
          id={`marker-delegates-${id}`}
          viewBox="0 0 12 12"
          refX="10"
          refY="6"
          markerWidth="8"
          markerHeight="8"
          orient="auto"
        >
          <path d="M 2 2 L 10 6 L 2 10 z" fill={color} />
        </marker>
        <marker
          id={`marker-reports-${id}`}
          viewBox="0 0 12 12"
          refX="2"
          refY="6"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 10 2 L 2 6 L 10 10 z" fill={color} />
        </marker>
      </defs>

      {/* Floating label pill */}
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowDropdown((v) => !v);
            }}
            className={`
              relative flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium
              border backdrop-blur-sm transition-all cursor-pointer
              hover:scale-105 active:scale-95
              ${edgeType === "delegates" ? "bg-blue-500/15 text-blue-400 border-blue-500/25 hover:bg-blue-500/25" : ""}
              ${edgeType === "reports" ? "bg-amber-500/15 text-amber-400 border-amber-500/25 hover:bg-amber-500/25" : ""}
              ${edgeType === "collaborates" ? "bg-violet-500/15 text-violet-400 border-violet-500/25 hover:bg-violet-500/25" : ""}
            `}
          >
            {edgeType === "delegates" && <ArrowRight className="w-2.5 h-2.5" />}
            {edgeType === "reports" && <ArrowRight className="w-2.5 h-2.5 rotate-180" />}
            {edgeType === "collaborates" && <ArrowLeftRight className="w-2.5 h-2.5" />}
            {edgeTypeLabel(edgeType)}
            <ChevronDown className="w-2.5 h-2.5 opacity-60" />
          </button>

          {/* Edge type dropdown */}
          {showDropdown && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[130px]">
              {(["delegates", "reports", "collaborates"] as FlowEdgeType[]).map((type) => (
                <button
                  type="button"
                  key={type}
                  onClick={(e) => {
                    e.stopPropagation();
                    // Dispatch a custom event to update the edge type
                    window.dispatchEvent(
                      new CustomEvent("flow-edge-type-change", {
                        detail: { edgeId: id, edgeType: type },
                      })
                    );
                    setShowDropdown(false);
                  }}
                  className={`
                    w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-medium transition-colors
                    ${type === edgeType ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"}
                  `}
                >
                  {type === "delegates" && <ArrowRight className="w-3 h-3 text-blue-400" />}
                  {type === "reports" && <ArrowRight className="w-3 h-3 text-amber-400 rotate-180" />}
                  {type === "collaborates" && <ArrowLeftRight className="w-3 h-3 text-violet-400" />}
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                  {type === edgeType && <CheckCircle2 className="w-3 h-3 ml-auto text-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const flowNodeTypes: NodeTypes = {
  flowDeployment: FlowDeploymentNode,
};

const flowEdgeTypes: EdgeTypes = {
  flowEdge: FlowEdge,
};

// ─── Flow Palette Sidebar: drag deployments onto canvas ──────────────

function FlowPaletteSidebar({
  deployments,
  nodesOnCanvas,
  onAddNode,
}: {
  deployments: DeploymentData[];
  nodesOnCanvas: Set<string>;
  onAddNode: (deployment: DeploymentData) => void;
}) {
  const available = deployments.filter((d) => !nodesOnCanvas.has(d.id));
  const onCanvas = deployments.filter((d) => nodesOnCanvas.has(d.id));

  return (
    <div className="w-64 border-r border-border/60 bg-card/30 backdrop-blur-sm flex flex-col shrink-0">
      {/* Header */}
      <div className="px-3 py-3 border-b border-border/60">
        <div className="flex items-center gap-2 mb-1">
          <Users className="w-3.5 h-3.5 text-primary" />
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            Bot Team
          </p>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Click to add bots to your team canvas
        </p>
      </div>

      {/* Available section */}
      <div className="flex-1 overflow-y-auto">
        {available.length > 0 && (
          <div className="p-2">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-medium px-1 mb-1.5">
              Available ({available.length})
            </p>
            <div className="space-y-1">
              {available.map((dep) => (
                <button
                  type="button"
                  key={dep.id}
                  onClick={() => onAddNode(dep)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg border border-border/40 bg-card/60 hover:bg-secondary/60 hover:border-primary/30 transition-all text-left group"
                >
                  <div className="relative shrink-0">
                    <div className="w-8 h-8 rounded-lg bg-secondary/80 flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                      <Bot className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                    <div
                      className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-card ${statusDotColor(dep.status)} ${isAnimatedStatus(dep.status) ? "animate-pulse" : ""}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate text-foreground">
                      {dep.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {dep.runtime} &middot; {statusLabel(dep.status)}
                    </p>
                  </div>
                  <Plus className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* On canvas section */}
        {onCanvas.length > 0 && (
          <div className="p-2 border-t border-border/40">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-medium px-1 mb-1.5">
              On Canvas ({onCanvas.length})
            </p>
            <div className="space-y-1">
              {onCanvas.map((dep) => (
                <div
                  key={dep.id}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-border/20 bg-secondary/20 text-left opacity-60"
                >
                  <div className="relative shrink-0">
                    <div className="w-8 h-8 rounded-lg bg-secondary/50 flex items-center justify-center">
                      <Bot className="w-4 h-4 text-muted-foreground/60" />
                    </div>
                    <div
                      className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-card ${statusDotColor(dep.status)}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate text-foreground/60">
                      {dep.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 truncate">
                      {dep.runtime}
                    </p>
                  </div>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/50 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}

        {deployments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Bot className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-xs text-muted-foreground mb-1">No deployments yet</p>
            <p className="text-[10px] text-muted-foreground/60">
              Create deployments first, then build your team here
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Team Type Config ─────────────────────────────────────────────────

const TEAM_TYPE_OPTIONS: { value: TeamType; label: string; icon: typeof Network; desc: string }[] = [
  { value: "hierarchy", label: "Hierarchy", icon: GitBranch, desc: "Top-down delegation (org chart)" },
  { value: "pipeline", label: "Pipeline", icon: ArrowRight, desc: "Sequential processing (assembly line)" },
  { value: "collaborative", label: "Collaborative", icon: ArrowLeftRight, desc: "Multi-directional (team meeting)" },
];

// ─── Flow Toolbar ────────────────────────────────────────────────────

function FlowToolbar({
  flowName,
  onFlowNameChange,
  onRun,
  onCancel,
  onSave,
  onAutoLayout,
  onNewFlow,
  onDeleteFlow,
  onChatWithTeam,
  isExecuting,
  isSaved,
  totalCredits,
  hasFlow,
  teamType,
  onTeamTypeChange,
  entryNodeName,
}: {
  flowName: string;
  onFlowNameChange: (name: string) => void;
  onRun: () => void;
  onCancel: () => void;
  onSave: () => void;
  onAutoLayout: () => void;
  onNewFlow: () => void;
  onDeleteFlow: () => void;
  onChatWithTeam: () => void;
  isExecuting: boolean;
  isSaved: boolean;
  totalCredits: number;
  hasFlow: boolean;
  teamType: TeamType;
  onTeamTypeChange: (type: TeamType) => void;
  entryNodeName: string | null;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(flowName);
  const [showTeamTypeDropdown, setShowTeamTypeDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const teamTypeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEditValue(flowName);
  }, [flowName]);

  // Close team type dropdown on outside click
  useEffect(() => {
    if (!showTeamTypeDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (teamTypeRef.current && !teamTypeRef.current.contains(e.target as HTMLElement)) {
        setShowTeamTypeDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showTeamTypeDropdown]);

  const handleCommit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== flowName) {
      onFlowNameChange(trimmed);
    } else {
      setEditValue(flowName);
    }
    setIsEditing(false);
  };

  const currentTeamType = TEAM_TYPE_OPTIONS.find((o) => o.value === teamType) || TEAM_TYPE_OPTIONS[0];
  const TeamTypeIcon = currentTeamType.icon;

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 border-b border-border/60 bg-card/80 backdrop-blur-sm overflow-x-auto scrollbar-none">
      {/* Flow name (editable) */}
      <div className="flex items-center gap-1.5 min-w-0 shrink-0">
        <GitBranch className="w-4 h-4 text-primary shrink-0" />
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCommit();
              if (e.key === "Escape") { setEditValue(flowName); setIsEditing(false); }
            }}
            className="bg-transparent border-b border-primary text-sm font-semibold text-foreground outline-none min-w-[120px] max-w-[200px]"
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => { if (hasFlow) setIsEditing(true); }}
            className="flex items-center gap-1 text-sm font-semibold text-foreground hover:text-primary transition-colors truncate max-w-[180px]"
            disabled={!hasFlow}
          >
            {flowName || "Untitled Flow"}
            {hasFlow && <Pencil className="w-3 h-3 text-muted-foreground shrink-0" />}
          </button>
        )}
        {hasFlow && !isSaved && (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
        )}
      </div>

      {/* Entry point indicator */}
      {hasFlow && entryNodeName && (
        <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-500/8 border border-blue-500/15">
          <Star className="w-3 h-3 text-blue-400 fill-blue-400" />
          <span className="text-[10px] font-medium text-blue-400 truncate max-w-[100px]">
            Entry: {entryNodeName}
          </span>
        </div>
      )}

      {/* Team type selector */}
      {hasFlow && (
        <div ref={teamTypeRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowTeamTypeDropdown((v) => !v)}
            className="flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card hover:bg-secondary/50 transition-colors text-sm font-medium text-foreground hover:text-foreground shadow-sm"
          >
            <TeamTypeIcon className="w-4 h-4" />
            <span>{currentTeamType.label}</span>
            <ChevronDown className={`w-3.5 h-3.5 opacity-70 transition-transform ${showTeamTypeDropdown ? "rotate-180" : ""}`} />
          </button>

          {showTeamTypeDropdown && (
            <div className="absolute top-full left-0 mt-1.5 z-[100] bg-popover border border-border rounded-lg shadow-2xl py-1.5 min-w-[240px]">
              {TEAM_TYPE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => { onTeamTypeChange(opt.value); setShowTeamTypeDropdown(false); }}
                    className={`w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors rounded-md mx-0.5 ${
                      opt.value === teamType ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    }`}
                    style={{ width: "calc(100% - 4px)" }}
                  >
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${opt.value === teamType ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${opt.value === teamType ? "text-foreground" : "text-muted-foreground"}`}>
                        {opt.label}
                      </p>
                      <p className="text-xs text-muted-foreground/70 mt-0.5">{opt.desc}</p>
                    </div>
                    {opt.value === teamType && <CheckCircle2 className="w-4 h-4 text-primary ml-auto mt-0.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Credits display */}
      {totalCredits > 0 && (
        <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20">
          <Coins className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-medium text-amber-400">
            {totalCredits.toFixed(4)}
          </span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" onClick={onNewFlow} className="h-9 px-3 text-sm">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline ml-1.5">New</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Create a new bot team</TooltipContent>
        </Tooltip>

        {hasFlow && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={onAutoLayout} className="h-9 px-3 text-sm">
                  <LayoutGrid className="w-4 h-4" />
                  <span className="hidden sm:inline ml-1.5">Layout</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Auto-arrange nodes</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={onSave} disabled={isSaved} className="h-9 px-3 text-sm">
                  <Save className="w-4 h-4" />
                  <span className="hidden sm:inline ml-1.5">Save</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isSaved ? "All changes saved" : "Save flow"}</TooltipContent>
            </Tooltip>

            <div className="w-px h-6 bg-border mx-1" />

            {/* Chat with Team button - prominent blue */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onChatWithTeam}
                  disabled={!entryNodeName}
                  className="h-9 px-4 text-sm bg-blue-600/10 border-blue-500/30 text-blue-400 hover:bg-blue-600/20 hover:text-blue-300 hover:border-blue-500/50 font-medium"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span className="ml-1.5">Chat</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {entryNodeName ? `Chat with ${entryNodeName}` : "Set an entry point first"}
              </TooltipContent>
            </Tooltip>

            <div className="w-px h-6 bg-border mx-1" />

            {isExecuting ? (
              <Button variant="destructive" size="sm" onClick={onCancel} className="h-9 px-4 text-sm font-medium">
                <Square className="w-4 h-4 mr-1.5" />
                Stop
              </Button>
            ) : (
              <Button size="sm" onClick={onRun} className="h-9 px-5 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-900/20">
                <Play className="w-4 h-4 mr-1.5" />
                Run
              </Button>
            )}

            <div className="w-px h-6 bg-border mx-1" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={onDeleteFlow} className="h-9 px-2.5 text-muted-foreground hover:text-red-400">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete this flow</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Flow List Sidebar ───────────────────────────────────────────────

function FlowListSidebar({
  flows,
  activeFlowId,
  onSelectFlow,
  deployments,
  executingFlowId,
}: {
  flows: FlowDefinition[];
  activeFlowId: string | null;
  onSelectFlow: (id: string) => void;
  /** Latest deployments list — used to compute per-team health (running/total). */
  deployments: DeploymentData[];
  /** Flow id whose execution is currently in flight (if any). Drives the
   *  pulsing "active" indicator on its pill. */
  executingFlowId: string | null;
}) {
  if (flows.length === 0) return null;

  // Lookup for fast per-team health rollup. Subscribes to live SSE status
  // so the badge updates within seconds of a bot transitioning state.
  const { getStatus } = useStatusStream({ enabled: true });
  const depById = useMemo(() => {
    const m = new Map<string, DeploymentData>();
    for (const d of deployments) m.set(d.id, d);
    return m;
  }, [deployments]);

  // For each flow, compute (a) how many member deployments are Running,
  // (b) how many total, (c) whether the flow is currently executing.
  const flowHealth = useMemo(() => {
    return flows.map((flow) => {
      const memberIds = flow.nodes
        .map((n) => (n as any).deploymentId || n.id)
        .filter(Boolean) as string[];
      let running = 0;
      let stopped = 0;
      let other = 0;
      for (const id of memberIds) {
        const liveStatus = getStatus(id)?.status;
        const status = liveStatus ?? depById.get(id)?.status ?? "unknown";
        if (status === "running") running++;
        else if (status === "stopped") stopped++;
        else other++;
      }
      return {
        flowId: flow.id,
        total: memberIds.length,
        running,
        stopped,
        other,
        isExecuting: flow.id === executingFlowId,
        // Derived state used for the pill color
        // - executing: blue pulse, currently in flight
        // - all running: emerald, healthy
        // - some stopped/pending/failed: amber, partially healthy
        // - all stopped: red, idle
        // - empty: gray, no members
        derivedState:
          flow.id === executingFlowId
            ? "executing"
            : memberIds.length === 0
              ? "empty"
              : running === memberIds.length
                ? "healthy"
                : running === 0
                  ? "idle"
                  : "partial",
      };
    });
  }, [flows, depById, executingFlowId, getStatus]);
  const healthByFlow = useMemo(() => {
    const m = new Map<string, (typeof flowHealth)[number]>();
    for (const h of flowHealth) m.set(h.flowId, h);
    return m;
  }, [flowHealth]);

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {flows.map((flow) => {
        const isActive = flow.id === activeFlowId;
        const health = healthByFlow.get(flow.id);
        const state = health?.derivedState ?? "empty";
        // Status dot color per derived state
        const dotClass =
          state === "executing"
            ? "bg-blue-500 animate-pulse"
            : state === "healthy"
              ? "bg-emerald-500"
              : state === "partial"
                ? "bg-amber-500"
                : state === "idle"
                  ? "bg-red-500/80"
                  : "bg-muted-foreground/40";
        // Tooltip-friendly summary string ("3/3 running" / "1/3 running, 2 stopped" / "executing now")
        const summary =
          state === "executing"
            ? "executing now"
            : health
              ? `${health.running}/${health.total} running` +
                (health.stopped > 0 ? `, ${health.stopped} stopped` : "") +
                (health.other > 0 ? `, ${health.other} other` : "")
              : "";

        return (
          <button
            type="button"
            key={flow.id}
            onClick={() => onSelectFlow(flow.id)}
            title={summary}
            aria-label={`${flow.name}, ${summary}`}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${
              isActive
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-secondary/80 border-border text-muted-foreground hover:text-foreground hover:border-primary/20"
            }`}
          >
            {/* Status dot — color encodes per-team health, animates when executing */}
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass}`}
              aria-hidden="true"
            />
            <Users className="w-3 h-3" />
            {flow.name}
            <span className="text-muted-foreground/70">
              {health ? `${health.running}/${health.total}` : `(${flow.nodes.length})`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Flow Canvas (inner, inside ReactFlowProvider) ───────────────────

function FlowCanvas({
  deployments,
  flow,
  onUpdateFlow,
  executionSteps,
  pausedNodeId,
  onResumeInput,
  selectedNodeId,
  onSelectNode,
}: {
  deployments: DeploymentData[];
  flow: FlowDefinition;
  onUpdateFlow: (updates: Partial<FlowDefinition>) => void;
  executionSteps: Map<string, FlowStepStatus>;
  pausedNodeId?: string;
  onResumeInput?: (nodeId: string, input: string) => void;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const { fitView } = useReactFlow();

  // Subscribe to live deployment status so node badges reflect real-time state
  // (fixes Bot Teams canvas showing stale "Running" when a bot is Stopped).
  const { getStatus } = useStatusStream({ enabled: true });

  // Build a quick lookup from the latest deployments list for fallback
  const deploymentById = useMemo(() => {
    const map = new Map<string, DeploymentData>();
    for (const d of deployments) map.set(d.id, d);
    return map;
  }, [deployments]);

  // Merge execution state into node data
  const nodesWithExecution: Node<FlowNodeData>[] = useMemo(() => {
    return flow.nodes.map((node) => {
      const stepStatus = executionSteps.get(node.id);
      const isPaused = pausedNodeId === node.id;
      // Live status wins; fall back to latest deployments query, then stored snapshot
      const liveStatus = getStatus(node.id)?.status;
      const latestDep = deploymentById.get(node.id);
      const resolvedStatus = liveStatus ?? latestDep?.status ?? node.data.status;
      return {
        ...node,
        selected: node.id === selectedNodeId,
        data: {
          ...node.data,
          status: resolvedStatus,
          executionStatus: stepStatus?.status,
          executionCredits: stepStatus?.credits,
          executionDurationMs: stepStatus?.durationMs,
          executionError: stepStatus?.error,
          executionInnerText: stepStatus?.innerText,
          executionPaused: isPaused,
          executionIteration: stepStatus?.iteration,
          executionMaxIterations: stepStatus?.maxIterations,
          executionSubsteps: stepStatus?.substeps,
          onResumeInput: isPaused && onResumeInput
            ? (input: string) => onResumeInput(node.id, input)
            : undefined,
        },
      };
    });
  }, [flow.nodes, executionSteps, pausedNodeId, onResumeInput, selectedNodeId, getStatus, deploymentById]);

  // Merge execution state into edges (preserve edgeType)
  const edgesWithExecution: Edge[] = useMemo(() => {
    return flow.edges.map((edge) => {
      const targetStatus = executionSteps.get(edge.target);
      const existingData = (edge.data as FlowEdgeData) || {};
      return {
        ...edge,
        type: "flowEdge",
        data: {
          ...existingData,
          edgeType: existingData.edgeType || "delegates",
          executionStatus: targetStatus?.status,
        },
      };
    });
  }, [flow.edges, executionSteps]);

  const [nodes, setNodes, onNodesChange] = useNodesState(nodesWithExecution);
  const [edges, setEdges, onEdgesChange] = useEdgesState(edgesWithExecution);

  // Sync nodes/edges when flow or execution changes
  useEffect(() => {
    setNodes(nodesWithExecution);
  }, [nodesWithExecution, setNodes]);

  useEffect(() => {
    setEdges(edgesWithExecution);
  }, [edgesWithExecution, setEdges]);

  // Listen for edge type change events from the FlowEdge label dropdown
  useEffect(() => {
    const handleEdgeTypeChange = (e: Event) => {
      const { edgeId, edgeType } = (e as CustomEvent).detail;
      onUpdateFlow({
        edges: flow.edges.map((edge) => {
          if (edge.id === edgeId) {
            return {
              ...edge,
              data: { ...((edge.data as FlowEdgeData) || {}), edgeType },
            };
          }
          return edge;
        }),
      });
    };
    window.addEventListener("flow-edge-type-change", handleEdgeTypeChange);
    return () => window.removeEventListener("flow-edge-type-change", handleEdgeTypeChange);
  }, [flow.edges, onUpdateFlow]);

  // Handle node click for selection
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node<FlowNodeData>) => {
      onSelectNode(node.id);
    },
    [onSelectNode]
  );

  // Handle canvas click to deselect
  const onPaneClick = useCallback(() => {
    onSelectNode(null);
  }, [onSelectNode]);

  // Handle node position changes (drag)
  const handleNodesChange: OnNodesChange<Node<FlowNodeData>> = useCallback(
    (changes) => {
      onNodesChange(changes);

      const positionChanges = changes.filter(
        (c) => c.type === "position" && !("dragging" in c && c.dragging)
      );
      if (positionChanges.length > 0) {
        onUpdateFlow({
          nodes: flow.nodes.map((n) => {
            const change = positionChanges.find((c) => "id" in c && c.id === n.id);
            if (change && "position" in change && change.position) {
              return { ...n, position: change.position };
            }
            return n;
          }),
        });
      }
    },
    [onNodesChange, onUpdateFlow, flow.nodes]
  );

  // Handle edge creation (connecting nodes) -- defaults to "delegates" type
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const exists = flow.edges.some(
        (e) => e.source === connection.source && e.target === connection.target
      );
      if (exists) return;
      if (connection.source === connection.target) return;

      const newEdge: Edge = {
        id: `flow-edge-${connection.source}-${connection.target}`,
        source: connection.source!,
        target: connection.target!,
        type: "flowEdge",
        data: { edgeType: "delegates" as FlowEdgeType },
      };

      setEdges((eds) => addEdge(newEdge, eds));
      onUpdateFlow({ edges: [...flow.edges, newEdge] });
    },
    [flow.edges, setEdges, onUpdateFlow]
  );

  // Handle edge deletion
  const handleEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      onEdgesChange(changes);

      const removals = changes.filter((c) => c.type === "remove");
      if (removals.length > 0) {
        const removedIds = new Set(removals.map((c) => ("id" in c ? c.id : "")));
        onUpdateFlow({
          edges: flow.edges.filter((e) => !removedIds.has(e.id)),
        });
      }
    },
    [onEdgesChange, onUpdateFlow, flow.edges]
  );

  // Handle node deletion via keyboard
  const onNodesDelete = useCallback(
    (deleted: Node<FlowNodeData>[]) => {
      const deletedIds = new Set(deleted.map((n) => n.id));
      onUpdateFlow({
        nodes: flow.nodes.filter((n) => !deletedIds.has(n.id)),
        edges: flow.edges.filter((e) => !deletedIds.has(e.source) && !deletedIds.has(e.target)),
      });
      if (selectedNodeId && deletedIds.has(selectedNodeId)) {
        onSelectNode(null);
      }
    },
    [onUpdateFlow, flow.nodes, flow.edges, selectedNodeId, onSelectNode]
  );

  const onInit = useCallback(() => {
    setTimeout(() => fitView({ padding: 0.15, maxZoom: 1 }), 50);
  }, [fitView]);

  // Node IDs on canvas
  const nodesOnCanvas = useMemo(
    () => new Set(flow.nodes.map((n) => n.id)),
    [flow.nodes]
  );

  // Add deployment as a flow node with defaults
  const handleAddNode = useCallback(
    (dep: DeploymentData) => {
      const rightmostX = flow.nodes.reduce((max, n) => Math.max(max, n.position.x), 0);
      const hasEntry = flow.nodes.some((n) => n.data?.isEntryPoint);
      const newNode: Node<FlowNodeData> = {
        id: dep.id,
        type: "flowDeployment",
        position: {
          x: flow.nodes.length > 0 ? rightmostX + FLOW_NODE_WIDTH + 80 : 100,
          y: 150,
        },
        data: {
          ...dep,
          role: "",
          goal: "",
          canDelegate: true,
          contextScope: "task",
          isEntryPoint: !hasEntry, // First node added becomes entry point
        },
      };
      onUpdateFlow({ nodes: [...flow.nodes, newNode] });
    },
    [flow.nodes, onUpdateFlow]
  );

  return (
    <div className="flex flex-1 min-h-0">
      {/* Palette sidebar */}
      <FlowPaletteSidebar
        deployments={deployments}
        nodesOnCanvas={nodesOnCanvas}
        onAddNode={handleAddNode}
      />

      {/* Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={flowNodeTypes}
          edgeTypes={flowEdgeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onInit={onInit}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.15}
          maxZoom={2}
          nodesDraggable={true}
          nodesConnectable={true}
          elementsSelectable={true}
          connectionMode={"loose" as any}
          deleteKeyCode={["Backspace", "Delete"]}
          defaultEdgeOptions={{
            type: "flowEdge",
          }}
          connectionLineStyle={{
            stroke: "hsl(217, 91%, 60%)",
            strokeWidth: 3,
            strokeDasharray: "6 3",
          }}
        >
          <Background
            variant={"dots" as any}
            gap={20}
            size={1.5}
            className="!bg-background"
            color="hsl(var(--muted-foreground) / 0.15)"
          />
          <Controls
            showInteractive={false}
            className="!bg-card !border-border/60 !shadow-lg !rounded-lg [&>button]:!bg-card [&>button]:!border-border/60 [&>button]:!text-foreground [&>button:hover]:!bg-secondary"
          />
          <MiniMap
            className="!bg-card/80 !border-border/60 !rounded-lg !shadow-lg"
            nodeColor={(node) => {
              const d = node.data as FlowNodeData | undefined;
              if (d?.isEntryPoint) return "hsl(217, 91%, 60%)";
              if (d?.canDelegate !== false) return "hsl(160, 84%, 39%)";
              return "hsl(var(--muted-foreground))";
            }}
            maskColor="hsl(var(--background) / 0.7)"
          />
        </ReactFlow>

      </div>

      {/* Config panel for selected node */}
      {selectedNodeId && (() => {
        const selectedNode = flow.nodes.find((n) => n.id === selectedNodeId);
        if (!selectedNode) return null;
        const nodeConfig: FlowNodeConfig = {
          id: selectedNode.id,
          deploymentId: selectedNode.data?.id,
          label: selectedNode.data?.name || selectedNode.id,
          role: selectedNode.data?.role,
          goal: selectedNode.data?.goal,
          canDelegate: selectedNode.data?.canDelegate,
          contextScope: selectedNode.data?.contextScope,
          isEntryPoint: selectedNode.data?.isEntryPoint,
        };
        return (
          <FlowNodeConfigPanel
            node={nodeConfig}
            deploymentName={selectedNode.data?.name}
            deploymentRuntime={selectedNode.data?.runtime}
            deploymentStatus={selectedNode.data?.status}
            onUpdate={(nodeId, updates) => {
              onUpdateFlow({
                nodes: flow.nodes.map((n) => {
                  if (n.id !== nodeId) return n;
                  return {
                    ...n,
                    data: {
                      ...n.data,
                      ...(updates.role !== undefined ? { role: updates.role } : {}),
                      ...(updates.goal !== undefined ? { goal: updates.goal } : {}),
                      ...(updates.canDelegate !== undefined ? { canDelegate: updates.canDelegate } : {}),
                      ...(updates.contextScope !== undefined ? { contextScope: updates.contextScope } : {}),
                      ...(updates.isEntryPoint !== undefined ? { isEntryPoint: updates.isEntryPoint } : {}),
                    },
                  };
                }),
              });
            }}
            onClose={() => onSelectNode(null)}
            onSetEntryPoint={(nodeId) => {
              onUpdateFlow({
                nodes: flow.nodes.map((n) => ({
                  ...n,
                  data: {
                    ...n.data,
                    isEntryPoint: n.id === nodeId,
                  },
                })),
              });
            }}
          />
        );
      })()}
    </div>
  );
}

// ─── Flow View (manages flow state, toolbar, execution) ──────────────

function FlowView({ deployments }: { deployments: DeploymentData[] }) {
  const utils = trpc.useUtils();

  // ── Selected node state (for config panel) ────────────────────────
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // ── Fetch flows from API ──────────────────────────────────────────
  const flowsQuery = trpc.flows.list.useQuery(undefined, {
    staleTime: 30_000,
  });

  // Load subagent data for all deployments (for cluster/flat visual)
  const [capabilitiesMap, setCapabilitiesMap] = useState<Map<string, { supportsSubagents: boolean; subagents: Array<{ slug: string; name: string; source: string }>; skills: Array<{ name: string }> }>>(new Map());

  useEffect(() => {
    if (deployments.length === 0) return;
    const fetchCapabilities = async () => {
      const map = new Map<string, { supportsSubagents: boolean; subagents: Array<{ slug: string; name: string; source: string }>; skills: Array<{ name: string }> }>();
      const results = await Promise.allSettled(
        deployments.map(async (d) => {
          try {
            const subagents = await vanillaClient.subagents.list.query({ deploymentId: d.id });
            return { id: d.id, subagents: (subagents || []).filter((s: any) => s.enabled) };
          } catch { return { id: d.id, subagents: [] as any[] }; }
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          const { id, subagents } = r.value;
          map.set(id, {
            supportsSubagents: subagents.length > 0,
            subagents: subagents.map((s: any) => ({ slug: s.slug, name: s.name, source: s.source || "custom" })),
            skills: [],
          });
        }
      }
      setCapabilitiesMap(map);
    };
    fetchCapabilities();
  }, [deployments]);

  const flows: FlowDefinition[] = useMemo(() => {
    if (!flowsQuery.data) return [];
    // Build a lookup map for enriching flow nodes with deployment data
    const depMap = new Map(deployments.map((d) => [d.id, d]));
    return (flowsQuery.data as unknown as ApiFlow[])
      .filter((f) => f.status !== "archived")
      .map((row) => {
        const flow = parseApiFlow(row);
        // Enrich nodes with full deployment data (API only stores deploymentId + label)
        flow.nodes = flow.nodes.map((n) => {
          const depId = (n as any).deploymentId || n.data?.id || n.id;
          const dep = depMap.get(depId);
          if (dep) {
            const caps = capabilitiesMap.get(depId);
            return { ...n, data: { ...dep, ...n.data, capabilities: caps } as FlowNodeData };
          }
          // Fallback: construct minimal data from stored fields
          return {
            ...n,
            data: {
              ...n.data,
              id: n.data?.id || depId,
              name: n.data?.name || (n as any).label || depId,
            } as FlowNodeData,
          };
        });
        return flow;
      });
  }, [flowsQuery.data, deployments, capabilitiesMap]);

  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);

  // Auto-select first flow when flows load (or after active flow is deleted)
  useEffect(() => {
    if (flows.length > 0 && (!activeFlowId || !flows.find((f) => f.id === activeFlowId))) {
      setActiveFlowId(flows[0].id);
    }
  }, [flows, activeFlowId]);

  const [isSaved, setIsSaved] = useState(true);

  // Local state mirror for optimistic updates during editing
  const [localOverrides, setLocalOverrides] = useState<Record<string, Partial<FlowDefinition>>>({});

  const activeFlow = useMemo(() => {
    const base = flows.find((f) => f.id === activeFlowId) ?? null;
    if (!base) return null;
    const overrides = activeFlowId ? localOverrides[activeFlowId] : undefined;
    return overrides ? { ...base, ...overrides } : base;
  }, [flows, activeFlowId, localOverrides]);

  const { state: execState, startExecution, resumeExecution, cancel } = useFlowExecution();

  // ── Mutations ─────────────────────────────────────────────────────

  // Mutations use setData-based optimistic cache updates instead of
  // invalidate+refetch. The refetch approach races with DB write propagation
  // (especially on Neon Postgres), causing stale reads to overwrite local
  // state — the root cause of multiple QA-reported data loss bugs:
  //   - "Save wipes added node" — new definition lost to stale refetch
  //   - "Rename lost on Save" — new name lost to stale refetch
  //   - "New button no-op until next Save" — new flow invisible until refetch
  //   - "Ghost tabs after server-side delete" — failed 404 not reconciled
  //
  // By writing directly to the cache with what we know the server now has,
  // we eliminate the race entirely.

  const createFlowMutation = trpc.flows.create.useMutation({
    onSuccess: (data, input) => {
      // Insert the newly-created flow into the list cache directly. We
      // construct the ApiFlow shape from the input + server-returned id.
      utils.flows.list.setData(undefined, (old: any) => {
        const newFlow = {
          id: data.id,
          name: input.name,
          description: input.description ?? null,
          definition: JSON.stringify(input.definition),
          status: input.status ?? "draft",
          isPublic: false,
          forkCount: 0,
          forkedFromId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        return old ? [newFlow, ...old] : [newFlow];
      });
      setActiveFlowId(data.id);
      setIsSaved(true);
    },
  });

  const updateFlowMutation = trpc.flows.update.useMutation({
    onSuccess: (_data, input) => {
      // Merge the input fields into the cached flow directly. The server
      // just persisted these exact values, so writing them to the cache is
      // authoritative. No refetch needed.
      utils.flows.list.setData(undefined, (old: any) => {
        if (!old) return old;
        return old.map((f: any) => {
          if (f.id !== input.id) return f;
          const merged: any = { ...f, updatedAt: new Date().toISOString() };
          if (input.name !== undefined) merged.name = input.name;
          if (input.description !== undefined) merged.description = input.description;
          if (input.definition !== undefined) merged.definition = JSON.stringify(input.definition);
          if (input.status !== undefined) merged.status = input.status;
          if (input.isPublic !== undefined) merged.isPublic = input.isPublic;
          if (input.entryNodeId !== undefined) merged.entryNodeId = input.entryNodeId;
          if (input.teamType !== undefined) merged.teamType = input.teamType;
          return merged;
        });
      });
      setIsSaved(true);
    },
    onError: (err) => {
      // Show a toast so the user knows the save failed — previously it was
      // silent and the user thought their work saved.
      toast.error(`Failed to save flow: ${err.message}`);
    },
  });

  const deleteFlowMutation = trpc.flows.delete.useMutation({
    onSuccess: (_data, input) => {
      // Remove the flow from the cache directly instead of invalidating.
      utils.flows.list.setData(undefined, (old: any) =>
        old ? old.filter((f: any) => f.id !== input.id) : old
      );
    },
    onError: (err, input) => {
      // Reconcile: if the server says the flow is already gone, remove it
      // from the local cache anyway (ghost tab bug). Otherwise show an error.
      if (err.data?.code === "NOT_FOUND") {
        utils.flows.list.setData(undefined, (old: any) =>
          old ? old.filter((f: any) => f.id !== input.id) : old
        );
        toast.info("Flow was already removed on the server — cleaned up locally");
      } else {
        toast.error(`Failed to delete flow: ${err.message}`);
      }
    },
  });

  // ── Create new flow ───────────────────────────────────────────────
  const handleNewFlow = useCallback(() => {
    const name = `Team ${flows.length + 1}`;
    createFlowMutation.mutate({
      name,
      definition: { nodes: [], edges: [], teamType: "hierarchy" } as any,
      status: "draft",
    });
  }, [flows.length, createFlowMutation]);

  // ── Update active flow (optimistic local state) ───────────────────
  const handleUpdateFlow = useCallback(
    (updates: Partial<FlowDefinition>) => {
      if (!activeFlowId) return;
      setLocalOverrides((prev) => ({
        ...prev,
        [activeFlowId]: { ...(prev[activeFlowId] ?? {}), ...updates },
      }));
      setIsSaved(false);
    },
    [activeFlowId]
  );

  // ── Save flow (persist local overrides to API) ────────────────────
  const handleSave = useCallback(() => {
    if (!activeFlowId || !activeFlow) return;
    const overrides = localOverrides[activeFlowId];
    if (!overrides) {
      setIsSaved(true);
      return;
    }

    type FlowNodeInput = {
      id: string;
      type: "deployment" | "transform" | "condition" | "output";
      deploymentId?: string;
      serviceId?: string;
      skillName?: string;
      label: string;
      config?: Record<string, unknown>;
      position: { x: number; y: number };
    };
    type FlowEdgeInput = {
      id: string;
      source: string;
      target: string;
      sourceHandle?: string;
      targetHandle?: string;
      label?: string;
      condition?: string;
    };
    const mutation: {
      id: string;
      name?: string;
      description?: string | null;
      definition?: { nodes: FlowNodeInput[]; edges: FlowEdgeInput[] };
      status?: "draft" | "published" | "archived";
    } = { id: activeFlowId };

    if (overrides.name !== undefined) mutation.name = overrides.name;
    if (overrides.description !== undefined) mutation.description = overrides.description;
    if (overrides.status !== undefined) mutation.status = overrides.status as "draft" | "published" | "archived";

    // Always send the current definition (nodes + edges may have changed)
    // Include orchestration fields (role, goal, canDelegate, etc.) in config
    mutation.definition = {
      nodes: activeFlow.nodes.map((n) => ({
        id: n.id,
        type: (n.type === "flowDeployment" ? "deployment" : (n.type ?? "deployment")) as "deployment" | "transform" | "condition" | "output",
        deploymentId: n.data?.id,
        label: n.data?.name ?? n.id,
        config: {
          role: n.data?.role || "",
          goal: n.data?.goal || "",
          canDelegate: n.data?.canDelegate ?? true,
          contextScope: n.data?.contextScope || "task",
          isEntryPoint: n.data?.isEntryPoint || false,
        } as Record<string, unknown>,
        position: n.position,
      })),
      edges: activeFlow.edges.map((e) => {
        const edgeData = (e.data as FlowEdgeData) || {};
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
          targetHandle: e.targetHandle ?? undefined,
          label: edgeData.edgeType || "delegates",
          condition: undefined,
        };
      }),
      // Store teamType in the definition JSON so it persists
      ...(activeFlow.teamType ? { teamType: activeFlow.teamType } : {}),
    } as typeof mutation.definition;

    updateFlowMutation.mutate(mutation, {
      onSuccess: () => {
        // The global updateFlowMutation.onSuccess handler already merged the
        // input into the query cache. We can safely clear the local override
        // now — the cache contains the authoritative post-save data, so
        // activeFlow (which reads from flows which reads from cache) will
        // show the saved state.
        setLocalOverrides((prev) => {
          const next = { ...prev };
          delete next[activeFlowId];
          return next;
        });
      },
    });
  }, [activeFlowId, activeFlow, localOverrides, updateFlowMutation]);

  // ── Delete flow ───────────────────────────────────────────────────
  const handleDeleteFlow = useCallback(() => {
    if (!activeFlowId) return;
    deleteFlowMutation.mutate(
      { id: activeFlowId, hard: true },
      {
        onSuccess: () => {
          // Clear local overrides for deleted flow
          setLocalOverrides((prev) => {
            const next = { ...prev };
            delete next[activeFlowId];
            return next;
          });
          const remaining = flows.filter((f) => f.id !== activeFlowId);
          setActiveFlowId(remaining[0]?.id ?? null);
          setIsSaved(true);
        },
      }
    );
  }, [activeFlowId, flows, deleteFlowMutation]);

  // ── Flow name change ──────────────────────────────────────────────
  const handleFlowNameChange = useCallback(
    (name: string) => {
      handleUpdateFlow({ name });
    },
    [handleUpdateFlow]
  );

  // ── Team type change ──────────────────────────────────────────────
  const handleTeamTypeChange = useCallback(
    (type: TeamType) => {
      if (!activeFlow) return;
      handleUpdateFlow({ teamType: type });
      // Auto re-layout with new topology
      const { nodes: layouted, edges } = getFlowLayoutedElements(
        activeFlow.nodes,
        activeFlow.edges,
        type,
      );
      handleUpdateFlow({ nodes: layouted, edges, teamType: type });
    },
    [activeFlow, handleUpdateFlow]
  );

  // ── Auto layout ───────────────────────────────────────────────────
  const handleAutoLayout = useCallback(() => {
    if (!activeFlow || activeFlow.nodes.length === 0) return;
    const { nodes: layouted, edges } = getFlowLayoutedElements(
      activeFlow.nodes,
      activeFlow.edges,
      activeFlow.teamType || "hierarchy",
    );
    handleUpdateFlow({ nodes: layouted, edges });
  }, [activeFlow, handleUpdateFlow]);

  // ── Run flow (auto-save first if unsaved) ────────────────────────
  const handleRun = useCallback(async () => {
    if (!activeFlowId) return;
    if (!isSaved) {
      handleSave();
    }
    startExecution(activeFlowId);
  }, [activeFlowId, isSaved, handleSave, startExecution]);

  // ── Cancel ────────────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    cancel();
  }, [cancel]);

  // ── Resume paused execution (HITL) ─────────────────────────────
  const handleResumeInput = useCallback(
    (nodeId: string, input: string) => {
      resumeExecution(nodeId, input);
    },
    [resumeExecution]
  );

  // ── Chat with team ────────────────────────────────────────────────
  const { getAccessTokenSilently } = useAuth0();
  const [showFlowChat, setShowFlowChat] = useState(false);
  const [flowChatMessages, setFlowChatMessages] = useState<Array<{
    role: string;
    content: string;
    delegations?: Array<{
      toolName: string;
      targetRole: string;
      status: "running" | "completed" | "failed";
      elapsedMs?: number;
      uiBlockCount?: number;
      error?: string;
    }>;
    skip?: {
      reason: "no_tools_available" | "tool_call_not_emitted" | "mentioned_but_not_emitted";
      availableToolCount: number;
      availableTools: string[];
    };
    /** Canvas cards produced by the team during this assistant turn. */
    canvasCards?: TeamCanvasCardData[];
  }>>([]);
  const [flowChatInput, setFlowChatInput] = useState("");
  const [flowChatLoading, setFlowChatLoading] = useState(false);

  // Track which (flowId, sessionId) we've already seeded from persistence
  // so the effect below doesn't clobber in-flight streaming messages
  // every time React re-runs it.
  const seededChatKeyRef = useRef<string | null>(null);

  // ── Session picker / new conversation / pagination state ─────────
  // `activeSessionId` is the session the user is currently looking at.
  //   - null while sessions are loading or after "New conversation"
  //   - set to the latest session when sessions first arrive (default
  //     behavior matches the prior single-session wire-up)
  // `pendingNewSessionId` is set when the user clicks "New conversation"
  // — it's the client-side id we'll pass to the write path so the next
  // sent message creates a fresh DB row. It's separate from
  // activeSessionId so that the seed effect doesn't try to fetch a
  // session that doesn't exist yet on the server.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isSessionPickerOpen, setIsSessionPickerOpen] = useState(false);
  const [pendingNewSessionId, setPendingNewSessionId] = useState<string | null>(
    null
  );

  // ── Session picker a11y + rename/delete state ────────────────────
  // `focusedSessionIdx` tracks the keyboard-focused row inside the
  // picker dropdown. -1 means "no row focused" (the picker just
  // opened, nothing highlighted yet). We use a separate state from
  // activeSessionId so arrow-key browsing doesn't mutate the session
  // the user is actually looking at.
  const [focusedSessionIdx, setFocusedSessionIdx] = useState<number>(-1);
  // Inline rename state — which session id is currently being renamed
  // and the draft title the user is typing. `null` = not renaming.
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null
  );
  const [renameDraft, setRenameDraft] = useState("");
  // Refs used by keyboard nav to keep the focused row visible in a
  // scrollable list and by the inline rename input for auto-focus.
  const sessionRowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Pagination state for "Load older messages". `hasMoreOlder` is true
  // when the most recent fetch returned exactly `limit` rows — meaning
  // there might be more older history we haven't seen yet.
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);

  // Aborts an in-flight chat stream when the user switches sessions or
  // starts a new conversation mid-generation. Without this, the prior
  // stream would keep mutating `flowChatMessages` after the user has
  // already moved on.
  const chatStreamAbortRef = useRef<AbortController | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  // Load persisted chat sessions for the active flow. Gated on
  // showFlowChat so we don't fire the query when the panel isn't
  // open (avoids wasted requests when the user is just editing the
  // graph). The tRPC procedures tolerate the tables not existing
  // (migration 0007 may not be applied) and return an empty array,
  // so we don't need a separate feature flag.
  const chatSessionsQuery = trpc.flows.getChatSessions.useQuery(
    { flowId: activeFlowId ?? "" },
    {
      enabled: !!activeFlowId && showFlowChat,
      // Sessions are append-mostly — don't refetch aggressively.
      staleTime: 30_000,
      retry: false,
    }
  );

  // The current effective session id we're loading messages for. When
  // the user has clicked "New conversation" we deliberately don't fetch
  // (the session doesn't exist yet) — `pendingNewSessionId` becomes the
  // sessionId on the first message via the write path's
  // `conversationId || threadId` fallback.
  const chatMessagesQuery = trpc.flows.getChatMessages.useQuery(
    { sessionId: activeSessionId ?? "" },
    {
      enabled: !!activeSessionId && showFlowChat,
      staleTime: 30_000,
      retry: false,
    }
  );

  // Initialize activeSessionId to the most recent session when sessions
  // first load for a flow. Sessions are already ordered DESC by
  // updatedAt, so [0] is the latest. This preserves the prior
  // single-session "continue latest" default behavior so anyone opening
  // the panel still sees their last conversation.
  useEffect(() => {
    if (!showFlowChat) return;
    if (activeSessionId !== null) return; // user already picked one
    if (pendingNewSessionId !== null) return; // user explicitly started new
    const sessions = chatSessionsQuery.data;
    if (!sessions || sessions.length === 0) return;
    setActiveSessionId(sessions[0].id);
  }, [
    showFlowChat,
    activeSessionId,
    pendingNewSessionId,
    chatSessionsQuery.data,
  ]);

  // Seed the local flowChatMessages state from persistence the first
  // time we have data for a given (flowId, sessionId) combination.
  // We intentionally DO NOT overwrite state on subsequent renders —
  // otherwise an in-flight streaming reply could get wiped out when
  // the query re-runs. `seededChatKeyRef` is our idempotency key.
  useEffect(() => {
    if (!showFlowChat || !activeFlowId) {
      // Reset so re-opening the panel re-seeds.
      seededChatKeyRef.current = null;
      return;
    }
    // Nothing to seed with yet.
    if (chatSessionsQuery.isLoading || chatMessagesQuery.isLoading) return;

    const key = `${activeFlowId}::${activeSessionId ?? "none"}`;
    if (seededChatKeyRef.current === key) return;

    const historyRows = chatMessagesQuery.data ?? [];
    if (historyRows.length > 0) {
      // Map DB rows into the local chat bubble shape. Only role and
      // content are displayed today; the other columns (sourceNodeId,
      // delegationToolName, etc.) are preserved on the server for
      // future UI needs.
      const mapped = historyRows.map((row) => ({
        role: row.role,
        content: row.content,
      }));
      setFlowChatMessages(mapped);
      // If the initial fetch came back full (200), more history may
      // exist — show the "Load older" button.
      setHasMoreOlder(historyRows.length >= 200);
    } else if (activeSessionId === null) {
      // No sessions at all for this flow — start with a clean slate.
      // Only clear if the current messages don't include any freshly
      // typed but unpersisted content (we use the ref to track that).
      setFlowChatMessages([]);
      setHasMoreOlder(false);
    } else {
      // Session is selected but came back empty — also clear.
      setFlowChatMessages([]);
      setHasMoreOlder(false);
    }
    seededChatKeyRef.current = key;
  }, [
    showFlowChat,
    activeFlowId,
    activeSessionId,
    chatSessionsQuery.isLoading,
    chatMessagesQuery.isLoading,
    chatMessagesQuery.data,
  ]);

  // When the user switches flows, clear the chat pane and force a
  // re-seed on the next open. Without this, opening a second flow
  // would briefly show the previous flow's messages. We also clear
  // the picker selection so the init effect picks the new flow's
  // latest session.
  useEffect(() => {
    setFlowChatMessages([]);
    setActiveSessionId(null);
    setPendingNewSessionId(null);
    setHasMoreOlder(false);
    seededChatKeyRef.current = null;
    // Abort any in-flight stream from the previous flow.
    chatStreamAbortRef.current?.abort();
    chatStreamAbortRef.current = null;
  }, [activeFlowId]);

  const handleChatWithTeam = useCallback(() => {
    if (!activeFlowId) return;
    setShowFlowChat(true);
  }, [activeFlowId]);

  // ── Session picker actions ──────────────────────────────────────
  // Switching to a different session aborts any in-flight stream
  // (otherwise the streaming reply would keep mutating state under
  // the new session's seeded history) and resets the seeding key so
  // the seed effect re-runs against the new session.
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      if (sessionId === activeSessionId) {
        setIsSessionPickerOpen(false);
        return;
      }
      chatStreamAbortRef.current?.abort();
      chatStreamAbortRef.current = null;
      setFlowChatLoading(false);
      setFlowChatMessages([]);
      setHasMoreOlder(false);
      setPendingNewSessionId(null);
      setActiveSessionId(sessionId);
      seededChatKeyRef.current = null;
      setIsSessionPickerOpen(false);
    },
    [activeSessionId]
  );

  // "New conversation" — clears local state and assigns a fresh client
  // -side session id which the next sent message will use as the
  // sessionId on the write path. We do NOT create a DB row here; the
  // write path's `convId = conversationId || threadId` upsert handles
  // that on first send.
  const handleNewConversation = useCallback(() => {
    chatStreamAbortRef.current?.abort();
    chatStreamAbortRef.current = null;
    setFlowChatLoading(false);
    setFlowChatMessages([]);
    setHasMoreOlder(false);
    setActiveSessionId(null);
    // Mint a fresh client-side session id. The server upsert at
    // routes/flowChat.ts uses `conversationId || threadId` as the row
    // id so this becomes the persisted session id on first send.
    const newId = `fcs_${Math.random().toString(36).slice(2, 14)}`;
    setPendingNewSessionId(newId);
    seededChatKeyRef.current = `${activeFlowId}::${newId}`;
    setIsSessionPickerOpen(false);
  }, [activeFlowId]);

  // ── Rename / delete mutations ───────────────────────────────────
  // Both mutations `refetch()` the sessions query on success so the
  // picker reflects the new title / the removed row immediately.
  // renameChatSession also keeps the inline edit UI in sync.
  const renameSessionMutation = trpc.flows.renameChatSession.useMutation({
    onSuccess: () => {
      void chatSessionsQuery.refetch();
      setRenamingSessionId(null);
      setRenameDraft("");
    },
  });
  const deleteSessionMutation = trpc.flows.deleteChatSession.useMutation({
    onSuccess: () => {
      void chatSessionsQuery.refetch();
    },
  });

  const commitRename = useCallback(
    (sessionId: string) => {
      const trimmed = renameDraft.trim();
      if (!trimmed) {
        // Empty title — cancel instead of firing a validation error.
        setRenamingSessionId(null);
        setRenameDraft("");
        return;
      }
      renameSessionMutation.mutate({ sessionId, title: trimmed.slice(0, 255) });
    },
    [renameDraft, renameSessionMutation]
  );

  const cancelRename = useCallback(() => {
    setRenamingSessionId(null);
    setRenameDraft("");
  }, []);

  const startRename = useCallback(
    (sessionId: string, currentTitle: string | null) => {
      setRenamingSessionId(sessionId);
      setRenameDraft(currentTitle ?? "Team Chat");
      // Focus the input on the next frame so it's actually in the DOM.
      requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
    },
    []
  );

  // Deletes a session. If the deleted session was the one the user is
  // currently viewing, we switch to the next newest remaining session
  // (or fall back to a "new conversation" empty state if this was the
  // only one). The sessions query is refetched in the mutation's
  // onSuccess handler above.
  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      // Simple modal-free confirm — picker is a small dropdown so a
      // heavyweight AlertDialog would be visually overkill.
      if (
        !window.confirm(
          "Delete this conversation? This cannot be undone."
        )
      ) {
        return;
      }

      const sessions = chatSessionsQuery.data ?? [];
      const wasActive = sessionId === activeSessionId;

      deleteSessionMutation.mutate({ sessionId });

      if (wasActive) {
        // Find the next newest session other than the one being
        // deleted. Sessions are already ordered DESC by updatedAt.
        const remaining = sessions.filter((s) => s.id !== sessionId);
        // Abort any in-flight stream bound to the deleted session so
        // its result doesn't bleed into whatever we switch to.
        chatStreamAbortRef.current?.abort();
        chatStreamAbortRef.current = null;
        setFlowChatLoading(false);
        setFlowChatMessages([]);
        setHasMoreOlder(false);
        seededChatKeyRef.current = null;

        if (remaining.length > 0) {
          setActiveSessionId(remaining[0].id);
          setPendingNewSessionId(null);
        } else {
          // Last session — fall back to the new-conversation state.
          setActiveSessionId(null);
          const newId = `fcs_${Math.random().toString(36).slice(2, 14)}`;
          setPendingNewSessionId(newId);
          seededChatKeyRef.current = `${activeFlowId}::${newId}`;
        }
      }
    },
    [
      activeFlowId,
      activeSessionId,
      chatSessionsQuery.data,
      deleteSessionMutation,
    ]
  );

  // Keep `focusedSessionIdx` within bounds when sessions change
  // (e.g. after a delete). -1 means "no row focused".
  useEffect(() => {
    const count = chatSessionsQuery.data?.length ?? 0;
    if (count === 0) {
      setFocusedSessionIdx(-1);
      return;
    }
    setFocusedSessionIdx((idx) => (idx >= count ? count - 1 : idx));
  }, [chatSessionsQuery.data]);

  // Reset the focused idx whenever the picker opens — start with no
  // highlighted row so the first ArrowDown lands on idx 0.
  useEffect(() => {
    if (!isSessionPickerOpen) {
      setFocusedSessionIdx(-1);
    }
  }, [isSessionPickerOpen]);

  // Scroll the focused row into view when it changes via keyboard nav.
  useEffect(() => {
    if (focusedSessionIdx < 0) return;
    const sessions = chatSessionsQuery.data ?? [];
    const session = sessions[focusedSessionIdx];
    if (!session) return;
    const el = sessionRowRefs.current[session.id];
    el?.scrollIntoView({ block: "nearest" });
  }, [focusedSessionIdx, chatSessionsQuery.data]);

  // Keyboard handler wired to the listbox container. The branching
  // order matters: Escape always closes, Enter/ArrowUp/ArrowDown only
  // fire when not in rename mode (so typing into the rename input
  // doesn't get hijacked), and Delete/Backspace need a modifier so a
  // stray keypress doesn't nuke a session without confirmation.
  const handleSessionPickerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (renamingSessionId !== null) {
        // Renaming — let the input's own handler take over.
        return;
      }
      const sessions = chatSessionsQuery.data ?? [];
      const count = sessions.length;
      if (count === 0) return;

      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          setFocusedSessionIdx((idx) => (idx + 1) % count);
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          setFocusedSessionIdx((idx) =>
            idx <= 0 ? count - 1 : idx - 1
          );
          break;
        }
        case "Enter": {
          if (focusedSessionIdx >= 0 && focusedSessionIdx < count) {
            event.preventDefault();
            handleSelectSession(sessions[focusedSessionIdx].id);
          }
          break;
        }
        case "Escape": {
          event.preventDefault();
          setIsSessionPickerOpen(false);
          break;
        }
        case "Delete":
        case "Backspace": {
          // Require a modifier so a stray keypress can't delete a
          // session. Shift+Delete is the canonical "destructive
          // shortcut" idiom in most desktop UIs.
          if (!(event.shiftKey || event.metaKey || event.ctrlKey)) return;
          if (focusedSessionIdx < 0 || focusedSessionIdx >= count) return;
          event.preventDefault();
          handleDeleteSession(sessions[focusedSessionIdx].id);
          break;
        }
      }
    },
    [
      chatSessionsQuery.data,
      focusedSessionIdx,
      handleSelectSession,
      handleDeleteSession,
      renamingSessionId,
    ]
  );

  // ── Load older messages (cursor-based) ──────────────────────────
  // Fires only when we have a session id and at least one message in
  // local state (so we have a cursor). Calls the tRPC procedure
  // directly via the vanilla client to avoid creating a separate query
  // — this is a fire-and-forget read whose result we prepend manually
  // to preserve scroll position.
  const handleLoadOlder = useCallback(async () => {
    if (!activeSessionId || loadingOlder || flowChatMessages.length === 0)
      return;
    // We need a stable cursor — the oldest currently-loaded message id.
    // The seed effect maps DB rows into local shape losing the id, so
    // we have to look it up from the chatMessagesQuery cache.
    const dbRows = chatMessagesQuery.data ?? [];
    if (dbRows.length === 0) {
      setHasMoreOlder(false);
      return;
    }
    const oldestId = dbRows[0].id;
    if (!oldestId) {
      setHasMoreOlder(false);
      return;
    }

    setLoadingOlder(true);
    // Snapshot scroll metrics so we can restore position after prepend.
    const list = messageListRef.current;
    const prevScrollHeight = list?.scrollHeight ?? 0;
    const prevScrollTop = list?.scrollTop ?? 0;

    try {
      const olderRows = await vanillaClient.flows.getChatMessages.query({
        sessionId: activeSessionId,
        limit: 200,
        beforeId: oldestId,
      });

      if (olderRows.length === 0) {
        setHasMoreOlder(false);
        return;
      }

      // Prepend to BOTH the cache-shaped list (for future cursor
      // lookups via the React-Query cache) and the local UI state.
      const mappedOlder = olderRows.map((row) => ({
        role: row.role,
        content: row.content,
      }));
      setFlowChatMessages((prev) => [...mappedOlder, ...prev]);
      setHasMoreOlder(olderRows.length >= 200);

      // Mutate the React-Query cache so subsequent "load older" clicks
      // use the new oldest id as their cursor. Without this, we'd
      // re-paginate from the same anchor and create duplicates.
      utils.flows.getChatMessages.setData(
        { sessionId: activeSessionId },
        (existing) => {
          if (!existing) return olderRows as any;
          return [...olderRows, ...existing] as any;
        }
      );

      // Restore scroll: keep the user's viewport anchored to the same
      // message they were looking at, not jumping to the top.
      requestAnimationFrame(() => {
        const next = messageListRef.current;
        if (!next) return;
        const newScrollHeight = next.scrollHeight;
        next.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
      });
    } catch (err) {
      // Soft fail — just log and let the user retry. The button stays
      // visible so they can try again.
      console.warn("[flow-chat] load older failed", err);
    } finally {
      setLoadingOlder(false);
    }
  }, [
    activeSessionId,
    loadingOlder,
    flowChatMessages.length,
    chatMessagesQuery.data,
  ]);

  // Remove a canvas card from its assistant message. Used by the X button
  // on each inline TeamChatCanvasCard. Matches the dedupe-by-id semantics
  // used when the card is added from a uiblock event.
  const handleRemoveCanvasCard = useCallback((cardId: string) => {
    setFlowChatMessages((prev) =>
      prev.map((msg) => {
        if (msg.role !== "assistant" || !msg.canvasCards?.length) return msg;
        const next = msg.canvasCards.filter((c) => c.id !== cardId);
        if (next.length === msg.canvasCards.length) return msg;
        return { ...msg, canvasCards: next };
      }),
    );
  }, []);

  const handleFlowChatSend = useCallback(async () => {
    if (!flowChatInput.trim() || !activeFlowId || flowChatLoading) return;
    const userMsg = flowChatInput.trim();
    setFlowChatInput("");
    setFlowChatMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setFlowChatLoading(true);

    // Determine which session this message should bind to. Priority:
    //   1. activeSessionId (user is continuing an existing session)
    //   2. pendingNewSessionId (user clicked "New conversation")
    //   3. mint a fresh id (first-ever message for this flow, or user
    //      reopened the panel after a flow switch)
    // The server uses `conversationId || threadId` as the persisted
    // session row id, so passing conversationId is what locks the
    // write path to a single session row across multiple sends.
    const sessionIdForSend =
      activeSessionId ??
      pendingNewSessionId ??
      `fcs_${Math.random().toString(36).slice(2, 14)}`;
    const wasNewSession = activeSessionId === null;

    // Wire up an AbortController so session-switch / new-conversation /
    // panel-close can interrupt the stream.
    const abortController = new AbortController();
    chatStreamAbortRef.current?.abort();
    chatStreamAbortRef.current = abortController;

    try {
      const token = await getAccessTokenSilently();
      const res = await fetch(`${API_URL}/api/flows/${activeFlowId}/chat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          conversationId: sessionIdForSend,
        }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        setFlowChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err}` }]);
      } else {
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let assistantText = "";

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "TEXT_MESSAGE_CONTENT" && data.delta) {
                assistantText += data.delta;
                setFlowChatMessages((prev) => {
                  const msgs = [...prev];
                  const last = msgs[msgs.length - 1];
                  if (last?.role === "assistant") {
                    msgs[msgs.length - 1] = { ...last, content: assistantText };
                  } else {
                    msgs.push({ role: "assistant", content: assistantText });
                  }
                  return msgs;
                });
              } else if (data.type === "CUSTOM" || data.type === "custom") {
                const name = data.name || data.value?.name;
                const value = data.value || {};

                if (name === "jarble.flow.delegation.start") {
                  // Add delegation status indicator
                  setFlowChatMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.role === "assistant") {
                      const delegations = [...(last.delegations || []), {
                        toolName: value.toolName,
                        targetRole: value.targetRole || "Team member",
                        status: "running" as const,
                      }];
                      return [...prev.slice(0, -1), { ...last, delegations }];
                    }
                    return prev;
                  });
                } else if (name === "jarble.flow.delegation.heartbeat") {
                  // Update elapsed time on running delegation
                  setFlowChatMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.role === "assistant" && last.delegations) {
                      const delegations = last.delegations.map((d) =>
                        d.toolName === value.toolName && d.status === "running"
                          ? { ...d, elapsedMs: value.elapsedMs }
                          : d
                      );
                      return [...prev.slice(0, -1), { ...last, delegations }];
                    }
                    return prev;
                  });
                } else if (name === "jarble.flow.delegation.end") {
                  // Mark delegation as completed or failed
                  setFlowChatMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.role === "assistant" && last.delegations) {
                      const delegations = last.delegations.map((d) =>
                        d.toolName === value.toolName
                          ? {
                              ...d,
                              status: (value.success ? "completed" : "failed") as "completed" | "failed",
                              uiBlockCount: value.uiBlockCount,
                              error: value.error,
                            }
                          : d
                      );
                      return [...prev.slice(0, -1), { ...last, delegations }];
                    }
                    return prev;
                  });
                } else if (name === "jarble.flow.delegation.skipped") {
                  // Surface WHY delegation didn't happen. See Fix #6 in
                  // docs/audits/qa-bot-teams-2026-04-07.md — the key case is
                  // `mentioned_but_not_emitted` where the bot claims to delegate
                  // but never emits a valid tool_call JSON block.
                  const skip = {
                    reason: value.reason as "no_tools_available" | "tool_call_not_emitted" | "mentioned_but_not_emitted",
                    availableToolCount: value.availableToolCount ?? 0,
                    availableTools: Array.isArray(value.availableTools) ? value.availableTools : [],
                  };
                  setFlowChatMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.role === "assistant") {
                      return [...prev.slice(0, -1), { ...last, skip }];
                    }
                    return [...prev, { role: "assistant", content: "", skip }];
                  });
                } else if (name === "jarble.flow.delegation.uiblock") {
                  // A delegated specialist produced a UI block. Backend
                  // already extracted the JarbleUIBlock and tagged it with
                  // the producer's deploymentId + role — see
                  // jarble-api-main/src/routes/flowChat.ts:591-604.
                  // Attach it to the current assistant bubble as a
                  // canvas card with producer attribution. This is the
                  // team-chat counterpart of the TOOL_CALL_* rail used by
                  // the individual deployment chat (useCanvasChat.ts).
                  const rawBlock = value.block;
                  if (rawBlock && typeof rawBlock === "object" && rawBlock.component) {
                    // Compute the id fallback exactly once so card.id and
                    // block.id stay in lockstep — the dedupe guard below
                    // keys off card.id while CanvasRenderer keys off
                    // block.id, and any drift between them would break
                    // reconnect/replay dedupe.
                    const stableId =
                      rawBlock.id || `team-card-${Math.random().toString(36).slice(2, 10)}`;
                    const newCard: TeamCanvasCardData = {
                      id: stableId,
                      block: {
                        id: stableId,
                        component: rawBlock.component,
                        props: rawBlock.props ?? {},
                        editable: rawBlock.editable,
                        fileId: rawBlock.fileId,
                        saveMethod: rawBlock.saveMethod,
                      },
                      producerDeploymentId: String(value.sourceDeploymentId ?? ""),
                      producerRole: String(value.sourceRole ?? "Team member"),
                      delegationToolName: value.delegationToolName
                        ? String(value.delegationToolName)
                        : undefined,
                      origin: "delegation",
                    };
                    setFlowChatMessages((prev) => {
                      const last = prev[prev.length - 1];
                      // Mirror the delegation.start pattern: create an
                      // assistant bubble if none exists yet, so a uiblock
                      // event arriving before any text delta doesn't get
                      // silently dropped.
                      if (!last || last.role !== "assistant") {
                        return [
                          ...prev,
                          { role: "assistant", content: "", canvasCards: [newCard] },
                        ];
                      }
                      // Deduplicate by card id so a reconnect / replay
                      // doesn't stack the same card twice.
                      const existing = last.canvasCards ?? [];
                      if (existing.some((c) => c.id === newCard.id)) {
                        return prev;
                      }
                      return [
                        ...prev.slice(0, -1),
                        { ...last, canvasCards: [...existing, newCard] },
                      ];
                    });
                  }
                }
              }
            } catch {
              // skip non-JSON lines
            }
          }
        }

        if (!assistantText) {
          setFlowChatMessages((prev) => [...prev, { role: "assistant", content: "(No response)" }]);
        }
      }

      // ── Post-success bookkeeping ────────────────────────────────
      // If this was a new session (either a fresh "New conversation"
      // or first message ever), the server has now created the row
      // with id = sessionIdForSend. Bind activeSessionId so future
      // sends + the messages query target the right row, then
      // refetch the session list so it shows up in the picker.
      if (wasNewSession) {
        setActiveSessionId(sessionIdForSend);
        setPendingNewSessionId(null);
        // Mark as already-seeded so the seed effect doesn't try to
        // wipe the just-streamed messages with whatever the new
        // chatMessagesQuery returns.
        seededChatKeyRef.current = `${activeFlowId}::${sessionIdForSend}`;
      }
      // Refresh the sidebar/picker — the session's updatedAt and
      // possibly its title may have changed.
      void chatSessionsQuery.refetch();
    } catch (err: any) {
      // Aborted streams (session switch / new conversation / unmount)
      // are intentional — don't surface as an error message.
      if (err?.name === "AbortError") {
        return;
      }
      setFlowChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      // Only clear loading + the abort ref if WE are still the
      // current stream — a session switch may have already started
      // a new send and we don't want to clobber its state.
      if (chatStreamAbortRef.current === abortController) {
        chatStreamAbortRef.current = null;
        setFlowChatLoading(false);
      }
    }
  }, [
    flowChatInput,
    activeFlowId,
    flowChatLoading,
    getAccessTokenSilently,
    activeSessionId,
    pendingNewSessionId,
    chatSessionsQuery,
  ]);

  // ── Derived state ──────────────────────────────────────────────────
  const entryNode = activeFlow?.nodes.find((n) => n.data?.isEntryPoint);
  const entryNodeName = entryNode?.data?.name ?? null;

  const isExecuting = execState.status === "running" || execState.status === "paused";
  const isLoading = flowsQuery.isLoading;
  const isMutating = createFlowMutation.isPending || updateFlowMutation.isPending || deleteFlowMutation.isPending;

  // ── Loading skeleton ──────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col flex-1 min-h-0 p-4 gap-3">
        <div className="flex gap-2">
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-7 w-20 rounded-full" />
        </div>
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Flow list pills */}
      <div className="px-3 pt-2">
        <FlowListSidebar
          flows={flows}
          activeFlowId={activeFlowId}
          onSelectFlow={setActiveFlowId}
          deployments={deployments}
          executingFlowId={execState.steps.size > 0 ? activeFlowId : null}
        />
      </div>

      {/* Flow toolbar */}
      <FlowToolbar
        flowName={activeFlow?.name ?? ""}
        onFlowNameChange={handleFlowNameChange}
        onRun={handleRun}
        onCancel={handleCancel}
        onSave={handleSave}
        onAutoLayout={handleAutoLayout}
        onNewFlow={handleNewFlow}
        onDeleteFlow={handleDeleteFlow}
        onChatWithTeam={handleChatWithTeam}
        isExecuting={isExecuting}
        isSaved={isSaved && !isMutating}
        totalCredits={execState.totalCredits}
        hasFlow={!!activeFlow}
        teamType={activeFlow?.teamType ?? "hierarchy"}
        onTeamTypeChange={handleTeamTypeChange}
        entryNodeName={entryNodeName}
      />

      {/* Canvas or empty state. Use flex-row so Chat panel docks beside the
          canvas (pushes it, doesn't overlay it). showFlowChat adds a sibling
          on the right — the ReactFlow canvas shrinks to fit. */}
      {activeFlow ? (
        <div className="flex-1 flex flex-row min-h-0 relative">
          {/* Canvas column: holds the flow canvas + execution timeline */}
          <div className="flex-1 flex flex-col min-w-0 relative">
          <ReactFlowProvider>
            <FlowCanvas
              deployments={deployments}
              flow={activeFlow}
              onUpdateFlow={handleUpdateFlow}
              executionSteps={execState.steps}
              pausedNodeId={execState.pausedNodeId}
              onResumeInput={handleResumeInput}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
            />
          </ReactFlowProvider>

          {/* Execution timeline at bottom when flow is executing */}
          {execState.status !== "idle" && (
            <FlowExecutionTimeline
              steps={Array.from(execState.steps.values()).map((s): FlowExecutionStep => ({
                nodeId: s.nodeId,
                label: s.label,
                status: s.status,
                durationMs: s.durationMs,
                credits: s.credits,
              }))}
              totalCredits={execState.totalCredits}
              status={execState.status}
              onClose={() => {
                // Only allow closing if not actively running
                if (execState.status !== "running") {
                  cancel();
                }
              }}
            />
          )}
          </div>
          {/* /canvas column */}

          {/* Chat with Team panel — docked side drawer. Previously used
              `absolute right-0 top-0 bottom-0` which overlaid the canvas
              and hid nodes on the right side of the graph. Now it's a
              sibling flex child that takes up its own space. */}
          {showFlowChat && (
            <div className="relative w-96 shrink-0 bg-card border-l border-border z-10 flex flex-col">
              <div className="flex items-center justify-between p-3 border-b border-border">
                {/* Session picker — replaces the static "Chat with Team"
                    title with a dropdown that lists persisted sessions
                    for this flow. The dropdown is rendered absolutely
                    so it doesn't push the chat panel layout around. */}
                <div className="relative flex-1 min-w-0 mr-2">
                  {chatSessionsQuery.data && chatSessionsQuery.data.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setIsSessionPickerOpen((v) => !v)}
                      className="flex items-center gap-1.5 text-sm font-semibold hover:text-foreground/80 transition-colors min-w-0 max-w-full"
                      title="Switch conversation"
                    >
                      <MessageSquare className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        {(() => {
                          const sessions = chatSessionsQuery.data;
                          const active =
                            sessions.find((s) => s.id === activeSessionId) ??
                            sessions[0];
                          return active?.title || "Team Chat";
                        })()}
                      </span>
                      <ChevronDown
                        className={`w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform ${isSessionPickerOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                  ) : (
                    <h3 className="text-sm font-semibold flex items-center gap-1.5 truncate">
                      <MessageSquare className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        {chatSessionsQuery.isLoading
                          ? "Loading…"
                          : "Start your first conversation"}
                      </span>
                    </h3>
                  )}

                  {isSessionPickerOpen &&
                    chatSessionsQuery.data &&
                    chatSessionsQuery.data.length > 0 && (
                      <>
                        {/* Click-outside backdrop */}
                        <div
                          className="fixed inset-0 z-[60]"
                          onClick={() => setIsSessionPickerOpen(false)}
                        />
                        <div
                          role="listbox"
                          aria-label="Chat sessions"
                          tabIndex={0}
                          onKeyDown={handleSessionPickerKeyDown}
                          // Autofocus the listbox on open so keyboard nav
                          // works without the user having to click inside
                          // it first.
                          ref={(el) => {
                            if (el && isSessionPickerOpen) {
                              // Only focus if no child (e.g. rename input)
                              // is already focused.
                              if (!el.contains(document.activeElement)) {
                                el.focus();
                              }
                            }
                          }}
                          className="absolute left-0 top-full mt-1 w-72 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg z-[61] outline-none focus:ring-1 focus:ring-ring/40"
                        >
                          <button
                            type="button"
                            onClick={handleNewConversation}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-secondary transition-colors border-b border-border"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>New conversation</span>
                          </button>
                          {chatSessionsQuery.data.map((session, idx) => {
                            const isActive = session.id === activeSessionId;
                            const isFocused = idx === focusedSessionIdx;
                            const isRenaming = renamingSessionId === session.id;
                            // Inline relative-time formatter — no
                            // dependency on date-fns, kept tiny.
                            const ts = session.updatedAt
                              ? new Date(session.updatedAt as any).getTime()
                              : 0;
                            const diffMs = ts ? Date.now() - ts : 0;
                            const diffMin = Math.floor(diffMs / 60_000);
                            const diffHr = Math.floor(diffMin / 60);
                            const diffDay = Math.floor(diffHr / 24);
                            let rel = "";
                            if (!ts) rel = "";
                            else if (diffMin < 1) rel = "just now";
                            else if (diffMin < 60) rel = `${diffMin}m ago`;
                            else if (diffHr < 24) rel = `${diffHr}h ago`;
                            else if (diffDay === 1) rel = "yesterday";
                            else if (diffDay < 7) rel = `${diffDay}d ago`;
                            else
                              rel = new Date(
                                session.updatedAt as any
                              ).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              });
                            const msgCount = (session as any).messageCount ?? 0;
                            return (
                              <div
                                key={session.id}
                                role="option"
                                aria-selected={isActive}
                                className={`group relative flex items-center justify-between gap-2 px-3 py-2 text-xs text-left transition-colors ${
                                  isActive
                                    ? "bg-primary/10 text-foreground"
                                    : isFocused
                                      ? "bg-secondary text-foreground"
                                      : "text-muted-foreground hover:bg-secondary"
                                }`}
                              >
                                {isRenaming ? (
                                  <input
                                    ref={renameInputRef}
                                    value={renameDraft}
                                    onChange={(e) =>
                                      setRenameDraft(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        commitRename(session.id);
                                      } else if (e.key === "Escape") {
                                        e.preventDefault();
                                        cancelRename();
                                      }
                                      // Stop the listbox's keyboard handler
                                      // from hijacking these keys.
                                      e.stopPropagation();
                                    }}
                                    onBlur={() => commitRename(session.id)}
                                    maxLength={255}
                                    className="flex-1 min-w-0 bg-background border border-border rounded px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                                  />
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      ref={(el) => {
                                        sessionRowRefs.current[session.id] =
                                          el;
                                      }}
                                      onClick={() =>
                                        handleSelectSession(session.id)
                                      }
                                      onMouseEnter={() =>
                                        setFocusedSessionIdx(idx)
                                      }
                                      className="truncate flex-1 text-left min-w-0"
                                    >
                                      <span className="truncate block">
                                        {session.title || "Team Chat"}
                                      </span>
                                    </button>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <span className="text-[10px] text-muted-foreground/70">
                                        {rel}
                                        {msgCount > 0 && (
                                          <>
                                            {" "}
                                            <span className="text-muted-foreground/50">
                                              · {msgCount} msg
                                              {msgCount === 1 ? "" : "s"}
                                            </span>
                                          </>
                                        )}
                                      </span>
                                      {/* Rename + delete icons — visible
                                          on hover or when the row is
                                          keyboard-focused. Kept small so
                                          they don't dominate the row. */}
                                      <div
                                        className={`flex items-center gap-0.5 transition-opacity ${
                                          isFocused
                                            ? "opacity-100"
                                            : "opacity-0 group-hover:opacity-100"
                                        }`}
                                      >
                                        <button
                                          type="button"
                                          aria-label="Rename conversation"
                                          title="Rename"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            startRename(
                                              session.id,
                                              session.title
                                            );
                                          }}
                                          className="p-1 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                                        >
                                          <Pencil className="w-3 h-3" />
                                        </button>
                                        <button
                                          type="button"
                                          aria-label="Delete conversation"
                                          title="Delete"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteSession(session.id);
                                          }}
                                          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                </div>
                <button type="button" onClick={() => setShowFlowChat(false)} className="p-1 rounded hover:bg-secondary shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div ref={messageListRef} className="flex-1 overflow-y-auto p-3 space-y-3">
                {/* Load older messages — visible only when there's a
                    session selected, at least one message loaded, and
                    the most recent fetch hinted at more history. */}
                {hasMoreOlder && flowChatMessages.length > 0 && (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={handleLoadOlder}
                      disabled={loadingOlder}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50 border border-border/60"
                    >
                      {loadingOlder ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <ChevronUp className="w-3 h-3" />
                      )}
                      {loadingOlder ? "Loading…" : "Load older messages"}
                    </button>
                  </div>
                )}
                {flowChatMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <MessageSquare className="w-8 h-8 text-muted-foreground/30 mb-3" />
                    <p className="text-xs text-muted-foreground">Send a message to your bot team</p>
                    {entryNodeName && (
                      <p className="text-[10px] text-muted-foreground/60 mt-1">
                        Messages go to {entryNodeName} (entry point)
                      </p>
                    )}
                  </div>
                )}
                {flowChatMessages.map((msg, i) => (
                  <div key={i} className={`text-sm ${msg.role === "user" ? "text-right" : ""}`}>
                    {(msg.content || msg.delegations?.length || msg.skip || msg.role === "user") && (
                    <div className={`inline-block max-w-[85%] rounded-lg px-3 py-2 ${
                      msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary"
                    }`}>
                      {msg.content}
                      {/* Delegation status indicators */}
                      {msg.delegations && msg.delegations.length > 0 && (
                        <div className="mt-2 space-y-1 border-t border-border/30 pt-2">
                          {msg.delegations.map((d, di) => (
                            <div key={di} className="flex items-center gap-2 text-[10px]">
                              {d.status === "running" && (
                                <span className="inline-flex items-center gap-1 text-blue-400">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                                  Delegating to {d.targetRole}...
                                  {d.elapsedMs && <span className="text-muted-foreground">{Math.round(d.elapsedMs / 1000)}s</span>}
                                </span>
                              )}
                              {d.status === "completed" && (
                                <span className="inline-flex items-center gap-1 text-emerald-400">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                  {d.targetRole} responded
                                  {d.uiBlockCount ? ` (${d.uiBlockCount} components)` : ""}
                                </span>
                              )}
                              {d.status === "failed" && (
                                <span className="inline-flex items-center gap-1 text-red-400">
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                                  {d.targetRole} failed{d.error ? `: ${d.error}` : ""}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Delegation skipped indicator (Fix #6 — surface silent failure) */}
                      {msg.skip && msg.skip.reason === "mentioned_but_not_emitted" && (
                        <div className="mt-2 p-2 rounded border border-amber-400/30 bg-amber-500/5 text-[10px] text-amber-300">
                          <div className="font-medium">Delegation didn't actually run</div>
                          <div className="text-amber-300/80 mt-0.5">
                            The entry bot claimed to delegate but never emitted a valid tool call.
                            {msg.skip.availableTools.length > 0 && (
                              <> Available: {msg.skip.availableTools.join(", ")}.</>
                            )}
                          </div>
                        </div>
                      )}
                      {msg.skip && msg.skip.reason === "tool_call_not_emitted" && msg.skip.availableToolCount > 0 && (
                        <div className="mt-2 text-[10px] text-muted-foreground italic">
                          Entry bot answered directly ({msg.skip.availableToolCount} team tool{msg.skip.availableToolCount === 1 ? "" : "s"} available, none used)
                        </div>
                      )}
                    </div>
                    )}
                    {/* Inline canvas cards — one per UI block produced by a
                        delegated specialist during this assistant turn. Cards
                        render below the bubble so their full-width layout
                        doesn't fight the 85% bubble cap. Each card carries
                        the producer attribution (deployment + role) from
                        jarble.flow.delegation.uiblock. */}
                    {msg.role === "assistant" && msg.canvasCards && msg.canvasCards.length > 0 && (
                      <div className="mt-1 space-y-1.5" data-testid="team-chat-canvas-cards">
                        {msg.canvasCards.map((card) => (
                          <TeamChatCanvasCard
                            key={card.id}
                            card={card}
                            onRemove={handleRemoveCanvasCard}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {flowChatLoading && (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="w-3 h-3 animate-spin" /> Thinking...
                  </div>
                )}
              </div>
              <div className="p-3 border-t border-border">
                <div className="flex gap-2">
                  <input
                    value={flowChatInput}
                    onChange={(e) => setFlowChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleFlowChatSend()}
                    placeholder="Message the team..."
                    className="flex-1 bg-secondary rounded-lg px-3 py-2 text-sm outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleFlowChatSend}
                    disabled={flowChatLoading}
                    className="p-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center">
              <Users className="w-8 h-8 text-primary/40" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Build Your Bot Team</h3>
            <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
              Wire your bots together into coordinated teams. Define roles, delegation paths, and communication channels.
            </p>
            <Button
              onClick={handleNewFlow}
              size="lg"
              disabled={createFlowMutation.isPending}
            >
              {createFlowMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Create Your First Team
            </Button>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// ─── CSS for flow animations (injected once) ─────────────────────────

function FlowAnimationStyles() {
  return (
    <style>{`
      @keyframes flow-dash {
        to {
          stroke-dashoffset: -12;
        }
      }
      @keyframes flow-spin {
        to {
          transform: rotate(360deg);
        }
      }
      /* Smooth hover transitions for flow nodes */
      .react-flow__node {
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        overflow: visible !important;
      }
      /* Ensure handles are always interactive, visible, and above node content */
      .react-flow__handle {
        z-index: 20 !important;
        pointer-events: all !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
      .react-flow__handle.source {
        width: 20px !important;
        height: 20px !important;
        background: #3b82f6 !important;
        border: 3px solid #1e3a5f !important;
        border-radius: 50% !important;
        box-shadow: 0 0 6px rgba(59,130,246,0.5) !important;
        right: -10px !important;
      }
      .react-flow__handle.target {
        width: 20px !important;
        height: 20px !important;
        background: #10b981 !important;
        border: 3px solid #064e3b !important;
        border-radius: 50% !important;
        box-shadow: 0 0 6px rgba(16,185,129,0.5) !important;
        left: -10px !important;
      }
      .react-flow__handle:hover {
        transform: scale(1.4) !important;
        box-shadow: 0 0 12px rgba(59,130,246,0.8) !important;
      }
      /* Edge label animations */
      .react-flow__edge-text {
        transition: fill 0.2s ease;
      }
      /* Connection line animation */
      .react-flow__connection-line {
        stroke-dasharray: 6 3;
        animation: flow-dash 0.6s linear infinite;
      }
      /* MiniMap styling */
      .react-flow__minimap {
        border-radius: 8px;
      }
    `}</style>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export default function Deployments() {
  const { isAuthenticated, isLoading: authLoading } = useAuth0();
  const router = useRouter();
  const { theme } = useTheme();
  const logoSrc = theme === "dark" ? "/logodark.png" : "/logo.png";
  const [activeRuntime, setActiveRuntime] = useState("all");
  const [showCreditPools, setShowCreditPools] = useState(true);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<
    string | null
  >(null);
  const [activeTab, setActiveTab] = useState("deployments");

  const deploymentsQuery = trpc.deployment.list.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading,
  });

  const runtimesQuery = trpc.runtimeCatalog.list.useQuery();

  const runtimeSlugs = useMemo(() => {
    if (!deploymentsQuery.data) return [];
    const slugs = new Set<string>();
    for (const d of deploymentsQuery.data as any as DeploymentData[]) {
      slugs.add(d.runtime);
    }
    return Array.from(slugs);
  }, [deploymentsQuery.data]);

  const runtimeNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const slug of runtimeSlugs) {
      const entry = (runtimesQuery.data as any[])?.find(
        (r: any) => r.slug === slug
      );
      map[slug] = entry?.name || slug;
    }
    return map;
  }, [runtimeSlugs, runtimesQuery.data]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 bg-card border-border text-center">
          <p className="text-muted-foreground mb-4">
            Please log in to view your linked deployments
          </p>
          <Button onClick={() => (window.location.href = "/login")}>
            Sign In
          </Button>
        </Card>
      </div>
    );
  }

  const deployments =
    (deploymentsQuery.data as any as DeploymentData[]) || [];
  const selectedDeployment = selectedDeploymentId
    ? deployments.find((d) => d.id === selectedDeploymentId) || null
    : null;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <FlowAnimationStyles />

      {/* Navigation */}
      <nav className="border-b border-border/60 sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex justify-between items-center">
          <a
            href="/"
            className="flex items-center gap-2 cursor-pointer no-underline text-foreground"
          >
            <Image src={logoSrc} alt="Jarble" width={120} height={36} className="h-12 w-auto" />
          </a>
          <ProfileDropdown />
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 w-full flex flex-col flex-1">
        {/* Header */}
        <div className="pt-6 pb-3">
          <h1 className="text-2xl font-bold mb-1">Deployments</h1>
          <p className="text-muted-foreground text-sm">
            Manage linked deployments and orchestration flows
          </p>
        </div>

        {deploymentsQuery.isLoading ? (
          <div className="py-8 space-y-4">
            <div className="flex gap-3">
              <Skeleton className="h-8 w-28 rounded-full" />
              <Skeleton className="h-8 w-24 rounded-full" />
            </div>
            <div className="h-[500px] rounded-xl border border-border bg-muted/20 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Skeleton className="h-16 w-16 rounded-full" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          </div>
        ) : deploymentsQuery.isError ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">
                Failed to load deployments
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => deploymentsQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          </div>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex flex-col flex-1"
          >
            <TabsList className="w-fit mb-3">
              <TabsTrigger value="deployments" className="gap-1.5">
                <Share2 className="w-3.5 h-3.5" />
                Linked Deployments
              </TabsTrigger>
              <TabsTrigger value="flows" className="gap-1.5">
                <Users className="w-3.5 h-3.5" />
                Bot Teams
              </TabsTrigger>
              <TabsTrigger value="resource-map" className="gap-1.5">
                <LayoutGrid className="w-3.5 h-3.5" />
                Resource Map
              </TabsTrigger>
            </TabsList>

            {/* ── Deployments Tab (original view) ── */}
            <TabsContent value="deployments" className="flex-1">
              {deployments.length > 0 ? (
                <div className="flex flex-col">
                  {/* Filter Bar */}
                  <div className="flex items-center gap-2 sm:gap-3 flex-wrap pb-4 overflow-x-auto scrollbar-none">
                    <button
                      type="button"
                      onClick={() => setShowCreditPools((v) => !v)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        showCreditPools
                          ? "bg-primary/10 border-primary/30 text-primary"
                          : "bg-secondary border-border text-muted-foreground"
                      }`}
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      Credit Pools{showCreditPools ? ": ON" : ": OFF"}
                    </button>

                    <button
                      type="button"
                      disabled
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border bg-secondary/50 border-border text-muted-foreground-subtle cursor-not-allowed"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      Data Sharing: coming soon
                    </button>

                    {runtimeSlugs.length > 1 && (
                      <div className="w-px h-5 bg-border mx-1" />
                    )}

                    {runtimeSlugs.length > 1 && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          Runtime:
                        </span>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => setActiveRuntime("all")}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                              activeRuntime === "all"
                                ? "bg-primary/10 border-primary/30 text-primary"
                                : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            All
                          </button>
                          {runtimeSlugs.map((slug) => (
                            <button
                              type="button"
                              key={slug}
                              onClick={() => setActiveRuntime(slug)}
                              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                                activeRuntime === slug
                                  ? "bg-primary/10 border-primary/30 text-primary"
                                  : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {runtimeNames[slug] || slug}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Graph */}
                  <div
                    className="rounded-xl border border-border/60 overflow-hidden"
                    style={{ height: "calc(100vh - 280px)", minHeight: "600px" }}
                  >
                    <ErrorBoundary>
                      <ReactFlowProvider>
                        <DeploymentGraph
                          deployments={deployments}
                          showCreditPools={showCreditPools}
                          activeRuntime={activeRuntime}
                          selectedId={selectedDeploymentId}
                          onSelectDeployment={setSelectedDeploymentId}
                        />
                      </ReactFlowProvider>
                    </ErrorBoundary>
                  </div>

                  {/* Detail panel (fixed overlay on left) */}
                  <AnimatePresence>
                    {selectedDeployment && (
                      <DeploymentDetailPanel
                        deployment={selectedDeployment}
                        allDeployments={deployments}
                        runtimeNames={runtimeNames}
                        onClose={() => setSelectedDeploymentId(null)}
                      />
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                  className="text-center py-24"
                >
                  <Layers className="w-12 h-12 mx-auto mb-4 text-muted-foreground/40" />
                  <h3 className="text-lg font-semibold mb-1">
                    No linked deployments yet
                  </h3>
                  <p className="text-muted-foreground text-sm mb-6 max-w-xs mx-auto">
                    Link deployments to share credit pools and other
                    resources
                  </p>
                  <Button
                    onClick={() => router.push("/dashboard")}
                    size="lg"
                    className="font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    Go to Dashboard
                  </Button>
                </motion.div>
              )}
            </TabsContent>

            {/* ── Flows Tab (new orchestration canvas) ── */}
            <TabsContent value="flows" className="flex-1 flex flex-col">
              <div
                className="rounded-xl border border-border/60 overflow-hidden flex flex-col"
                style={{ height: "calc(100vh - 280px)", minHeight: "600px" }}
              >
                <ErrorBoundary>
                  <FlowView deployments={deployments} />
                </ErrorBoundary>
              </div>
            </TabsContent>

            {/* ── Resource Map Tab ── */}
            <TabsContent value="resource-map" className="flex-1">
              <ResourceMapView deployments={deployments} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

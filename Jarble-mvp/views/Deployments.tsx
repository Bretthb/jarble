"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
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
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import ProfileDropdown from "@/components/ProfileDropdown";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import ErrorBoundary from "@/components/ErrorBoundary";
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
  type EdgeProps,
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

/** Data shape for nodes on the flow canvas */
type FlowNodeData = DeploymentData & {
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
  createdAt: number;
  updatedAt: number;
}

/** Parse an API flow row into a FlowDefinition for the canvas */
function parseApiFlow(row: ApiFlow): FlowDefinition {
  let nodes: Node<FlowNodeData>[] = [];
  let edges: Edge[] = [];
  try {
    const def = JSON.parse(row.definition);
    nodes = Array.isArray(def.nodes) ? def.nodes : [];
    edges = Array.isArray(def.edges) ? def.edges : [];
  } catch {
    // Corrupted definition — treat as empty
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    nodes,
    edges,
    status: row.status,
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
      return "bg-gray-400";
    case "failed":
      return "bg-red-500";
    case "pending":
    default:
      return "bg-gray-400";
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

// ─── Execution status helpers ────────────────────────────────────────

function executionStatusColor(
  status?: FlowStepStatus["status"]
): string {
  switch (status) {
    case "running":
      return "border-blue-500";
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
  status?: FlowStepStatus["status"]
): string {
  switch (status) {
    case "running":
      return "ring-blue-500/30";
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
      className="fixed left-0 top-[57px] bottom-0 z-40 w-80 border-r border-border bg-card shadow-xl flex flex-col overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold text-sm truncate flex-1 mr-2">
          {deployment.name}
        </h3>
        <button
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
        <Background gap={16} size={1} className="!bg-background" />
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

const FLOW_NODE_WIDTH = 220;
const FLOW_NODE_HEIGHT = 100;

function FlowDeploymentNode({
  data,
  selected,
}: {
  data: FlowNodeData;
  selected?: boolean;
}) {
  const execStatus = data.executionStatus;
  const isRunning = execStatus === "running";
  const isCompleted = execStatus === "completed";
  const isFailed = execStatus === "failed";
  const isSkipped = execStatus === "skipped";

  return (
    <div
      className={`
        relative rounded-xl border-2 bg-card shadow-sm transition-all
        w-[220px] overflow-hidden
        ${executionStatusColor(execStatus)}
        ${selected ? "ring-2 ring-primary/40 shadow-md" : "hover:shadow-md"}
        ${isRunning ? "ring-2 " + executionStatusRingColor(execStatus) : ""}
        ${executionStatusRingColor(execStatus)}
      `}
    >
      {/* Animated border for running state */}
      {isRunning && (
        <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
          <div
            className="absolute inset-[-2px] rounded-xl"
            style={{
              background:
                "conic-gradient(from 0deg, transparent, hsl(217 91% 60%), transparent 30%)",
              animation: "flow-spin 2s linear infinite",
            }}
          />
          <div className="absolute inset-[2px] rounded-[10px] bg-card" />
        </div>
      )}

      {/* Input handle (left) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-muted-foreground/50 !border-2 !border-card hover:!bg-primary !transition-colors"
      />

      {/* Output handle (right) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-muted-foreground/50 !border-2 !border-card hover:!bg-primary !transition-colors"
      />

      {/* Content */}
      <div className="relative z-10 p-3">
        {/* Top row: name + status icon */}
        <div className="flex items-center gap-2 mb-1.5">
          <Bot className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold text-foreground truncate flex-1">
            {data.name}
          </span>
          {isCompleted && (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          )}
          {isFailed && (
            <XCircle className="w-4 h-4 text-red-500 shrink-0" />
          )}
          {isRunning && (
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
          )}
          {isSkipped && (
            <Circle className="w-4 h-4 text-stone-400 shrink-0" />
          )}
        </div>

        {/* Deployment status + runtime */}
        <div className="flex items-center gap-2 mb-1">
          <StatusBadge status={data.status} compact />
          <span className="text-[10px] text-muted-foreground truncate">
            {data.runtime}
          </span>
        </div>

        {/* Execution info row */}
        <div className="flex items-center gap-3 mt-1.5">
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

        {/* Streaming inner text preview */}
        {isRunning && data.executionInnerText && (
          <div className="mt-1.5 px-1.5 py-1 rounded bg-blue-500/5 border border-blue-500/10 max-h-[48px] overflow-hidden">
            <p className="text-[10px] text-blue-300/80 leading-tight line-clamp-3 whitespace-pre-wrap break-words">
              {data.executionInnerText.length > 200
                ? "\u2026" + data.executionInnerText.slice(-200)
                : data.executionInnerText}
            </p>
          </div>
        )}

        {/* Error message */}
        {data.executionError && (
          <p className="mt-1.5 text-[10px] text-red-400 line-clamp-2">
            {data.executionError}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Flow Edge: animated edge between flow nodes ─────────────────────

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
  const edgeData = data as
    | { executionStatus?: FlowStepStatus["status"] }
    | undefined;
  const execStatus = edgeData?.executionStatus;
  const color = executionEdgeColor(execStatus);
  const isRunning = execStatus === "running";

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: color,
          strokeWidth: 2,
          strokeDasharray: isRunning ? "8 4" : undefined,
          animation: isRunning
            ? "flow-dash 0.6s linear infinite"
            : undefined,
        }}
      />
      {/* Glow effect for running edges */}
      {isRunning && (
        <BaseEdge
          id={`${id}-glow`}
          path={edgePath}
          style={{
            stroke: color,
            strokeWidth: 6,
            strokeOpacity: 0.15,
            strokeDasharray: "8 4",
            animation: "flow-dash 0.6s linear infinite",
          }}
        />
      )}
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

  return (
    <div className="w-56 border-r border-border bg-card/50 flex flex-col shrink-0">
      <div className="px-3 py-2.5 border-b border-border">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Available Deployments
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {available.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">
            All deployments are on the canvas
          </p>
        )}
        {available.map((dep) => (
          <button
            key={dep.id}
            onClick={() => onAddNode(dep)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-border/60 bg-card hover:bg-secondary/50 hover:border-primary/30 transition-all text-left group"
          >
            <div className="relative shrink-0">
              <Bot className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              <div
                className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${statusDotColor(dep.status)}`}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate text-foreground">
                {dep.name}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">
                {dep.runtime}
              </p>
            </div>
            <ChevronRight className="w-3 h-3 text-muted-foreground/50 group-hover:text-primary transition-colors shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

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
  isExecuting,
  isSaved,
  totalCredits,
  hasFlow,
}: {
  flowName: string;
  onFlowNameChange: (name: string) => void;
  onRun: () => void;
  onCancel: () => void;
  onSave: () => void;
  onAutoLayout: () => void;
  onNewFlow: () => void;
  onDeleteFlow: () => void;
  isExecuting: boolean;
  isSaved: boolean;
  totalCredits: number;
  hasFlow: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(flowName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(flowName);
  }, [flowName]);

  const handleCommit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== flowName) {
      onFlowNameChange(trimmed);
    } else {
      setEditValue(flowName);
    }
    setIsEditing(false);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/80 backdrop-blur-sm">
      {/* Flow name (editable) */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <GitBranch className="w-4 h-4 text-primary shrink-0" />
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCommit();
              if (e.key === "Escape") {
                setEditValue(flowName);
                setIsEditing(false);
              }
            }}
            className="bg-transparent border-b border-primary text-sm font-semibold text-foreground outline-none min-w-[120px] max-w-[240px]"
            autoFocus
          />
        ) : (
          <button
            onClick={() => {
              if (hasFlow) {
                setIsEditing(true);
              }
            }}
            className="flex items-center gap-1 text-sm font-semibold text-foreground hover:text-primary transition-colors truncate"
            disabled={!hasFlow}
          >
            {flowName || "Untitled Flow"}
            {hasFlow && (
              <Pencil className="w-3 h-3 text-muted-foreground" />
            )}
          </button>
        )}

        {/* Save indicator */}
        {hasFlow && !isSaved && (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
        )}
      </div>

      {/* Credits display */}
      {totalCredits > 0 && (
        <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20">
          <Coins className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-medium text-amber-400">
            {totalCredits.toFixed(4)} credits
          </span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={onNewFlow}
              className="h-7 px-2.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline ml-1">New Flow</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Create a new flow</TooltipContent>
        </Tooltip>

        {hasFlow && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAutoLayout}
                  className="h-7 px-2.5"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline ml-1">Layout</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Auto-arrange nodes</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onSave}
                  disabled={isSaved}
                  className="h-7 px-2.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline ml-1">Save</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isSaved ? "All changes saved" : "Save flow"}
              </TooltipContent>
            </Tooltip>

            <div className="w-px h-5 bg-border mx-0.5" />

            {isExecuting ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={onCancel}
                className="h-7 px-3"
              >
                <Square className="w-3.5 h-3.5 mr-1" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={onRun}
                className="h-7 px-3 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Play className="w-3.5 h-3.5 mr-1" />
                Run
              </Button>
            )}

            <div className="w-px h-5 bg-border mx-0.5" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDeleteFlow}
                  className="h-7 px-2 text-muted-foreground hover:text-red-400"
                >
                  <Trash2 className="w-3.5 h-3.5" />
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
}: {
  flows: FlowDefinition[];
  activeFlowId: string | null;
  onSelectFlow: (id: string) => void;
}) {
  if (flows.length === 0) return null;

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {flows.map((flow) => (
        <button
          key={flow.id}
          onClick={() => onSelectFlow(flow.id)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${
            flow.id === activeFlowId
              ? "bg-primary/10 border-primary/30 text-primary"
              : "bg-secondary border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          <GitBranch className="w-3 h-3" />
          {flow.name}
          <span className="text-muted-foreground">
            ({flow.nodes.length})
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── Flow Canvas (inner, inside ReactFlowProvider) ───────────────────

function FlowCanvas({
  deployments,
  flow,
  onUpdateFlow,
  executionSteps,
}: {
  deployments: DeploymentData[];
  flow: FlowDefinition;
  onUpdateFlow: (updates: Partial<FlowDefinition>) => void;
  executionSteps: Map<string, FlowStepStatus>;
}) {
  const { fitView } = useReactFlow();

  // Merge execution state into node data
  const nodesWithExecution: Node<FlowNodeData>[] = useMemo(() => {
    return flow.nodes.map((node) => {
      const stepStatus = executionSteps.get(node.id);
      return {
        ...node,
        data: {
          ...node.data,
          executionStatus: stepStatus?.status,
          executionCredits: stepStatus?.credits,
          executionDurationMs: stepStatus?.durationMs,
          executionError: stepStatus?.error,
          executionInnerText: stepStatus?.innerText,
        },
      };
    });
  }, [flow.nodes, executionSteps]);

  // Merge execution state into edges
  const edgesWithExecution: Edge[] = useMemo(() => {
    return flow.edges.map((edge) => {
      // Edge takes the status of its target node
      const targetStatus = executionSteps.get(edge.target);
      return {
        ...edge,
        type: "flowEdge",
        data: {
          ...((edge.data as Record<string, unknown>) || {}),
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

  // Handle node position changes (drag)
  const handleNodesChange: OnNodesChange<Node<FlowNodeData>> = useCallback(
    (changes) => {
      onNodesChange(changes);

      // Persist position changes
      const positionChanges = changes.filter(
        (c) => c.type === "position" && !("dragging" in c && c.dragging)
      );
      if (positionChanges.length > 0) {
        // Debounced save happens via the dirty flag
        onUpdateFlow({
          nodes: flow.nodes.map((n) => {
            const change = positionChanges.find(
              (c) => "id" in c && c.id === n.id
            );
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

  // Handle edge creation (connecting nodes)
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      // Prevent duplicate edges
      const exists = flow.edges.some(
        (e) =>
          e.source === connection.source && e.target === connection.target
      );
      if (exists) return;

      // Prevent self-connections
      if (connection.source === connection.target) return;

      const newEdge: Edge = {
        id: `flow-edge-${connection.source}-${connection.target}`,
        source: connection.source!,
        target: connection.target!,
        type: "flowEdge",
        data: {},
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
        const removedIds = new Set(
          removals.map((c) => ("id" in c ? c.id : ""))
        );
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
        edges: flow.edges.filter(
          (e) => !deletedIds.has(e.source) && !deletedIds.has(e.target)
        ),
      });
    },
    [onUpdateFlow, flow.nodes, flow.edges]
  );

  const onInit = useCallback(() => {
    setTimeout(() => fitView({ padding: 0.15, maxZoom: 1 }), 50);
  }, [fitView]);

  // Node IDs on canvas
  const nodesOnCanvas = useMemo(
    () => new Set(flow.nodes.map((n) => n.id)),
    [flow.nodes]
  );

  // Add deployment as a flow node
  const handleAddNode = useCallback(
    (dep: DeploymentData) => {
      // Calculate a position that doesn't overlap existing nodes
      const rightmostX = flow.nodes.reduce(
        (max, n) => Math.max(max, n.position.x),
        0
      );
      const newNode: Node<FlowNodeData> = {
        id: dep.id,
        type: "flowDeployment",
        position: {
          x: flow.nodes.length > 0 ? rightmostX + FLOW_NODE_WIDTH + 60 : 100,
          y: 100,
        },
        data: { ...dep },
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
          onInit={onInit}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          maxZoom={2}
          nodesDraggable={true}
          nodesConnectable={true}
          elementsSelectable={true}
          deleteKeyCode={["Backspace", "Delete"]}
          defaultEdgeOptions={{
            type: "flowEdge",
          }}
          connectionLineStyle={{
            stroke: "hsl(var(--primary))",
            strokeWidth: 2,
            strokeDasharray: "6 3",
          }}
        >
          <Background gap={20} size={1} className="!bg-background" />
          <Controls
            showInteractive={false}
            className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-secondary"
          />
          <MiniMap
            className="!bg-card !border-border"
            nodeColor={() => "hsl(var(--primary))"}
            maskColor="hsl(var(--background) / 0.7)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

// ─── Flow View (manages flow state, toolbar, execution) ──────────────

function FlowView({ deployments }: { deployments: DeploymentData[] }) {
  const utils = trpc.useUtils();

  // ── Fetch flows from API ──────────────────────────────────────────
  const flowsQuery = trpc.flows.list.useQuery(undefined, {
    staleTime: 30_000,
  });

  const flows: FlowDefinition[] = useMemo(() => {
    if (!flowsQuery.data) return [];
    return (flowsQuery.data as unknown as ApiFlow[]).map(parseApiFlow);
  }, [flowsQuery.data]);

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

  const { state: execState, startExecution, cancel } = useFlowExecution();

  // ── Mutations ─────────────────────────────────────────────────────

  const createFlowMutation = trpc.flows.create.useMutation({
    onSuccess: (data) => {
      utils.flows.list.invalidate();
      setActiveFlowId(data.id);
      setIsSaved(true);
    },
  });

  const updateFlowMutation = trpc.flows.update.useMutation({
    onSuccess: () => {
      utils.flows.list.invalidate();
      setIsSaved(true);
    },
  });

  const deleteFlowMutation = trpc.flows.delete.useMutation({
    onSuccess: () => {
      utils.flows.list.invalidate();
    },
  });

  // ── Create new flow ───────────────────────────────────────────────
  const handleNewFlow = useCallback(() => {
    const name = `Flow ${flows.length + 1}`;
    createFlowMutation.mutate({
      name,
      definition: { nodes: [], edges: [] },
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
    mutation.definition = {
      nodes: activeFlow.nodes.map((n) => ({
        id: n.id,
        type: (n.type ?? "deployment") as "deployment" | "transform" | "condition" | "output",
        deploymentId: n.data?.id,
        label: n.data?.name ?? n.id,
        config: {} as Record<string, unknown>,
        position: n.position,
      })),
      edges: activeFlow.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
        label: typeof e.label === "string" ? e.label : undefined,
      })),
    };

    updateFlowMutation.mutate(mutation, {
      onSuccess: () => {
        // Clear local overrides for this flow after successful save
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
      { id: activeFlowId, hard: false },
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

  // ── Auto layout ───────────────────────────────────────────────────
  const handleAutoLayout = useCallback(() => {
    if (!activeFlow || activeFlow.nodes.length === 0) return;
    const { nodes: layouted, edges } = getLayoutedElements<FlowNodeData>(
      activeFlow.nodes,
      activeFlow.edges,
      "LR",
      FLOW_NODE_WIDTH,
      FLOW_NODE_HEIGHT
    );
    handleUpdateFlow({ nodes: layouted, edges });
  }, [activeFlow, handleUpdateFlow]);

  // ── Run flow ──────────────────────────────────────────────────────
  const handleRun = useCallback(() => {
    if (!activeFlowId) return;
    startExecution(activeFlowId);
  }, [activeFlowId, startExecution]);

  // ── Cancel ────────────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    cancel();
  }, [cancel]);

  const isExecuting = execState.status === "running";
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
        isExecuting={isExecuting}
        isSaved={isSaved && !isMutating}
        totalCredits={execState.totalCredits}
        hasFlow={!!activeFlow}
      />

      {/* Canvas or empty state */}
      {activeFlow ? (
        <ReactFlowProvider>
          <FlowCanvas
            deployments={deployments}
            flow={activeFlow}
            onUpdateFlow={handleUpdateFlow}
            executionSteps={execState.steps}
          />
        </ReactFlowProvider>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            <GitBranch className="w-12 h-12 mx-auto mb-4 text-muted-foreground/40" />
            <h3 className="text-lg font-semibold mb-1">No flows yet</h3>
            <p className="text-muted-foreground text-sm mb-6 max-w-xs mx-auto">
              Create a flow to orchestrate your deployments as a pipeline
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
              Create Your First Flow
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
    `}</style>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export default function Deployments() {
  const { isAuthenticated, isLoading: authLoading } = useAuth0();
  const router = useRouter();
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
            <span className="font-semibold">Jarble</span>
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
                <GitBranch className="w-3.5 h-3.5" />
                Flows
              </TabsTrigger>
            </TabsList>

            {/* ── Deployments Tab (original view) ── */}
            <TabsContent value="deployments" className="flex-1">
              {deployments.length > 0 ? (
                <div className="flex flex-col">
                  {/* Filter Bar */}
                  <div className="flex items-center gap-3 flex-wrap pb-4">
                    <button
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
                    style={{ height: "calc(100vh - 280px)" }}
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
                style={{ height: "calc(100vh - 280px)" }}
              >
                <ErrorBoundary>
                  <FlowView deployments={deployments} />
                </ErrorBoundary>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useMemo, useCallback } from "react";
import ProfileDropdown from "@/components/ProfileDropdown";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import ErrorBoundary from "@/components/ErrorBoundary";
import { runtimeNeedsLlm } from "./onboarding/wizardStepConfig";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";

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

function getLayoutedElements(
  nodes: Node<DeploymentNodeData>[],
  edges: Edge[],
): { nodes: Node<DeploymentNodeData>[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 100, ranksep: 100, marginx: 40, marginy: 40 });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
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
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ─── Custom Node Components ──────────────────────────────────────────

function OwnerNode({ data, selected }: { data: DeploymentNodeData; selected?: boolean }) {
  return (
    <div className="flex flex-col items-center cursor-pointer group">
      <div className="relative">
        <div className={`w-14 h-14 rounded-full border-2 bg-card flex items-center justify-center shadow-md group-hover:shadow-lg transition-all ${selected ? "border-primary ring-2 ring-primary/30" : "border-primary group-hover:border-primary/80"}`}>
          <Crown className="w-6 h-6 text-primary" />
        </div>
        <div
          className={`absolute bottom-1 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${statusDotColor(data.status)} ${isAnimatedStatus(data.status) ? "animate-pulse" : ""}`}
        />
      </div>
      <span className="mt-1.5 text-[11px] font-medium text-foreground max-w-[90px] truncate text-center">
        {data.name}
      </span>
      <span className="text-[9px] text-muted-foreground">{statusLabel(data.status)}</span>
      {data.llmCreditLimitDollars != null && (
        <span className="text-[9px] text-primary font-medium">${data.llmCreditLimitDollars}/mo</span>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2 !border-0" />
    </div>
  );
}

function LinkedNode({ data, selected }: { data: DeploymentNodeData; selected?: boolean }) {
  return (
    <div className="flex flex-col items-center cursor-pointer group">
      <Handle type="target" position={Position.Top} className="!bg-border !w-2 !h-2 !border-0" />
      <div className="relative">
        <div className={`w-14 h-14 rounded-full border-2 border-dashed bg-card flex items-center justify-center shadow-sm group-hover:shadow-md transition-all ${selected ? "border-primary ring-2 ring-primary/30" : "border-border group-hover:border-primary/40"}`}>
          <Link2 className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
        </div>
        <div
          className={`absolute bottom-1 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${statusDotColor(data.status)} ${isAnimatedStatus(data.status) ? "animate-pulse" : ""}`}
        />
      </div>
      <span className="mt-1.5 text-[11px] font-medium text-foreground max-w-[90px] truncate text-center">
        {data.name}
      </span>
      <span className="text-[9px] text-muted-foreground">{statusLabel(data.status)}</span>
    </div>
  );
}

function StandaloneNode({ data, selected }: { data: DeploymentNodeData; selected?: boolean }) {
  return (
    <div className="flex flex-col items-center cursor-pointer group">
      <div className="relative">
        <div className={`w-14 h-14 rounded-full border-2 bg-card flex items-center justify-center shadow-sm group-hover:shadow-md transition-all ${selected ? "border-primary ring-2 ring-primary/30" : "border-border group-hover:border-primary/40"}`}>
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
      <span className="text-[9px] text-muted-foreground">{statusLabel(data.status)}</span>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  owner: OwnerNode,
  linked: LinkedNode,
  standalone: StandaloneNode,
};

// ─── Detail Panel ────────────────────────────────────────────────────

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

  // Find the source deployment name if linked
  const sourceDeployment = deployment.llmApiKeySourceDeploymentId
    ? allDeployments.find((d) => d.id === deployment.llmApiKeySourceDeploymentId)
    : null;

  // Find linked children if this is an owner
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
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold text-sm truncate flex-1 mr-2">{deployment.name}</h3>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Panel body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Status */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Status</p>
          <StatusBadge status={deployment.status} />
        </div>

        {/* Runtime */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Runtime</p>
          <p className="text-sm font-medium">{runtimeNames[deployment.runtime] || deployment.runtime}</p>
        </div>

        {/* LLM Mode */}
        {runtimeNeedsLlm(deployment.runtime) && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">LLM Mode</p>
            <Badge variant="secondary" className="text-xs">
              {deployment.llmApiKeySourceDeploymentId ? "Linked to Pool" : llmModeLabel(deployment.llmMode)}
            </Badge>
          </div>
        )}

        {/* Credit Limit */}
        {deployment.llmCreditLimitDollars != null && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Credit Limit</p>
            <div className="flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-primary" />
              <span className="text-sm font-medium">${deployment.llmCreditLimitDollars}/mo</span>
            </div>
          </div>
        )}

        {/* Source pool (if linked) */}
        {sourceDeployment && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Credit Pool Owner</p>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
              <Crown className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-xs font-medium truncate">{sourceDeployment.name}</span>
            </div>
          </div>
        )}

        {/* Linked children (if owner) */}
        {linkedChildren.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Linked Deployments ({linkedChildren.length})
            </p>
            <div className="space-y-1.5">
              {linkedChildren.map((child) => (
                <div key={child.id} className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
                  <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-medium truncate flex-1">{child.name}</span>
                  <div className={`w-2 h-2 rounded-full ${statusDotColor(child.status)}`} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Description */}
        {deployment.description && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Description</p>
            <p className="text-xs text-muted-foreground">{deployment.description}</p>
          </div>
        )}
      </div>

      {/* Panel footer */}
      <div className="px-4 py-3 border-t border-border">
        <Button
          onClick={() =>
            router.push(isPending ? `/onboarding/${deployment.id}` : `/d/${deployment.id}/configure`)
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

// ─── Graph Component (inside ReactFlowProvider) ─────────────────────

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
    [onSelectDeployment],
  );

  const onPaneClick = useCallback(() => {
    onSelectDeployment(null);
  }, [onSelectDeployment]);

  // Filter by runtime
  const filtered = useMemo(() => {
    if (activeRuntime === "all") return deployments;
    return deployments.filter((d) => d.runtime === activeRuntime);
  }, [deployments, activeRuntime]);

  // Build nodes and edges
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
        <Controls showInteractive={false} className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-secondary" />
      </ReactFlow>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export default function Deployments() {
  const { isAuthenticated, isLoading: authLoading } = useAuth0();
  const router = useRouter();
  const [activeRuntime, setActiveRuntime] = useState("all");
  const [showCreditPools, setShowCreditPools] = useState(true);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);

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

  const deployments = (deploymentsQuery.data as any as DeploymentData[]) || [];
  const selectedDeployment = selectedDeploymentId
    ? deployments.find((d) => d.id === selectedDeploymentId) || null
    : null;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Navigation */}
      <nav className="border-b border-border/60 sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex justify-between items-center">
          <a href="/" className="flex items-center gap-2 cursor-pointer no-underline text-foreground">
            <span className="font-semibold">Jarble</span>
          </a>
          <ProfileDropdown />
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 w-full flex flex-col flex-1">
        {/* Header */}
        <div className="pt-6 pb-4">
          <h1 className="text-2xl font-bold mb-1">Linked Deployments</h1>
          <p className="text-muted-foreground text-sm">
            See which deployments share resources like credit pools
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
              <p className="text-sm text-muted-foreground">Failed to load deployments</p>
              <Button variant="outline" size="sm" onClick={() => deploymentsQuery.refetch()}>Retry</Button>
            </div>
          </div>
        ) : deployments.length > 0 ? (
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
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border bg-secondary/50 border-border text-muted-foreground/50 cursor-not-allowed"
              >
                <Share2 className="w-3.5 h-3.5" />
                Data Sharing: coming soon
              </button>

              {runtimeSlugs.length > 1 && (
                <div className="w-px h-5 bg-border mx-1" />
              )}

              {runtimeSlugs.length > 1 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Runtime:</span>
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
              style={{ height: "calc(100vh - 240px)" }}
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
              Link deployments to share credit pools and other resources
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
      </div>
    </div>
  );
}

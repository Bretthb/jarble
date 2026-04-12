"use client";

import { useMemo } from "react";
import { Crown } from "lucide-react";
import { producerHue } from "@/lib/teamChatUtils";

interface MiniNode {
  nodeId: string;
  deploymentId: string;
  name: string;
  roleLabel: string;
  status: string;
  isEntry: boolean;
  isSelf: boolean;
}

interface MiniEdge {
  sourceNodeId: string;
  targetNodeId: string;
  type: "delegates" | "reports" | "collaborates";
}

interface TeamTopologyMiniGraphProps {
  selfNodeId: string;
  selfDeploymentId: string;
  selfName: string;
  selfRoleLabel: string;
  selfIsEntry: boolean;
  entryNodeId: string | null;
  teammates: Array<{
    deploymentId: string;
    name: string;
    nodeId: string;
    roleLabel: string;
    status: string;
    isEntry: boolean;
  }>;
  edges: MiniEdge[];
}

const EDGE_COLORS: Record<string, string> = {
  delegates: "hsl(217, 91%, 60%)",   // blue
  reports: "hsl(38, 92%, 50%)",       // amber
  collaborates: "hsl(263, 70%, 50%)", // violet
};

const NODE_W = 80;
const NODE_H = 40;
const LEVEL_GAP = 60;
const PADDING = 12;

/**
 * Mini team topology graph shown inside the Team Memberships panel
 * on /d/[id]. Displays this deployment's position relative to teammates
 * with edges showing delegation relationships.
 *
 * Uses pure CSS positioning + inline SVG for edges. No ReactFlow needed.
 * BFS from the entry node assigns levels for a clean hierarchical layout.
 */
export default function TeamTopologyMiniGraph({
  selfNodeId,
  selfDeploymentId,
  selfName,
  selfRoleLabel,
  selfIsEntry,
  entryNodeId,
  teammates,
  edges,
}: TeamTopologyMiniGraphProps) {
  const layout = useMemo(() => {
    // Build all nodes (self + teammates)
    const allNodes: MiniNode[] = [
      {
        nodeId: selfNodeId,
        deploymentId: selfDeploymentId,
        name: selfName,
        roleLabel: selfRoleLabel,
        status: "running",
        isEntry: selfIsEntry,
        isSelf: true,
      },
      ...teammates.map((t) => ({
        nodeId: t.nodeId,
        deploymentId: t.deploymentId,
        name: t.name,
        roleLabel: t.roleLabel,
        status: t.status,
        isEntry: t.isEntry,
        isSelf: false,
      })),
    ];

    if (allNodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

    // BFS from entry node to assign levels
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      const list = adj.get(e.sourceNodeId) ?? [];
      list.push(e.targetNodeId);
      adj.set(e.sourceNodeId, list);
    }

    const levels = new Map<string, number>();
    const startId = entryNodeId ?? selfNodeId;
    const queue: string[] = [startId];
    levels.set(startId, 0);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentLevel = levels.get(current) ?? 0;
      for (const neighbor of adj.get(current) ?? []) {
        if (!levels.has(neighbor)) {
          levels.set(neighbor, currentLevel + 1);
          queue.push(neighbor);
        }
      }
    }

    // Also check reverse edges (reports/collaborates are bidirectional)
    for (const e of edges) {
      if (!levels.has(e.sourceNodeId) && levels.has(e.targetNodeId)) {
        levels.set(e.sourceNodeId, (levels.get(e.targetNodeId) ?? 0) + 1);
      }
    }

    // Assign unvisited nodes to last level + 1
    const maxLevel = Math.max(0, ...levels.values());
    for (const n of allNodes) {
      if (!levels.has(n.nodeId)) levels.set(n.nodeId, maxLevel + 1);
    }

    // Group nodes by level
    const byLevel = new Map<number, MiniNode[]>();
    for (const n of allNodes) {
      const level = levels.get(n.nodeId) ?? 0;
      const list = byLevel.get(level) ?? [];
      list.push(n);
      byLevel.set(level, list);
    }

    // Compute positions
    const totalLevels = Math.max(1, ...byLevel.keys()) + 1;
    const maxNodesInLevel = Math.max(...[...byLevel.values()].map((l) => l.length));
    const containerW = Math.max(200, maxNodesInLevel * (NODE_W + 16) + PADDING * 2);
    const containerH = totalLevels * (NODE_H + LEVEL_GAP) - LEVEL_GAP + PADDING * 2;

    const positioned: Array<MiniNode & { x: number; y: number }> = [];
    for (const [level, nodes] of byLevel) {
      const rowW = nodes.length * (NODE_W + 16) - 16;
      const startX = (containerW - rowW) / 2;
      nodes.forEach((n, i) => {
        positioned.push({
          ...n,
          x: startX + i * (NODE_W + 16),
          y: PADDING + level * (NODE_H + LEVEL_GAP),
        });
      });
    }

    return { nodes: positioned, edges, width: containerW, height: containerH };
  }, [selfNodeId, selfDeploymentId, selfName, selfRoleLabel, selfIsEntry, entryNodeId, teammates, edges]);

  if (layout.nodes.length <= 1) return null;

  // Find connected nodes (directly connected to self)
  const connectedToSelf = new Set<string>();
  for (const e of layout.edges) {
    if (e.sourceNodeId === selfNodeId) connectedToSelf.add(e.targetNodeId);
    if (e.targetNodeId === selfNodeId) connectedToSelf.add(e.sourceNodeId);
  }

  return (
    <div className="relative" style={{ width: layout.width, height: layout.height, margin: "0 auto" }}>
      {/* SVG edges layer */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={layout.width}
        height={layout.height}
      >
        <defs>
          {Object.entries(EDGE_COLORS).map(([type, color]) => (
            <marker
              key={type}
              id={`mini-arrow-${type}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
          ))}
        </defs>
        {layout.edges.map((e, i) => {
          const src = layout.nodes.find((n) => n.nodeId === e.sourceNodeId);
          const tgt = layout.nodes.find((n) => n.nodeId === e.targetNodeId);
          if (!src || !tgt) return null;
          const color = EDGE_COLORS[e.type] || EDGE_COLORS.delegates;
          const x1 = src.x + NODE_W / 2;
          const y1 = src.y + NODE_H;
          const x2 = tgt.x + NODE_W / 2;
          const y2 = tgt.y;
          // If same level, connect horizontally
          if (src.y === tgt.y) {
            return (
              <line
                key={i}
                x1={src.x + NODE_W}
                y1={src.y + NODE_H / 2}
                x2={tgt.x}
                y2={tgt.y + NODE_H / 2}
                stroke={color}
                strokeWidth={1.5}
                strokeOpacity={0.7}
                markerEnd={e.type !== "collaborates" ? `url(#mini-arrow-${e.type})` : undefined}
              />
            );
          }
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={color}
              strokeWidth={1.5}
              strokeOpacity={0.7}
              markerEnd={e.type !== "collaborates" ? `url(#mini-arrow-${e.type})` : undefined}
            />
          );
        })}
      </svg>

      {/* Node pills */}
      {layout.nodes.map((n) => {
        const hue = producerHue(n.deploymentId);
        const isConnected = n.isSelf || connectedToSelf.has(n.nodeId);
        return (
          <div
            key={n.nodeId}
            className={`absolute rounded-lg border text-center px-1 py-0.5 transition-all ${
              n.isSelf
                ? "ring-2 ring-primary border-primary/50 bg-primary/10"
                : isConnected
                  ? "border-border bg-card"
                  : "border-border/50 bg-card/50 opacity-50"
            }`}
            style={{
              left: n.x,
              top: n.y,
              width: NODE_W,
              height: NODE_H,
              borderLeftWidth: 3,
              borderLeftColor: `hsl(${hue}, 50%, 45%)`,
            }}
            title={`${n.name} (${n.roleLabel})`}
          >
            <div className="flex items-center gap-0.5 justify-center">
              {n.isEntry && <Crown className="w-2.5 h-2.5 text-amber-500 shrink-0" />}
              <span className="text-[9px] font-semibold truncate">{n.name}</span>
            </div>
            <span className="text-[8px] text-muted-foreground truncate block">{n.roleLabel}</span>
          </div>
        );
      })}

      {/* Tiny edge type legend */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-3 text-[8px] text-muted-foreground/60">
        {[...new Set(layout.edges.map((e) => e.type))].map((type) => (
          <span key={type} className="flex items-center gap-1">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: EDGE_COLORS[type] }}
            />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}

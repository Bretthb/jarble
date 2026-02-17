"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Bot,
  Activity,
  DollarSign,
  Zap,
  ChevronLeft,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
  BarChart3,
} from "lucide-react";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import ProfileDropdown from "@/components/ProfileDropdown";
import { StatusBadge, STATUS_CONFIG } from "@/components/StatusBadge";
import { StorageMeter, StorageMeterSkeleton } from "@/components/StorageMeter";
import { useStatusStream } from "@/hooks/useStatusStream";

// ─── Types ──────────────────────────────────────────────────────────────

interface Deployment {
  id: string;
  name: string;
  status: string;
  runtime: string;
  description: string | null;
  isFree: boolean;
  monthlyPriceCents: number;
  freeExpiresAt: string | null;
  freeTrialExpired?: boolean;
  llmMode: string;
  cancelledAt?: string | null;
  cancelAtPeriodEnd?: string | null;
}

type SortKey = "name" | "runtime" | "status" | "llmMode" | "cost";
type SortDir = "asc" | "desc";

// ─── Main Component ─────────────────────────────────────────────────────

export default function Analytics() {
  const { isAuthenticated, isLoading: authLoading } = useAuth0();
  const router = useRouter();

  const deploymentsQuery = trpc.deployment.list.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading,
  });

  const { getStatus: getLiveStatus } = useStatusStream({
    enabled: isAuthenticated && !authLoading,
  });

  const deployments = (deploymentsQuery.data ?? []) as unknown as Deployment[];

  // ── Computed stats ──
  const stats = useMemo(() => {
    const total = deployments.length;
    const byStatus: Record<string, number> = {};
    const byRuntime: Record<string, number> = {};
    let running = 0;
    let totalSpendCents = 0;
    let includedCount = 0;
    let byokCount = 0;

    for (const d of deployments) {
      byStatus[d.status] = (byStatus[d.status] || 0) + 1;
      byRuntime[d.runtime] = (byRuntime[d.runtime] || 0) + 1;
      if (d.status === "running") running++;
      totalSpendCents += d.monthlyPriceCents;
      if (d.llmMode === "included") includedCount++;
      else byokCount++;
    }

    return { total, running, totalSpendCents, includedCount, byokCount, byStatus, byRuntime };
  }, [deployments]);

  const includedDeployments = useMemo(
    () => deployments.filter((d) => d.llmMode === "included"),
    [deployments]
  );

  // ── Sorting ──
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortedDeployments = useMemo(() => {
    const list = [...deployments];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "runtime":
          cmp = a.runtime.localeCompare(b.runtime);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "llmMode":
          cmp = a.llmMode.localeCompare(b.llmMode);
          break;
        case "cost":
          cmp = a.monthlyPriceCents - b.monthlyPriceCents;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [deployments, sortKey, sortDir]);

  // ── Loading / Auth guards ──
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
          <p className="text-muted-foreground mb-4">Please log in to view analytics</p>
          <Button onClick={() => (window.location.href = "/login")}>Sign In</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="border-b border-border/60 sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/dashboard")}
              className="text-muted-foreground hover:text-foreground h-8 px-2"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              <span className="font-semibold">Usage Analytics</span>
            </div>
          </div>
          <ProfileDropdown />
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {deploymentsQuery.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading analytics...</p>
            </div>
          </div>
        ) : deployments.length === 0 ? (
          <EmptyState onNavigate={() => router.push("/dashboard")} />
        ) : (
          <>
            {/* Row 1: Summary Cards */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <SummaryCards stats={stats} />
            </motion.div>

            {/* Row 2: Distribution Charts */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <DistributionCharts
                byStatus={stats.byStatus}
                byRuntime={stats.byRuntime}
                total={stats.total}
              />
            </motion.div>

            {/* Row 3: LLM Credit Usage */}
            {includedDeployments.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
              >
                <LlmCreditSection deployments={includedDeployments} />
              </motion.div>
            )}

            {/* Row 4: Per-Deployment Table */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.3 }}
            >
              <DeploymentTable
                deployments={sortedDeployments}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                getLiveStatus={getLiveStatus}
              />
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Empty State ────────────────────────────────────────────────────────

function EmptyState({ onNavigate }: { onNavigate: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="text-center py-24"
    >
      <BarChart3 className="w-12 h-12 mx-auto mb-4 text-muted-foreground/40" />
      <h3 className="text-xl font-semibold mb-1">No analytics yet</h3>
      <p className="text-muted-foreground text-sm mb-6 max-w-xs mx-auto">
        Create your first deployment to start tracking usage
      </p>
      <Button onClick={onNavigate} className="font-semibold bg-primary hover:bg-primary/90 text-primary-foreground">
        Go to Dashboard
      </Button>
    </motion.div>
  );
}

// ─── Summary Cards ──────────────────────────────────────────────────────

function SummaryCards({ stats }: {
  stats: {
    total: number;
    running: number;
    totalSpendCents: number;
    includedCount: number;
    byokCount: number;
    byStatus: Record<string, number>;
  };
}) {
  const stoppedCount = stats.byStatus["stopped"] || 0;

  const cards = [
    {
      icon: Bot,
      label: "Total Deployments",
      value: stats.total,
      subtitle: `${stats.running} running, ${stoppedCount} stopped`,
      iconColor: "text-primary",
    },
    {
      icon: Activity,
      label: "Active Now",
      value: stats.running,
      subtitle: stats.running > 0 ? "Live" : "None active",
      iconColor: "text-green-500",
      pulse: stats.running > 0,
    },
    {
      icon: DollarSign,
      label: "Monthly Spend",
      value: `$${(stats.totalSpendCents / 100).toFixed(2)}`,
      subtitle: `across ${stats.total} deployment${stats.total !== 1 ? "s" : ""}`,
      iconColor: "text-amber-500",
    },
    {
      icon: Zap,
      label: "LLM Mode",
      value: `${stats.includedCount} / ${stats.byokCount}`,
      subtitle: "included / BYOK",
      iconColor: "text-violet-500",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.label} className="p-5 bg-card border-border">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-lg bg-secondary flex items-center justify-center`}>
              <card.icon className={`w-4.5 h-4.5 ${card.iconColor}`} />
            </div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {card.label}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold">{card.value}</span>
            {card.pulse && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{card.subtitle}</p>
        </Card>
      ))}
    </div>
  );
}

// ─── Distribution Charts ────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  running: "bg-primary",
  creating: "bg-blue-500",
  stopped: "bg-orange-500",
  pending: "bg-secondary",
  failed: "bg-red-500",
};

const RUNTIME_COLORS: Record<string, string> = {
  openclaw: "bg-primary",
  zeroclaw: "bg-violet-500",
};

function DistributionCharts({
  byStatus,
  byRuntime,
  total,
}: {
  byStatus: Record<string, number>;
  byRuntime: Record<string, number>;
  total: number;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Status Distribution */}
      <Card className="p-5 bg-card border-border">
        <h3 className="text-sm font-semibold mb-4">Status Distribution</h3>
        <div className="space-y-3">
          {Object.entries(byStatus)
            .sort(([, a], [, b]) => b - a)
            .map(([status, count]) => {
              const pct = total > 0 ? (count / total) * 100 : 0;
              const config = STATUS_CONFIG[status];
              const color = STATUS_COLORS[status] || "bg-muted-foreground";
              return (
                <div key={status} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className={`font-medium ${config?.text || "text-muted-foreground"}`}>
                      {config?.label || status}
                    </span>
                    <span className="text-muted-foreground">{count} ({Math.round(pct)}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${color}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          {Object.keys(byStatus).length === 0 && (
            <p className="text-xs text-muted-foreground">No data</p>
          )}
        </div>
      </Card>

      {/* Runtime Distribution */}
      <Card className="p-5 bg-card border-border">
        <h3 className="text-sm font-semibold mb-4">Runtime Distribution</h3>
        <div className="space-y-3">
          {Object.entries(byRuntime)
            .sort(([, a], [, b]) => b - a)
            .map(([runtime, count]) => {
              const pct = total > 0 ? (count / total) * 100 : 0;
              const color = RUNTIME_COLORS[runtime] || "bg-muted-foreground";
              return (
                <div key={runtime} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{runtime}</span>
                    <span className="text-muted-foreground">{count} ({Math.round(pct)}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${color}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          {Object.keys(byRuntime).length === 0 && (
            <p className="text-xs text-muted-foreground">No data</p>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── LLM Credit Section ─────────────────────────────────────────────────

function LlmCreditSection({ deployments }: { deployments: Deployment[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-4">LLM Credit Usage</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {deployments.map((d) => (
          <CreditMeterCard key={d.id} deployment={d} />
        ))}
      </div>
    </div>
  );
}

function CreditMeterCard({ deployment }: { deployment: Deployment }) {
  const router = useRouter();
  const usageQuery = trpc.openrouter.getKeyUsage.useQuery(
    { deploymentId: deployment.id },
    {
      staleTime: 60_000,
      refetchInterval: 120_000,
    }
  );

  const usage = usageQuery.data;

  return (
    <Card
      className="p-4 bg-card border-border hover:border-primary/30 transition-colors cursor-pointer"
      onClick={() => router.push(`/d/${deployment.id}/configure`)}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium truncate mr-2">{deployment.name}</span>
        <StatusBadge status={deployment.status} />
      </div>

      {usageQuery.isLoading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-2 rounded-full bg-secondary" />
          <div className="flex justify-between">
            <div className="h-3 w-16 rounded bg-secondary" />
            <div className="h-3 w-16 rounded bg-secondary" />
          </div>
        </div>
      ) : usage ? (
        <div className="space-y-3">
          {/* Usage bar */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Credits Used</span>
              <span className="font-mono font-medium">
                ${usage.usage.toFixed(2)}
                {usage.limit != null && ` / $${usage.limit.toFixed(2)}`}
              </span>
            </div>
            <Progress
              value={usage.limit ? Math.min((usage.usage / usage.limit) * 100, 100) : 0}
              className="h-2"
            />
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Daily</p>
              <p className="text-xs font-mono font-medium">${usage.usageDaily.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Weekly</p>
              <p className="text-xs font-mono font-medium">${usage.usageWeekly.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Monthly</p>
              <p className="text-xs font-mono font-medium">${usage.usageMonthly.toFixed(2)}</p>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No credit data available</p>
      )}
    </Card>
  );
}

// ─── Deployment Table ───────────────────────────────────────────────────

function SortHeader({
  label,
  sortKey: key,
  currentKey,
  currentDir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = currentKey === key;
  return (
    <button
      onClick={() => onSort(key)}
      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
    >
      {label}
      {active ? (
        currentDir === "asc" ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" />
        )
      ) : (
        <ArrowUpDown className="w-3 h-3 opacity-40" />
      )}
    </button>
  );
}

function DeploymentTable({
  deployments,
  sortKey,
  sortDir,
  onSort,
  getLiveStatus,
}: {
  deployments: Deployment[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  getLiveStatus: (id: string) => { status: string } | undefined;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-4">All Deployments</h3>
      <Card className="bg-card border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>
                <SortHeader label="Name" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
              </TableHead>
              <TableHead>
                <SortHeader label="Runtime" sortKey="runtime" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
              </TableHead>
              <TableHead>
                <SortHeader label="Status" sortKey="status" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
              </TableHead>
              <TableHead>
                <SortHeader label="LLM Mode" sortKey="llmMode" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
              </TableHead>
              <TableHead className="text-right">
                <SortHeader label="Monthly Cost" sortKey="cost" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
              </TableHead>
              <TableHead>Storage</TableHead>
              <TableHead className="text-right">Credits</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deployments.map((d) => (
              <DeploymentTableRow key={d.id} deployment={d} getLiveStatus={getLiveStatus} />
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function DeploymentTableRow({
  deployment,
  getLiveStatus,
}: {
  deployment: Deployment;
  getLiveStatus: (id: string) => { status: string } | undefined;
}) {
  const router = useRouter();
  const status = getLiveStatus(deployment.id)?.status || deployment.status;
  const isRunning = status === "running";

  const storageQuery = trpc.deployment.getStorageUsage.useQuery(
    { id: deployment.id },
    {
      enabled: isRunning,
      staleTime: 30_000,
    }
  );

  const creditQuery = trpc.openrouter.getKeyUsage.useQuery(
    { deploymentId: deployment.id },
    {
      enabled: deployment.llmMode === "included",
      staleTime: 60_000,
    }
  );

  return (
    <TableRow
      className="border-border cursor-pointer"
      onClick={() => router.push(`/d/${deployment.id}/configure`)}
    >
      <TableCell>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <Bot className="w-3.5 h-3.5 text-primary" />
          </div>
          <span className="font-medium text-sm">{deployment.name}</span>
        </div>
      </TableCell>
      <TableCell>
        <span className="text-xs text-muted-foreground">{deployment.runtime}</span>
      </TableCell>
      <TableCell>
        <StatusBadge status={status} />
      </TableCell>
      <TableCell>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          deployment.llmMode === "included"
            ? "bg-violet-500/10 text-violet-500"
            : "bg-secondary text-muted-foreground"
        }`}>
          {deployment.llmMode === "included" ? "Included" : "BYOK"}
        </span>
      </TableCell>
      <TableCell className="text-right">
        <span className="text-sm font-mono">
          {deployment.isFree ? (
            <span className="text-primary">Free</span>
          ) : (
            `$${(deployment.monthlyPriceCents / 100).toFixed(2)}`
          )}
        </span>
      </TableCell>
      <TableCell>
        {isRunning ? (
          storageQuery.isLoading ? (
            <StorageMeterSkeleton compact />
          ) : storageQuery.data?.usedGb != null ? (
            <StorageMeter
              usedGb={storageQuery.data.usedGb}
              totalGb={storageQuery.data.totalGb}
              percentUsed={storageQuery.data.percentUsed}
              compact
            />
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {deployment.llmMode === "included" ? (
          creditQuery.isLoading ? (
            <div className="w-12 h-3 rounded bg-secondary animate-pulse ml-auto" />
          ) : creditQuery.data ? (
            <span className="text-xs font-mono">${creditQuery.data.usage.toFixed(2)}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

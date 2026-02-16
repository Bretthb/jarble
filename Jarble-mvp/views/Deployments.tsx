"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Layers,
  Crown,
  Link2,
  Key,
  DollarSign,
  Bot,
} from "lucide-react";
import { motion } from "framer-motion";
import { useState, useMemo } from "react";
import ProfileDropdown from "@/components/ProfileDropdown";
import { StatusBadge } from "@/components/StatusBadge";
import { runtimeNeedsLlm } from "./onboarding/wizardStepConfig";

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

interface CreditCluster {
  owner: DeploymentData;
  linked: DeploymentData[];
}

interface RuntimeGroup {
  runtimeSlug: string;
  runtimeName: string;
  hasLlm: boolean;
  clusters: CreditCluster[];
  standalone: DeploymentData[];
  unlinkedIncluded: DeploymentData[];
  allDeployments: DeploymentData[];
}

// ─── Main Component ──────────────────────────────────────────────────

export default function Deployments() {
  const { isAuthenticated, isLoading: authLoading } = useAuth0();
  const router = useRouter();
  const [activeRuntime, setActiveRuntime] = useState("all");

  const deploymentsQuery = trpc.deployment.list.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading,
  });

  const runtimesQuery = trpc.runtimeCatalog.list.useQuery();

  // ── Clustering Logic ──────────────────────────────────────────────
  const runtimeGroups = useMemo(() => {
    if (!deploymentsQuery.data) return [];

    const deps = deploymentsQuery.data as any as DeploymentData[];

    // Group by runtime
    const byRuntime = new Map<string, DeploymentData[]>();
    for (const d of deps) {
      const list = byRuntime.get(d.runtime) || [];
      list.push(d);
      byRuntime.set(d.runtime, list);
    }

    const groups: RuntimeGroup[] = [];

    for (const [slug, runtimeDeps] of byRuntime) {
      const runtimeEntry = (runtimesQuery.data as any[])?.find(
        (r: any) => r.slug === slug
      );
      const runtimeName = runtimeEntry?.name || slug;
      const hasLlm = runtimeNeedsLlm(slug);

      if (!hasLlm) {
        // Non-LLM runtime — just a flat list
        groups.push({
          runtimeSlug: slug,
          runtimeName,
          hasLlm: false,
          clusters: [],
          standalone: [],
          unlinkedIncluded: [],
          allDeployments: runtimeDeps,
        });
        continue;
      }

      // LLM-enabled runtime — group into clusters
      const owners = runtimeDeps.filter(
        (d) => d.llmMode === "included" && !d.llmApiKeySourceDeploymentId
      );
      const linked = runtimeDeps.filter(
        (d) => !!d.llmApiKeySourceDeploymentId
      );
      const standalone = runtimeDeps.filter((d) => d.llmMode === "byok");

      // Build clusters: each owner + its linked children
      const clusters: CreditCluster[] = [];
      const unlinkedIncluded: DeploymentData[] = [];

      for (const owner of owners) {
        const children = linked.filter(
          (l) => l.llmApiKeySourceDeploymentId === owner.id
        );
        if (children.length > 0) {
          clusters.push({ owner, linked: children });
        } else {
          unlinkedIncluded.push(owner);
        }
      }

      groups.push({
        runtimeSlug: slug,
        runtimeName,
        hasLlm: true,
        clusters,
        standalone,
        unlinkedIncluded,
        allDeployments: runtimeDeps,
      });
    }

    return groups;
  }, [deploymentsQuery.data, runtimesQuery.data]);

  // ── Filter by active runtime tab ──────────────────────────────────
  const filteredGroups =
    activeRuntime === "all"
      ? runtimeGroups
      : runtimeGroups.filter((g) => g.runtimeSlug === activeRuntime);

  const runtimeSlugs = runtimeGroups.map((g) => g.runtimeSlug);

  // ── Loading / Auth States ─────────────────────────────────────────
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="border-b border-border/60 sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex justify-between items-center">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => router.push("/")}
          >
            <span className="font-semibold">Jarble</span>
          </div>
          <ProfileDropdown />
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">Linked Deployments</h1>
          <p className="text-muted-foreground text-sm">
            See which deployments share resources like credit pools
          </p>
        </div>

        {/* Loading */}
        {deploymentsQuery.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Loading deployments...
              </p>
            </div>
          </div>
        ) : deploymentsQuery.data && deploymentsQuery.data.length > 0 ? (
          <>
            {/* Runtime Tabs */}
            {runtimeSlugs.length > 1 && (
              <Tabs
                value={activeRuntime}
                onValueChange={setActiveRuntime}
                className="mb-6"
              >
                <TabsList>
                  <TabsTrigger value="all">All</TabsTrigger>
                  {runtimeGroups.map((g) => (
                    <TabsTrigger key={g.runtimeSlug} value={g.runtimeSlug}>
                      {g.runtimeName}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}

            {/* Runtime Groups */}
            <div className="space-y-10">
              {filteredGroups.map((group) => (
                <RuntimeGroupSection key={group.runtimeSlug} group={group} />
              ))}
            </div>
          </>
        ) : (
          // Empty state
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center py-24"
          >
            <Layers className="w-12 h-12 mx-auto mb-4 text-muted-foreground/40" />
            <h3 className="text-xl font-semibold mb-1">
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

// ─── Runtime Group Section ──────────────────────────────────────────

function RuntimeGroupSection({ group }: { group: RuntimeGroup }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Bot className="w-5 h-5 text-primary" />
        {group.runtimeName}
        <Badge variant="secondary" className="text-xs">
          {group.allDeployments.length} deployment
          {group.allDeployments.length !== 1 ? "s" : ""}
        </Badge>
      </h3>

      {!group.hasLlm ? (
        // Non-LLM runtime — simple card grid
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {group.allDeployments.map((dep) => (
            <SimpleDeploymentCard key={dep.id} deployment={dep} />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Credit Pool Clusters */}
          {group.clusters.map((cluster) => (
            <CreditPoolCluster key={cluster.owner.id} cluster={cluster} />
          ))}

          {/* Unlinked Included Credits (owners with no children) */}
          {group.unlinkedIncluded.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Crown className="w-4 h-4" />
                Included Credits (standalone)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.unlinkedIncluded.map((dep) => (
                  <OwnerDeploymentCard key={dep.id} deployment={dep} standalone />
                ))}
              </div>
            </div>
          )}

          {/* Standalone BYOK Deployments */}
          {group.standalone.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Key className="w-4 h-4" />
                BYOK (own API key)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.standalone.map((dep) => (
                  <StandaloneDeploymentCard key={dep.id} deployment={dep} />
                ))}
              </div>
            </div>
          )}

          {/* Edge case: no deployments in any category */}
          {group.clusters.length === 0 &&
            group.unlinkedIncluded.length === 0 &&
            group.standalone.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">
                No deployments for this runtime yet.
              </p>
            )}
        </div>
      )}
    </motion.div>
  );
}

// ─── Credit Pool Cluster (tree visualization) ───────────────────────

function CreditPoolCluster({ cluster }: { cluster: CreditCluster }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/20 p-5">
      {/* Pool header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
          <Crown className="w-3.5 h-3.5 text-primary" />
        </div>
        <span className="text-sm font-medium">Credit Pool</span>
        {cluster.owner.llmCreditLimitDollars && (
          <Badge variant="outline" className="text-xs">
            <DollarSign className="w-3 h-3 mr-0.5" />$
            {cluster.owner.llmCreditLimitDollars}/mo
          </Badge>
        )}
        <Badge variant="secondary" className="text-xs">
          {cluster.linked.length + 1} deployment
          {cluster.linked.length + 1 !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Owner card (top) */}
      <div className="flex justify-center mb-0">
        <OwnerDeploymentCard deployment={cluster.owner} />
      </div>

      {/* Connector lines */}
      {cluster.linked.length > 0 && (
        <>
          {/* Vertical line from owner */}
          <div className="flex justify-center">
            <div className="w-px h-6 bg-border" />
          </div>

          {/* Horizontal bar + vertical drops to linked cards */}
          <div className="relative">
            {/* Horizontal connecting bar */}
            {cluster.linked.length > 1 && (
              <div className="flex justify-center">
                <div
                  className="h-px bg-border"
                  style={{
                    width: `${Math.min(
                      cluster.linked.length * 220,
                      600
                    )}px`,
                  }}
                />
              </div>
            )}

            {/* Linked cards */}
            <div className="flex justify-center flex-wrap gap-4 pt-0">
              {cluster.linked.map((dep) => (
                <div key={dep.id} className="relative flex flex-col items-center">
                  {/* Vertical drop line */}
                  <div className="w-px h-5 bg-border" />
                  <LinkedDeploymentCard deployment={dep} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Card Components ────────────────────────────────────────────────

function OwnerDeploymentCard({
  deployment,
  standalone = false,
}: {
  deployment: DeploymentData;
  standalone?: boolean;
}) {
  const router = useRouter();
  const isPending = deployment.status === "pending";

  return (
    <Card
      className="w-64 bg-card border-primary/20 hover:border-primary/40 transition-all cursor-pointer group"
      onClick={() =>
        router.push(
          isPending
            ? `/onboarding/${deployment.id}`
            : `/d/${deployment.id}/configure`
        )
      }
    >
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Crown className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
              {deployment.name}
            </h4>
            <p className="text-xs text-muted-foreground">{deployment.runtime}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={deployment.status} />
          {deployment.llmCreditLimitDollars && (
            <Badge variant="outline" className="text-xs">
              <DollarSign className="w-3 h-3 mr-0.5" />$
              {deployment.llmCreditLimitDollars}/mo
            </Badge>
          )}
          {standalone && (
            <Badge variant="secondary" className="text-[10px]">
              Owner
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
}

function LinkedDeploymentCard({
  deployment,
}: {
  deployment: DeploymentData;
}) {
  const router = useRouter();
  const isPending = deployment.status === "pending";

  return (
    <Card
      className="w-48 bg-card border-border hover:border-primary/30 transition-all cursor-pointer group"
      onClick={() =>
        router.push(
          isPending
            ? `/onboarding/${deployment.id}`
            : `/d/${deployment.id}/configure`
        )
      }
    >
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <h4 className="font-medium text-xs truncate group-hover:text-primary transition-colors">
            {deployment.name}
          </h4>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusBadge status={deployment.status} />
          <Badge variant="secondary" className="text-[10px]">
            Linked
          </Badge>
        </div>
      </div>
    </Card>
  );
}

function StandaloneDeploymentCard({
  deployment,
}: {
  deployment: DeploymentData;
}) {
  const router = useRouter();
  const isPending = deployment.status === "pending";

  return (
    <Card
      className="bg-card border-border hover:border-primary/30 transition-all cursor-pointer group"
      onClick={() =>
        router.push(
          isPending
            ? `/onboarding/${deployment.id}`
            : `/d/${deployment.id}/configure`
        )
      }
    >
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Key className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <h4 className="font-medium text-sm truncate flex-1 group-hover:text-primary transition-colors">
            {deployment.name}
          </h4>
          <StatusBadge status={deployment.status} />
        </div>
        <p className="text-xs text-muted-foreground">BYOK — Own API key</p>
      </div>
    </Card>
  );
}

function SimpleDeploymentCard({
  deployment,
}: {
  deployment: DeploymentData;
}) {
  const router = useRouter();
  const isPending = deployment.status === "pending";

  return (
    <Card
      className="bg-card border-border hover:border-primary/30 transition-all cursor-pointer group"
      onClick={() =>
        router.push(
          isPending
            ? `/onboarding/${deployment.id}`
            : `/d/${deployment.id}/configure`
        )
      }
    >
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Bot className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <h4 className="font-medium text-sm truncate flex-1 group-hover:text-primary transition-colors">
            {deployment.name}
          </h4>
          <StatusBadge status={deployment.status} />
        </div>
        {deployment.description && (
          <p className="text-xs text-muted-foreground line-clamp-1">
            {deployment.description}
          </p>
        )}
      </div>
    </Card>
  );
}

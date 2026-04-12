"use client";

/**
 * MarketplacePanel -- slide-out right sidebar showing installed marketplace
 * items (components, services, skills) for a deployment.
 *
 * Styled to match ConfigPanel's dark panel aesthetic (360px, warm charcoal).
 */

import { memo, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Store,
  Package,
  Puzzle,
  Zap,
  X,
  Loader2,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = "components" | "services" | "skills";

interface MarketplacePanelProps {
  deploymentId: string;
  onClose: () => void;
}

// ── Outer Shell ──────────────────────────────────────────────────────────────

function MarketplacePanelInner({ deploymentId, onClose }: MarketplacePanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("components");

  return (
    <div className="h-full w-[360px] shrink-0 border-l border-border/60 bg-background flex flex-col relative">
      {/* Right accent line */}
      <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-primary/40 via-primary/20 to-transparent" />

      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Store className="w-4 h-4 text-primary/70" />
          <div>
            <span className="text-sm font-semibold text-foreground">Marketplace</span>
            <p className="text-[10px] text-muted-foreground leading-tight">Installed items</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link href="/marketplace" passHref>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs gap-1 hover:bg-secondary/80 transition-colors"
              title="Browse marketplace"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Browse
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 rounded-md hover:bg-secondary/80 transition-colors"
            aria-label="Close marketplace panel"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border/40">
        {([
          { key: "components" as Tab, label: "Components", icon: Puzzle },
          { key: "services" as Tab, label: "Services", icon: Package },
          { key: "skills" as Tab, label: "Skills", icon: Zap },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors",
              activeTab === key
                ? "text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "components" && <ComponentsTab deploymentId={deploymentId} />}
        {activeTab === "services" && <ServicesTab deploymentId={deploymentId} />}
        {activeTab === "skills" && <SkillsTab deploymentId={deploymentId} />}
      </div>
    </div>
  );
}

export default memo(MarketplacePanelInner);

// ── Components Tab ───────────────────────────────────────────────────────────

function ComponentsTab({ deploymentId }: { deploymentId: string }) {
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.marketplace.listInstalled.useQuery({ deploymentId });
  const uninstall = trpc.marketplace.uninstall.useMutation({
    onSuccess: () => {
      utils.marketplace.listInstalled.invalidate({ deploymentId });
    },
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={Puzzle}
        title="No components installed"
        description="Browse the marketplace to find and install custom components for your agent."
      />
    );
  }

  return (
    <div className="p-3 space-y-2">
      {data.map((item) => (
        <div
          key={item.installId}
          className="rounded-lg border border-border/40 bg-secondary/10 p-3 space-y-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">
                {item.component?.displayName || item.component?.name || "Unknown"}
              </p>
              {item.component?.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                  {item.component.description}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
              title="Uninstall component"
              disabled={uninstall.isPending}
              onClick={() =>
                uninstall.mutate({
                  componentId: item.component!.id,
                  deploymentId,
                })
              }
            >
              {uninstall.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <TierBadge tier={item.component?.tier || "template"} />
            {item.component?.category && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/50 text-muted-foreground">
                {item.component.category}
              </span>
            )}
            {item.version && (
              <span className="text-[10px] text-muted-foreground">
                v{item.version}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Services Tab ─────────────────────────────────────────────────────────────

function ServicesTab({ deploymentId }: { deploymentId: string }) {
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.services.listInstalled.useQuery({ deploymentId });
  const uninstall = trpc.services.uninstall.useMutation({
    onSuccess: () => {
      utils.services.listInstalled.invalidate({ deploymentId });
    },
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No services installed"
        description="Services bundle components, skills, and instructions into a single installable unit."
      />
    );
  }

  return (
    <div className="p-3 space-y-2">
      {data.map((item) => (
        <div
          key={item.installId}
          className="rounded-lg border border-border/40 bg-secondary/10 p-3 space-y-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">
                {item.package.displayName || item.package.name}
              </p>
              {item.package.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                  {item.package.description}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
              title="Uninstall service"
              disabled={uninstall.isPending}
              onClick={() =>
                uninstall.mutate({
                  serviceId: item.package.id,
                  deploymentId,
                })
              }
            >
              {uninstall.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <HostingBadge model={item.package.hostingModel} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Skills Tab ───────────────────────────────────────────────────────────────

function SkillsTab({ deploymentId }: { deploymentId: string }) {
  const { data, isLoading, error } = trpc.services.listDeploymentSkills.useQuery({ deploymentId });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={Zap}
        title="No skills installed"
        description="Skills give your agent extra capabilities like web search, weather, and more."
      />
    );
  }

  return (
    <div className="p-3 space-y-2">
      {data.map((skill) => (
        <div
          key={skill.id}
          className="rounded-lg border border-border/40 bg-secondary/10 p-3"
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Zap className="w-3.5 h-3.5 text-primary/70" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{skill.name}</p>
              {skill.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                  {skill.description}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Shared UI ────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="p-4">
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
        {message}
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center text-center px-6 pt-12 pb-6 space-y-3">
      <div className="w-10 h-10 rounded-full bg-secondary/60 flex items-center justify-center">
        <Icon className="w-5 h-5 text-muted-foreground/70" />
      </div>
      <div>
        <p className="text-xs font-medium text-foreground/80">{title}</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed mt-1 max-w-[240px]">
          {description}
        </p>
      </div>
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const colors =
    tier === "code" || tier === "sandbox"
      ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
      : "bg-blue-500/10 text-blue-400 border-blue-500/20";

  return (
    <span
      className={cn(
        "text-[10px] font-medium px-1.5 py-0.5 rounded border",
        colors
      )}
    >
      {tier}
    </span>
  );
}

function HostingBadge({ model }: { model: string }) {
  const label =
    model === "self_hosted"
      ? "Self-hosted"
      : model === "remote"
        ? "Remote"
        : model === "hybrid"
          ? "Hybrid"
          : model;

  const colors =
    model === "remote"
      ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
      : model === "hybrid"
        ? "bg-teal-500/10 text-teal-400 border-teal-500/20"
        : "bg-green-500/10 text-green-400 border-green-500/20";

  return (
    <span
      className={cn(
        "text-[10px] font-medium px-1.5 py-0.5 rounded border",
        colors
      )}
    >
      {label}
    </span>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Trash2,
  ShieldCheck,
  Package,
  Search,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { TabProps } from "./types";

export interface SkillsTabProps extends TabProps {
  deploymentId: string;
}

export function SkillsTab({ deploymentId }: SkillsTabProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const utils = trpc.useUtils();

  // ── Queries ─────────────────────────────────────────────────────────
  const catalogQuery = trpc.skills.listCatalog.useQuery(undefined, {
    staleTime: 60_000, // catalog changes infrequently
  });

  const installedQuery = trpc.skills.listForDeployment.useQuery(
    { deploymentId },
    { enabled: !!deploymentId }
  );

  // ── Mutations ───────────────────────────────────────────────────────
  const installMutation = trpc.skills.install.useMutation({
    onSuccess: (_data, variables) => {
      const skill = catalogQuery.data?.find(
        (s: any) => s.id === variables.skillId
      );
      toast.success(`${skill?.name ?? "Skill"} installed`);
      utils.skills.listForDeployment.invalidate({ deploymentId });
      utils.skills.listCatalog.invalidate();
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to install skill");
    },
  });

  const uninstallMutation = trpc.skills.uninstall.useMutation({
    onSuccess: (_data, variables) => {
      const installed = installedQuery.data?.find(
        (entry: any) => entry.skill?.id === variables.skillId
      );
      toast.success(`${installed?.skill?.name ?? "Skill"} uninstalled`);
      utils.skills.listForDeployment.invalidate({ deploymentId });
      utils.skills.listCatalog.invalidate();
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to uninstall skill");
    },
  });

  // ── Derived data ────────────────────────────────────────────────────
  const installedSkillIds = new Set(
    (installedQuery.data ?? []).map((entry: any) => entry.skill?.id).filter(Boolean)
  );

  const availableSkills = (catalogQuery.data ?? []).filter(
    (skill: any) => !installedSkillIds.has(skill.id)
  );

  // Filter available skills by search query
  const filteredAvailable = searchQuery.trim()
    ? availableSkills.filter(
        (skill: any) =>
          skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          skill.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          skill.author?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : availableSkills;

  const isLoading = catalogQuery.isLoading || installedQuery.isLoading;
  const isError = catalogQuery.isError || installedQuery.isError;

  // Track which skill is currently being installed/uninstalled for button states
  const [pendingInstall, setPendingInstall] = useState<string | null>(null);
  const [pendingUninstall, setPendingUninstall] = useState<string | null>(null);

  const handleInstall = (skillId: string) => {
    setPendingInstall(skillId);
    installMutation.mutate(
      { deploymentId, skillId },
      {
        onSettled: () => setPendingInstall(null),
      }
    );
  };

  const handleUninstall = (skillId: string) => {
    setPendingUninstall(skillId);
    uninstallMutation.mutate(
      { deploymentId, skillId },
      {
        onSettled: () => setPendingUninstall(null),
      }
    );
  };

  // ── Loading state ───────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold mb-1">Skills & Capabilities</h2>
          <p className="text-muted-foreground text-sm">
            Add pre-built capabilities to your deployment
          </p>
        </div>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Loading skills...
          </span>
        </div>
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold mb-1">Skills & Capabilities</h2>
          <p className="text-muted-foreground text-sm">
            Add pre-built capabilities to your deployment
          </p>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertCircle className="w-8 h-8 text-destructive mb-3" />
          <p className="text-sm text-muted-foreground mb-4">
            Failed to load skills. Please try again.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              catalogQuery.refetch();
              installedQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold mb-1">Skills & Capabilities</h2>
        <p className="text-muted-foreground text-sm">
          Add pre-built capabilities to your deployment
        </p>
      </div>

      {/* ── Installed Skills ─────────────────────────────────────────── */}
      {installedQuery.data && installedQuery.data.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" />
            Installed Skills
            <Badge variant="secondary" className="text-xs">
              {installedQuery.data.length}
            </Badge>
          </h3>
          <div className="space-y-3">
            {installedQuery.data.map((entry: any) => {
              const skill = entry.skill;
              if (!skill) return null;
              const isUninstalling = pendingUninstall === skill.id;

              return (
                <div
                  key={entry.installId}
                  className="p-4 rounded-lg border border-primary/20 bg-primary/5 transition-all"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Sparkles className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-semibold text-sm">{skill.name}</h4>
                          {skill.isOfficial && (
                            <Badge
                              variant="default"
                              className="text-[10px] px-1.5 py-0 gap-0.5"
                            >
                              <ShieldCheck className="w-3 h-3" />
                              Jarble
                            </Badge>
                          )}
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0"
                          >
                            Installed
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {skill.description}
                        </p>
                        <p className="text-[11px] text-muted-foreground-subtle mt-1.5">
                          by {skill.author}
                          {entry.installedAt && (
                            <>
                              {" "}
                              &middot; installed{" "}
                              {new Date(entry.installedAt).toLocaleDateString()}
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUninstall(skill.id)}
                      disabled={isUninstalling}
                      className="border-border text-muted-foreground hover:text-destructive hover:border-destructive/30 flex-shrink-0"
                    >
                      {isUninstalling ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          Uninstall
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Available Skills (Marketplace) ───────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          {installedQuery.data && installedQuery.data.length > 0
            ? "Available Skills"
            : "Skills Marketplace"}
        </h3>

        {/* Search bar */}
        {(catalogQuery.data ?? []).length > 4 && (
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search skills..."
              className="w-full pl-9 pr-4 py-2 bg-secondary/80 border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}

        {filteredAvailable.length === 0 ? (
          <div className="py-12 text-center">
            {searchQuery.trim() ? (
              <>
                <Search className="w-8 h-8 text-muted-foreground/50 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  No skills match &ldquo;{searchQuery}&rdquo;
                </p>
              </>
            ) : (catalogQuery.data ?? []).length === 0 ? (
              <>
                <Package className="w-8 h-8 text-muted-foreground/50 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  No skills available yet
                </p>
                <p className="text-xs text-muted-foreground-subtle mt-1">
                  Skills will appear here as they are published to the marketplace
                </p>
              </>
            ) : (
              <>
                <ShieldCheck className="w-8 h-8 text-primary/50 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  All available skills are installed
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredAvailable.map((skill: any) => {
              const isInstalling = pendingInstall === skill.id;

              return (
                <div
                  key={skill.id}
                  className="p-4 rounded-lg border border-border bg-secondary/50 hover:border-primary/30 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-semibold text-sm">{skill.name}</h4>
                        {skill.isOfficial && (
                          <Badge
                            variant="default"
                            className="text-[10px] px-1.5 py-0 gap-0.5"
                          >
                            <ShieldCheck className="w-3 h-3" />
                            Jarble
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {skill.description}
                      </p>
                      <p className="text-[11px] text-muted-foreground/70 mt-1.5">
                        by {skill.author}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => handleInstall(skill.id)}
                      disabled={isInstalling}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                      {isInstalling ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5 mr-1" />
                          Install
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

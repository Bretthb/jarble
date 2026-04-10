"use client";

/**
 * TeamMembershipsPanel — shows every team (flow) the current deployment
 * belongs to, plus its teammates within each team.
 *
 * Closes the "Per-deployment team membership visibility" gap from
 * `docs/audits/fractal-vision-gap-audit.md`. Until this landed, the only
 * way to see if a deployment was on a team was to navigate to
 * `/deployments` → Bot Teams tab and visually scan every flow's nodes.
 *
 * Driven by the `flows.listForDeployment` tRPC procedure (added in the
 * same PR). Empty result is the common case for solo deployments — we
 * show a friendly empty state pointing the user at Bot Teams.
 *
 * Per the fractal mental model: every deployment is atomic at `/d/[id]`,
 * teams are clusters-of-clusters via flows. This panel makes that
 * relationship visible from the deployment side, which previously was
 * one-way (you could see deployments inside a team, but not teams from
 * a deployment).
 */

import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { X, Users, Crown, ExternalLink, Loader2, Check, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface TeamMembershipsPanelProps {
  deploymentId: string;
  onClose: () => void;
}

export default function TeamMembershipsPanel({
  deploymentId,
  onClose,
}: TeamMembershipsPanelProps) {
  const router = useRouter();
  const query = trpc.flows.listForDeployment.useQuery(
    { deploymentId },
    { staleTime: 30_000 },
  );
  const deploymentQuery = trpc.deployment.getById.useQuery({ id: deploymentId });
  const activeFlowId = (deploymentQuery.data as any)?.activeFlowId ?? null;

  const setActiveFlowMutation = trpc.deployment.setActiveFlow.useMutation({
    onSuccess: (data) => {
      deploymentQuery.refetch();
      toast.success(data.activeFlowId ? "Team activated for delegation" : "Team deactivated");
    },
    onError: (err) => toast.error(err.message),
  });

  const memberships = query.data ?? [];
  const isLoading = query.isLoading;
  const isError = query.isError;

  return (
    <aside
      className="fixed right-0 top-[57px] bottom-0 z-40 w-full sm:w-96 border-l border-border bg-card shadow-xl flex flex-col overflow-hidden"
      aria-label="Team Memberships"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">Team Memberships</h2>
          {memberships.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {memberships.length}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-7 w-7 p-0"
          aria-label="Close team memberships panel"
          type="button"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {isLoading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {isError && (
          <p className="text-xs text-destructive">
            Couldn&apos;t load team memberships. Try refreshing.
          </p>
        )}

        {!isLoading && !isError && memberships.length === 0 && (
          <div className="text-center py-10 space-y-3">
            <Users className="w-10 h-10 text-muted-foreground/30 mx-auto" />
            <div>
              <p className="text-sm text-foreground font-medium">
                Not on any teams yet
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                This agent works solo right now. Add it to a team in
                <br />
                Bot Teams to make it collaborate with others.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => router.push("/deployments")}
              className="mt-2"
            >
              Open Bot Teams
              <ExternalLink className="w-3 h-3 ml-1.5" />
            </Button>
          </div>
        )}

        {!isLoading && !isError && memberships.length > 0 && (
          <div className="space-y-4">
            {memberships.map((m) => (
              <div
                key={m.flowId}
                className="rounded-lg border border-border bg-card/50 overflow-hidden"
              >
                {/* Team header */}
                <div className="px-3 py-2.5 border-b border-border bg-secondary/30">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {m.isEntry && (
                          <Crown
                            className="w-3.5 h-3.5 text-amber-500 shrink-0"
                            aria-label="Entry point"
                          />
                        )}
                        <h3 className="text-sm font-semibold truncate">
                          {m.flowName}
                        </h3>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Your role:{" "}
                        <span className="font-medium text-foreground/80">
                          {m.roleLabel}
                        </span>
                        {m.isEntry && " • entry point"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {activeFlowId === m.flowId ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                          onClick={() => setActiveFlowMutation.mutate({ id: deploymentId, flowId: null })}
                          disabled={setActiveFlowMutation.isPending}
                        >
                          <Check className="w-3 h-3 mr-1" />
                          Active
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => setActiveFlowMutation.mutate({ id: deploymentId, flowId: m.flowId })}
                          disabled={setActiveFlowMutation.isPending}
                        >
                          <Zap className="w-3 h-3 mr-1" />
                          Activate
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          router.push(`/deployments?tab=botteams&flow=${m.flowId}`)
                        }
                        aria-label={`Open ${m.flowName} in Bot Teams`}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Teammates list */}
                {m.teammates.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-3 py-3">
                    No teammates yet — you&apos;re the only deployment in this team.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {m.teammates.map((t) => (
                      <li
                        key={t.deploymentId}
                        className="px-3 py-2 flex items-center gap-2 text-xs hover:bg-secondary/30 cursor-pointer"
                        onClick={() => router.push(`/d/${t.deploymentId}`)}
                      >
                        {/* Status dot mirrors the FlowListSidebar pill colors */}
                        <span
                          className={cn(
                            "inline-block w-1.5 h-1.5 rounded-full shrink-0",
                            t.status === "running"
                              ? "bg-emerald-500"
                              : t.status === "stopped"
                                ? "bg-red-500/80"
                                : "bg-amber-500",
                          )}
                          aria-hidden
                        />
                        {t.isEntry && (
                          <Crown
                            className="w-3 h-3 text-amber-500 shrink-0"
                            aria-label="Entry point"
                          />
                        )}
                        <span className="font-medium truncate flex-1">
                          {t.name}
                        </span>
                        <span className="text-muted-foreground shrink-0">
                          {t.roleLabel}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

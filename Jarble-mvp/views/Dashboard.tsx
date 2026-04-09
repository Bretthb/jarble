"use client";

import { useAuth0 } from "@auth0/auth0-react";
import Image from "next/image";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "next/navigation";
import {
  Plus,
  Loader2,
  Bot,
  Building2,
  Trash2,
  Clock,
  DollarSign,
  MailWarning,
  MailCheck,
  Play,
  Square,
  RotateCw,
  AlertCircle,
  Download,
  User,
  Users,
  Network,
} from "lucide-react";
import dynamic from "next/dynamic";

// Lazy-load heavy views to avoid loading ReactFlow on initial dashboard render
const LazyDeployments = dynamic(() => import("@/views/Deployments"), { ssr: false });
const LazyResourceMap = dynamic(() => import("@/views/ResourceMapView"), { ssr: false });
import { toast } from "sonner";
import { motion } from "framer-motion";
import { useState, useCallback, memo, useMemo } from "react";

type DashboardTab = "deployments" | "botteams" | "resources";
import ProfileDropdown from "@/components/ProfileDropdown";
import { useOrg } from "@/contexts/OrgContext";
import { StatusBadge } from "@/components/StatusBadge";
import { StorageMeter, StorageMeterSkeleton } from "@/components/StorageMeter";
import { ResourceMetrics } from "@/components/ResourceMetrics";
import { useStatusStream, type DeploymentStatus } from "@/hooks/useStatusStream";

function base64ToBlob(b64: string, mime = "application/zip"): Blob {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Dashboard() {
  const { user, isAuthenticated, isLoading: authLoading, error: authError } = useAuth0();
  const { theme } = useTheme();
  const { activeOrgId, activeOrg } = useOrg();
  // Members are read-only viewers in org context; owner/admin can manage
  const canManageDeployments = !activeOrg || activeOrg.role === "owner" || activeOrg.role === "admin";
  const logoSrc = theme === "dark" ? "/logodark.png" : "/logo.png";

  if (authError) {
    console.error('[Auth0] Authentication error:', authError);
  }
  const router = useRouter();

  const deploymentsQuery = trpc.deployment.list.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading,
  });

  // Filter deployments by active org context
  const filteredDeployments = (deploymentsQuery.data ?? []).filter((d: any) =>
    activeOrgId ? d.orgId === activeOrgId : !d.orgId,
  );

  // Real-time status stream - pushes status changes via SSE
  const { getStatus: getLiveStatus } = useStatusStream({
    enabled: isAuthenticated && !authLoading,
  });

  const deleteDeploymentMutation = trpc.deployment.delete.useMutation({
    onSuccess: () => {
      toast.success("Deployment deleted");
      deploymentsQuery.refetch();
    },
    onError: (error: { message?: string }) => {
      toast.error(error.message || "Failed to delete deployment");
    },
  });

  const stopMutation = trpc.deployment.stop.useMutation({
    onSuccess: () => {
      toast.success("Deployment stopped");
      deploymentsQuery.refetch();
    },
    onError: (error: { message?: string }) => {
      toast.error(error.message || "Failed to stop deployment");
    },
  });

  const startMutation = trpc.deployment.start.useMutation({
    onSuccess: () => {
      toast.success("Deployment starting...");
      deploymentsQuery.refetch(); // Pick up "creating" status; SSE will push "running"
    },
    onError: (error: { message?: string }) => {
      toast.error(error.message || "Failed to start deployment");
      deploymentsQuery.refetch();
    },
  });

  const restartMutation = trpc.deployment.restart.useMutation({
    onSuccess: () => {
      toast.success("Deployment restarting...");
      deploymentsQuery.refetch(); // Pick up "creating" status; SSE will push "running"
    },
    onError: (error: { message?: string }) => {
      toast.error(error.message || "Failed to restart deployment");
      deploymentsQuery.refetch();
    },
  });

  const exportMutation = trpc.deployment.exportConfigs.useMutation({
    onSuccess: (data: { filename: string; data: string }) => {
      const blob = base64ToBlob(data.data);
      downloadBlob(blob, data.filename);
      toast.success("Config files exported!");
    },
    onError: (error: { message?: string }) => {
      toast.error(error.message || "Failed to export configs");
    },
  });

  // Stable callback references for DeploymentCard memoization
  const handleDelete = useCallback(
    (id: string) => deleteDeploymentMutation.mutate({ id }),
    [deleteDeploymentMutation]
  );
  const handleStop = useCallback(
    (id: string) => stopMutation.mutate({ id }),
    [stopMutation]
  );
  const handleStart = useCallback(
    (id: string) => startMutation.mutate({ id }),
    [startMutation]
  );
  const handleRestart = useCallback(
    (id: string) => restartMutation.mutate({ id }),
    [restartMutation]
  );
  const handleExport = useCallback(
    (id: string) => exportMutation.mutate({ id }),
    [exportMutation]
  );

  // Batch storage query - one request for all running deployments instead of N
  const runningIds = filteredDeployments
    .filter((d: any) => {
      const live = getLiveStatus(d.id)?.status;
      return (live || d.status) === "running";
    })
    .map((d: any) => d.id);

  const storageBatchQuery = trpc.deployment.getStorageUsageBatch.useQuery(
    { ids: runningIds },
    { enabled: runningIds.length > 0, staleTime: 30_000, refetchInterval: 60_000 }
  );

  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [activeTab, setActiveTab] = useState<DashboardTab>("deployments");

  const resendVerificationMutation = trpc.user.resendVerificationEmail.useMutation({
    onSuccess: () => {
      toast.success("Verification email sent! Check your inbox.");
    },
    onError: (error: { message?: string }) => {
      toast.error(error.message || "Failed to send verification email");
    },
    onSettled: () => setIsResendingVerification(false),
  });

  const emailVerified = user?.email_verified ?? false;

  const handleCreateDeployment = () => {
    if (!emailVerified) {
      toast.error("Please verify your email before creating a deployment.");
      return;
    }
    router.push("/onboarding/new");
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <nav className="border-b border-border/60 sticky top-0 z-50 bg-background">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex justify-between items-center">
            <Skeleton className="h-5 w-14" />
            <Skeleton className="w-8 h-8 rounded-full" />
          </div>
        </nav>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex items-center justify-between mb-6">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-8 w-36 rounded-md" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="bg-card border-border overflow-hidden">
                <div className="p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <Skeleton className="w-10 h-10 rounded-lg" />
                    <div className="flex-1 min-w-0">
                      <Skeleton className="h-4 w-32 mb-1.5" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                  <Skeleton className="h-3.5 w-full mb-1.5" />
                  <Skeleton className="h-3.5 w-3/4" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 bg-card border-border text-center">
          <p className="text-muted-foreground mb-4">Please log in to view your dashboard</p>
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
          <a href="/" className="flex items-center cursor-pointer no-underline">
            <Image src={logoSrc} alt="Jarble" width={120} height={36} className="h-12 w-auto" />
          </a>
          <ProfileDropdown />
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Email Verification Banner */}
        {!emailVerified && (
          <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-3 rounded-lg border border-border bg-secondary/50 px-4 py-3">
            <MailWarning className="w-5 h-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Verify your email to deploy</p>
              <p className="text-xs text-muted-foreground">
                Check your inbox for a verification link from Jarble. You need to verify your email before creating deployments.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsResendingVerification(true);
                resendVerificationMutation.mutate();
              }}
              disabled={isResendingVerification}
              className="shrink-0 border-border hover:bg-secondary/50 w-full sm:w-auto"
            >
              {isResendingVerification ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <MailCheck className="w-3.5 h-3.5 mr-1.5" />
              )}
              Resend
            </Button>
          </div>
        )}

        {/* Workspace Banner */}
        <div className={`mb-6 flex items-center gap-3 rounded-lg border px-4 py-3 ${
          activeOrg
            ? "border-primary/30 bg-primary/5"
            : "border-border bg-secondary/30"
        }`}>
          {activeOrg ? (
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
              <User className="w-5 h-5 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {activeOrg ? activeOrg.name : "Personal Workspace"}
            </p>
            <p className="text-xs text-muted-foreground">
              {activeOrg
                ? activeOrg.role === "member"
                  ? "Viewing organization deployments (view only)"
                  : `Viewing organization deployments \u00b7 ${activeOrg.role}`
                : "Viewing your personal deployments"}
            </p>
          </div>
          {activeOrg && (activeOrg.role === "owner" || activeOrg.role === "admin") && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs shrink-0"
              onClick={() => router.push(`/orgs/${activeOrg.id}`)}
            >
              Manage
            </Button>
          )}
        </div>

        {/* Header with tabs */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Deployments</h2>
          {canManageDeployments && activeTab === "deployments" && (
            <Button
              onClick={handleCreateDeployment}
              size="sm"
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium h-8"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              New Deployment
            </Button>
          )}
        </div>

        {/* Dashboard tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-border/60 pb-px">
          {([
            { key: "deployments" as DashboardTab, label: "My Bots", icon: Bot },
            { key: "botteams" as DashboardTab, label: "Bot Teams", icon: Users },
            { key: "resources" as DashboardTab, label: "Resource Map", icon: Network },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md transition-colors ${
                activeTab === key
                  ? "text-foreground border-b-2 border-primary -mb-px bg-secondary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/20"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "botteams" && (
          <div className="flex-1 min-h-[500px] -mx-6 -mb-6">
            <LazyDeployments defaultTab="botteams" embedded />
          </div>
        )}

        {activeTab === "resources" && (
          <div className="flex-1 min-h-[500px] -mx-6 -mb-6">
            <LazyResourceMap deployments={filteredDeployments as any} />
          </div>
        )}

        {/* Deployments Grid (only visible on deployments tab) */}
        {activeTab === "deployments" && (deploymentsQuery.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="bg-card border-border overflow-hidden">
                <div className="p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <Skeleton className="w-10 h-10 rounded-lg" />
                    <div className="flex-1 min-w-0">
                      <Skeleton className="h-4 w-32 mb-1.5" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-3.5 w-full mb-1.5" />
                  <Skeleton className="h-3.5 w-3/4 mb-3" />
                  <div className="pt-3 border-t border-border/50 flex items-center justify-between">
                    <Skeleton className="h-3 w-24" />
                    <div className="flex gap-1">
                      <Skeleton className="h-7 w-7 rounded-md" />
                      <Skeleton className="h-7 w-7 rounded-md" />
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : deploymentsQuery.isError ? (
          <div className="text-center py-24">
            <Bot className="w-12 h-12 mx-auto mb-4 text-destructive/40" />
            <h3 className="text-lg font-semibold mb-1">Failed to load deployments</h3>
            <p className="text-muted-foreground text-sm mb-6 max-w-xs mx-auto">
              {deploymentsQuery.error?.message || "Something went wrong. Please try again."}
            </p>
            <Button
              onClick={() => deploymentsQuery.refetch()}
              variant="outline"
            >
              Retry
            </Button>
          </div>
        ) : filteredDeployments.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredDeployments.map((deployment: any) => (
              <DeploymentCard
                key={deployment.id}
                deployment={deployment}
                readOnly={!canManageDeployments}
                liveStatusData={getLiveStatus(deployment.id)}
                onDelete={handleDelete}
                onStop={handleStop}
                onStart={handleStart}
                onRestart={handleRestart}
                onExport={handleExport}
                isToggling={
                  (stopMutation.isPending && stopMutation.variables?.id === deployment.id)
                  || (startMutation.isPending && startMutation.variables?.id === deployment.id)
                  || (restartMutation.isPending && restartMutation.variables?.id === deployment.id)
                }
                isExporting={exportMutation.isPending && exportMutation.variables?.id === deployment.id}
                storageData={storageBatchQuery.data?.[deployment.id] ?? undefined}
                storageLoading={storageBatchQuery.isLoading}
              />
            ))}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center py-24"
          >
            <Bot className="w-12 h-12 mx-auto mb-4 text-muted-foreground/40" />
            <h3 className="text-lg font-semibold mb-1">No deployments yet</h3>
            <p className="text-muted-foreground text-sm mb-6 max-w-xs mx-auto">Create your first AI deployment in under 2 minutes</p>
            {canManageDeployments ? (
              <Button
                onClick={handleCreateDeployment}
                size="lg"
                className="font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                <Plus className="w-5 h-5 mr-2" />
                Create Deployment
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ask an admin to create deployments for this organization.
              </p>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

const DeploymentCard = memo(function DeploymentCard({ deployment, readOnly, liveStatusData, onDelete, onStop, onStart, onRestart, onExport, isToggling, isExporting, storageData, storageLoading }: {
  deployment: {
    id: string;
    name: string;
    status: string;
    runtime: string;
    description: string | null;
    monthlyPriceCents: number;
    llmMode: string;
    cancelledAt?: Date | string | null;
    cancelAtPeriodEnd?: Date | string | null;
  };
  readOnly?: boolean;
  liveStatusData?: DeploymentStatus;
  onDelete: (id: string) => void;
  onStop: (id: string) => void;
  onStart: (id: string) => void;
  onRestart: (id: string) => void;
  onExport: (id: string) => void;
  isToggling: boolean;
  isExporting: boolean;
  storageData?: { usedGb?: number; totalGb?: number; percentUsed?: number; allocatedGb?: number } | null;
  storageLoading?: boolean;
}) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Use live SSE status if available, fall back to DB status
  const status = liveStatusData?.status || deployment.status;

  // Query storage usage (only for running deployments)
  const isRunning = status === "running";
  const isStopped = status === "stopped";
  const isTransitioning = status === "creating";
  const isPending = status === "pending";
  const handleCardClick = () => {
    if (isPending) {
      router.push(`/onboarding/${deployment.id}`);
    } else {
      router.push(`/d/${deployment.id}`);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.3 }}
    >
      <Card
        className="bg-card border-border hover:border-primary/30 transition-all overflow-hidden cursor-pointer group focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background outline-none"
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={(e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), handleCardClick())}
      >
        <div className="p-5">
          {/* Row 1: Name + Status */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-base truncate group-hover:text-primary transition-colors">{deployment.name}</h3>
                <p className="text-xs text-muted-foreground">{deployment.runtime}</p>
              </div>
            </div>
            <StatusBadge status={status} />
          </div>

          {/* Pending banner */}
          {isPending && (
            <div className="mb-3 px-3 py-2 rounded-md bg-secondary border border-border flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium text-muted-foreground">Setup incomplete - click to finish</span>
            </div>
          )}

          {/* Description */}
          {deployment.description && (
            <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{deployment.description}</p>
          )}

          {/* Storage Usage (running deployments only) */}
          {isRunning && (
            <div className="mb-3">
              {storageLoading ? (
                <StorageMeterSkeleton compact />
              ) : storageData?.usedGb != null ? (
                <StorageMeter
                  usedGb={storageData.usedGb}
                  totalGb={storageData.totalGb ?? 0}
                  percentUsed={storageData.percentUsed ?? 0}
                  compact
                />
              ) : null}
            </div>
          )}

          {/* Resource Metrics (running deployments only) */}
          {isRunning && liveStatusData && (
            <div className="mb-3">
              <ResourceMetrics
                nodeName={liveStatusData.nodeName}
                cpuUsageMillicores={liveStatusData.cpuUsageMillicores}
                cpuLimitMillicores={liveStatusData.cpuLimitMillicores}
                memoryUsageMb={liveStatusData.memoryUsageMb}
                memoryLimitMb={liveStatusData.memoryLimitMb}
                uptimeSeconds={liveStatusData.uptimeSeconds}
                restarts={liveStatusData.restarts}
              />
            </div>
          )}

          {/* Row 2: Metadata + Actions */}
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-border/50">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs text-muted-foreground min-w-0">
              {/* Cancelling badge */}
              {deployment.cancelledAt && deployment.cancelAtPeriodEnd && (() => {
                const cancelDays = Math.max(0, Math.ceil((new Date(deployment.cancelAtPeriodEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                return (
                  <span className="inline-flex items-center gap-1 text-orange-500">
                    <AlertCircle className="w-3 h-3" />
                    Cancelling ({cancelDays}d left)
                  </span>
                );
              })()}
              {deployment.cancelledAt && deployment.cancelAtPeriodEnd && <span className="text-border">·</span>}
              {/* Beta pricing — matches Home hero ($13.99/mo per agent).
                  The deployment.monthlyPriceCents value in the DB is seeded
                  from runtime_catalog and may still carry the pre-beta $27
                  figure. During beta we show the canonical $13.99 string so
                  marketing and product stay in sync. Tracked in JAR-49. */}
              <span className="inline-flex items-center gap-1">
                <DollarSign className="w-3 h-3" />
                $13.99/mo
              </span>
              <span className="text-border">·</span>
              <span>{deployment.llmMode === "byok" ? "BYOK" : "Included"} LLM</span>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {readOnly ? (
                <span className="text-xs text-muted-foreground/60 px-1">View only</span>
              ) : (
                <>
                  {/* Stop/Start toggle */}
                  {isRunning && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onStop(deployment.id)}
                      disabled={isToggling}
                      className="text-muted-foreground hover:text-orange-500 h-7 w-7 p-0"
                      title="Stop"
                      aria-label="Stop deployment"
                    >
                      {isToggling ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Square className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  )}

                  {isStopped && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onStart(deployment.id)}
                      disabled={isToggling}
                      className="text-muted-foreground hover:text-primary h-7 w-7 p-0"
                      title="Start"
                      aria-label="Start deployment"
                    >
                      {isToggling ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  )}

                  {isTransitioning && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled
                      className="text-muted-foreground h-7 w-7 p-0"
                      title="Starting..."
                      aria-label="Deployment starting"
                    >
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    </Button>
                  )}

                  {/* Export (only for cancelled running deployments) */}
                  {deployment.cancelledAt && isRunning && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onExport(deployment.id)}
                      disabled={isExporting}
                      className="text-muted-foreground hover:text-orange-500 h-7 w-7 p-0"
                      title="Export configs"
                      aria-label="Export deployment configs"
                    >
                      {isExporting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  )}

                  {/* Restart (only for running) */}
                  {isRunning && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onRestart(deployment.id)}
                      disabled={isToggling}
                      className="text-muted-foreground hover:text-primary h-7 w-7 p-0"
                      title="Restart"
                      aria-label="Restart deployment"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </Button>
                  )}

                  {/* Delete */}
                  {confirmDelete ? (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => { onDelete(deployment.id); setConfirmDelete(false); }}
                        className="text-xs h-7 px-2"
                      >
                        Delete
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmDelete(false)}
                        className="text-xs border-border h-7 px-2"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDelete(true)}
                      className="text-muted-foreground hover:text-red-500 h-7 w-7 p-0"
                      title="Delete"
                      aria-label="Delete deployment"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
});

"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth0 } from "@auth0/auth0-react";
import {
  ArrowLeft,
  Download,
  CheckCircle2,
  LogIn,
  User,
  Package,
  Puzzle,
  Wrench,
  FileText,
  Globe,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import DeploymentPicker from "@/components/marketplace/DeploymentPicker";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const HOSTING_STYLES: Record<string, string> = {
  self_hosted: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",
  remote: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
  hybrid: "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/20",
};

const HOSTING_LABELS: Record<string, string> = {
  self_hosted: "Self-hosted",
  remote: "Cloud",
  hybrid: "Hybrid",
};

const HEALTH_DOT_STYLES: Record<string, string> = {
  healthy: "bg-emerald-500",
  degraded: "bg-amber-500",
  offline: "bg-red-500",
  unknown: "bg-muted-foreground",
};

const HEALTH_LABELS: Record<string, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  offline: "Offline",
  unknown: "Unknown",
};

interface ServiceComponent {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  tier: string;
  category: string | null;
}

interface ServiceSkill {
  id: string;
  name: string;
  description: string | null;
}

interface ServiceDetailProps {
  serviceId: string;
}

export function ServiceDetail({ serviceId }: ServiceDetailProps) {
  const { isAuthenticated, loginWithRedirect, isLoading: authLoading } = useAuth0();

  const [selectedDeployment, setSelectedDeployment] = useState<string | null>(null);
  const [installState, setInstallState] = useState<"idle" | "installing" | "installed">("idle");

  const serviceQuery = trpc.services.get.useQuery(
    { serviceId },
    { enabled: !!serviceId }
);

  const installMutation = trpc.services.install.useMutation();
  const uninstallMutation = trpc.services.uninstall.useMutation();

  const pkg = serviceQuery.data;
  const isLoading = serviceQuery.isLoading;

  const handleInstall = async () => {
    if (!selectedDeployment) return;
    setInstallState("installing");
    try {
      await installMutation.mutateAsync({
        serviceId,
        deploymentId: selectedDeployment,
      });
      setInstallState("installed");
    } catch {
      setInstallState("idle");
    }
  };

  const handleUninstall = async () => {
    if (!selectedDeployment) return;
    try {
      await uninstallMutation.mutateAsync({
        serviceId,
        deploymentId: selectedDeployment,
      });
      setInstallState("idle");
    } catch {
      // Error shown via tRPC error handling
    }
  };

  const hostingStyle = pkg ? (HOSTING_STYLES[pkg.hostingModel] ?? "bg-secondary text-secondary-foreground border-border") : "";
  const hostingLabel = pkg ? (HOSTING_LABELS[pkg.hostingModel] ?? pkg.hostingModel) : "";
  const isRemoteOrHybrid = pkg ? (pkg.hostingModel === "remote" || pkg.hostingModel === "hybrid") : false;
  const healthStatus = (pkg as any)?.remoteHealth ?? "unknown";
  const healthDot = HEALTH_DOT_STYLES[healthStatus] ?? HEALTH_DOT_STYLES.unknown;
  const healthLabel = HEALTH_LABELS[healthStatus] ?? "Unknown";

  return (
    <>
      <Link
        href="/marketplace"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="size-4" />
        Back to Marketplace
      </Link>

      {isLoading ? (
          <ServiceDetailSkeleton />
        ) : !pkg ? (
          <ServiceNotFound />
        ) : (
          <>
            {/* Draft/Rejected banner */}
            {(pkg.status === "draft" || pkg.status === "rejected") && (
              <Alert className="mb-6">
                <AlertCircle className="size-4" />
                <AlertTitle>
                  {pkg.status === "draft" ? "Draft Service" : "Rejected Service"}
                </AlertTitle>
                <AlertDescription className="flex items-center justify-between">
                  <span>
                    This service is in {pkg.status} mode and is not publicly visible.
                  </span>
                  <Button variant="outline" size="sm" asChild className="ml-4 shrink-0">
                    <Link href={`/marketplace/services/${serviceId}/draft`}>
                      View Draft Details
                    </Link>
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {/* Service header */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-8">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                    {pkg.displayName}
                  </h2>
                  <Badge
                    variant="outline"
                    className={cn("text-xs gap-1", "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border-indigo-500/20")}
                  >
                    <Package className="size-3" />
                    Service
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn("text-xs gap-1", hostingStyle)}
                  >
                    {isRemoteOrHybrid && (
                      <span
                        className={cn("inline-block size-2 rounded-full shrink-0", healthDot)}
                        title={healthLabel}
                        aria-label={`Health: ${healthLabel}`}
                      />
                    )}
                    {hostingLabel}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Download className="size-3.5" />
                    {(pkg.totalInstalls ?? 0).toLocaleString()} installs
                  </span>
                  <span className="flex items-center gap-1">
                    <Puzzle className="size-3.5" />
                    {pkg.components.length} component{pkg.components.length !== 1 ? "s" : ""}
                  </span>
                  <span className="flex items-center gap-1">
                    <Wrench className="size-3.5" />
                    {pkg.skills.length} skill{pkg.skills.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            </div>

            {/* Two-column layout */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8">
              {/* Left column */}
              <div className="space-y-8 min-w-0">
                {/* Description */}
                <section>
                  <h3 className="text-lg font-semibold mb-3">Description</h3>
                  <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {pkg.description ?? "No description available."}
                  </p>
                </section>

                {/* Included Components */}
                {pkg.components.length > 0 && (
                  <section>
                    <h3 className="text-lg font-semibold mb-3">
                      Included Components ({pkg.components.length})
                    </h3>
                    <div className="space-y-2">
                      {pkg.components.map((comp: ServiceComponent) => (
                        <div
                          key={comp.id}
                          className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3"
                        >
                          <Puzzle className="size-4 text-muted-foreground shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{comp.displayName}</p>
                            {comp.description && (
                              <p className="text-xs text-muted-foreground truncate">
                                {comp.description}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px]">
                              {comp.tier}
                            </Badge>
                            {comp.category && (
                              <Badge variant="secondary" className="text-[10px]">
                                {comp.category}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Included Skills */}
                {pkg.skills.length > 0 && (
                  <section>
                    <h3 className="text-lg font-semibold mb-3">
                      Included Skills ({pkg.skills.length})
                    </h3>
                    <div className="space-y-2">
                      {pkg.skills.map((skill: ServiceSkill) => (
                        <div
                          key={skill.id}
                          className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3"
                        >
                          <Wrench className="size-4 text-muted-foreground shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{skill.name}</p>
                            {skill.description && (
                              <p className="text-xs text-muted-foreground truncate">
                                {skill.description}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Instruction Snippet Preview */}
                {pkg.instructionSnippet && (
                  <section>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <FileText className="size-5" />
                      Bot Instructions
                    </h3>
                    <p className="text-xs text-muted-foreground mb-2">
                      This snippet will be added to your bot&apos;s system prompt when installed.
                    </p>
                    <pre className="rounded-lg border border-border bg-muted/50 p-4 overflow-x-auto text-sm text-foreground whitespace-pre-wrap">
                      {pkg.instructionSnippet}
                    </pre>
                  </section>
                )}
              </div>

              {/* Right column - sidebar */}
              <div className="space-y-5">
                {/* Install card */}
                <Card className="border border-border">
                  <CardContent className="pt-5 space-y-4">
                    {/* Price */}
                    <div className="text-center">
                      <span className="text-3xl font-bold">
                        {pkg.pricingModel === "free" || (pkg.priceUsdCents ?? 0) === 0
                          ? "Free"
                          : `$${((pkg.priceUsdCents ?? 0) / 100).toFixed(2)}`}
                      </span>
                    </div>

                    <Separator />

                    {/* Install actions */}
                    {!isAuthenticated && !authLoading ? (
                      <Button
                        className="w-full"
                        onClick={() => loginWithRedirect()}
                      >
                        <LogIn className="size-4 mr-2" />
                        Sign in to install
                      </Button>
                    ) : installState === "installed" ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="size-4" />
                          Installed
                        </div>
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={handleUninstall}
                        >
                          Uninstall
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <DeploymentPicker
                          selectedId={selectedDeployment}
                          onSelect={setSelectedDeployment}
                        />
                        <Button
                          className="w-full"
                          disabled={!selectedDeployment || installState === "installing"}
                          onClick={handleInstall}
                        >
                          {installState === "installing" ? (
                            "Installing..."
                          ) : (
                            <>
                              <Download className="size-4 mr-2" />
                              Install Service
                            </>
                          )}
                        </Button>
                      </div>
                    )}

                    {installMutation.error && (
                      <p className="text-sm text-destructive text-center">
                        {installMutation.error.message}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Creator card */}
                {pkg.creator && (
                  <Card className="border border-border">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold">Creator</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="size-8 rounded-full bg-muted flex items-center justify-center">
                          <User className="size-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {pkg.creator.displayName}
                          </p>
                          {pkg.creator.bio && (
                            <p className="text-xs text-muted-foreground truncate">
                              {pkg.creator.bio}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Service info card */}
                <Card className="border border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">Details</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <dl className="space-y-3 text-sm">
                      <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground flex items-center gap-1.5">
                          <Package className="size-3.5" />
                          Hosting
                        </dt>
                        <dd>
                          <Badge
                            variant="outline"
                            className={cn("text-[11px] gap-1", hostingStyle)}
                          >
                            {isRemoteOrHybrid && (
                              <span
                                className={cn("inline-block size-1.5 rounded-full shrink-0", healthDot)}
                                aria-hidden="true"
                              />
                            )}
                            {hostingLabel}
                          </Badge>
                        </dd>
                      </div>

                      {isRemoteOrHybrid && (
                        <div className="flex items-center justify-between">
                          <dt className="text-muted-foreground flex items-center gap-1.5">
                            <span
                              className={cn("inline-block size-2 rounded-full", healthDot)}
                              aria-hidden="true"
                            />
                            API Health
                          </dt>
                          <dd className="text-xs font-medium">
                            {healthLabel}
                          </dd>
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground flex items-center gap-1.5">
                          <Puzzle className="size-3.5" />
                          Components
                        </dt>
                        <dd className="text-xs font-mono">{pkg.components.length}</dd>
                      </div>

                      <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground flex items-center gap-1.5">
                          <Wrench className="size-3.5" />
                          Skills
                        </dt>
                        <dd className="text-xs font-mono">{pkg.skills.length}</dd>
                      </div>

                      {pkg.remoteApiEndpoint && (
                        <div className="flex items-center justify-between">
                          <dt className="text-muted-foreground flex items-center gap-1.5">
                            <Globe className="size-3.5" />
                            API Endpoint
                          </dt>
                          <dd className="text-xs font-mono truncate max-w-[160px]">
                            {pkg.remoteApiEndpoint}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        )}
    </>
  );
}

// -- Skeleton ---------------------------------------------------------------

function ServiceDetailSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-6 w-20 rounded-md" />
          <Skeleton className="h-6 w-16 rounded-md" />
        </div>
        <div className="flex items-center gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8">
        <div className="space-y-6">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
        <div className="space-y-5">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

// -- Not Found --------------------------------------------------------------

function ServiceNotFound() {
  return (
    <Empty className="py-20 border border-dashed border-border rounded-xl">
      <EmptyMedia variant="icon">
        <Package />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>Service not found</EmptyTitle>
        <EmptyDescription>
          This service may have been removed or does not exist.
        </EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" size="sm" asChild>
        <Link href="/marketplace">Browse Marketplace</Link>
      </Button>
    </Empty>
  );
}

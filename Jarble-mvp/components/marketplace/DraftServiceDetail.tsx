"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Pencil,
  Send,
  Package,
  Puzzle,
  Wrench,
  FileText,
  Server,
  XCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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

const STATUS_CONFIG: Record<string, { style: string; label: string; icon: typeof AlertCircle; description: string; variant?: "destructive" }> = {
  draft: {
    style: "bg-secondary text-muted-foreground border-border",
    label: "Draft",
    icon: AlertCircle,
    description: "This service has not been submitted for review yet. Test it on a deployment, then submit when ready.",
  },
  rejected: {
    style: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
    label: "Rejected",
    icon: XCircle,
    description: "This service was rejected during review. Please update it and resubmit.",
    variant: "destructive",
  },
  pending_review: {
    style: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
    label: "Pending Review",
    icon: Loader2,
    description: "This service has been submitted and is awaiting admin review.",
  },
};

interface DraftServiceDetailProps {
  serviceId: string;
}

export default function DraftServiceDetail({ serviceId }: DraftServiceDetailProps) {
  const [selectedDeployment, setSelectedDeployment] = useState<string | null>(null);
  const [testState, setTestState] = useState<"idle" | "installing" | "installed" | "error">("idle");
  const [testError, setTestError] = useState<string | null>(null);

  const serviceQuery = trpc.services.get.useQuery({ serviceId }, { enabled: !!serviceId });
  const statusQuery = trpc.services.getServiceStatus.useQuery(
    { serviceId, deploymentId: selectedDeployment! },
    { enabled: !!selectedDeployment && !!serviceId },
  );
  const testInstallMutation = trpc.services.testInstall.useMutation();
  const testUninstallMutation = trpc.services.testUninstall.useMutation();
  const submitForReviewMutation = trpc.services.submitForReview.useMutation();

  const pkg = serviceQuery.data;
  const isInstalled = statusQuery.data?.installed === true;

  async function handleTestInstall(): Promise<void> {
    if (!selectedDeployment) return;
    setTestState("installing");
    setTestError(null);
    try {
      await testInstallMutation.mutateAsync({ serviceId, deploymentId: selectedDeployment });
      setTestState("installed");
    } catch (err) {
      setTestState("error");
      setTestError(err instanceof Error ? err.message : "Test install failed");
    }
  }

  async function handleTestUninstall(): Promise<void> {
    if (!selectedDeployment) return;
    try {
      await testUninstallMutation.mutateAsync({ serviceId, deploymentId: selectedDeployment });
      setTestState("idle");
      statusQuery.refetch();
    } catch {
      // Error shown via mutation state
    }
  }

  async function handleSubmitForReview(): Promise<void> {
    try {
      await submitForReviewMutation.mutateAsync({ serviceId });
      serviceQuery.refetch();
    } catch {
      // Error shown via mutation state
    }
  }

  const statusCfg = pkg ? STATUS_CONFIG[pkg.status] : undefined;
  const hostingStyle = pkg ? (HOSTING_STYLES[pkg.hostingModel] ?? "bg-secondary text-secondary-foreground border-border") : "";
  const hostingLabel = pkg ? (HOSTING_LABELS[pkg.hostingModel] ?? pkg.hostingModel) : "";
  const isSelfHostedOrHybrid = pkg?.hostingModel === "self_hosted" || pkg?.hostingModel === "hybrid";

  const testErrorMessage =
    testError ??
    (testState !== "error" ? testInstallMutation.error?.message : undefined) ??
    testUninstallMutation.error?.message ??
    undefined;

  if (serviceQuery.isLoading) return <DraftDetailSkeleton />;
  if (!pkg) return <ServiceNotFound />;

  return (
    <>
      <Link href="/marketplace" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
        <ArrowLeft className="size-4" />
        Back to Marketplace
      </Link>

      {statusCfg && (
        <Alert variant={statusCfg.variant} className="mb-6">
          <statusCfg.icon className={cn("size-4", pkg.status === "pending_review" && "animate-spin")} />
          <AlertTitle>{statusCfg.label}</AlertTitle>
          <AlertDescription>{statusCfg.description}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-8">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{pkg.displayName}</h2>
            {statusCfg && (
              <Badge variant="outline" className={cn("text-xs gap-1", statusCfg.style)}>
                {statusCfg.label}
              </Badge>
            )}
            <Badge variant="outline" className={cn("text-xs gap-1", hostingStyle)}>
              {hostingLabel}
            </Badge>
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
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

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/marketplace/services/${serviceId}/edit`}>
              <Pencil className="size-4 mr-1.5" />
              Edit
            </Link>
          </Button>
          {(pkg.status === "draft" || pkg.status === "rejected") && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" disabled={submitForReviewMutation.isPending}>
                  <Send className="size-4 mr-1.5" />
                  Submit for Review
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Submit for Review?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will submit &ldquo;{pkg.displayName}&rdquo; for admin review.
                    Once submitted, you will not be able to make changes until the review is complete.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleSubmitForReview}>Submit</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {submitForReviewMutation.isSuccess && (
        <Alert className="mb-6">
          <CheckCircle2 className="size-4" />
          <AlertTitle>Submitted</AlertTitle>
          <AlertDescription>Your service has been submitted for review.</AlertDescription>
        </Alert>
      )}

      {submitForReviewMutation.error && (
        <Alert variant="destructive" className="mb-6">
          <XCircle className="size-4" />
          <AlertTitle>Submission Failed</AlertTitle>
          <AlertDescription>{submitForReviewMutation.error.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8">
        <div className="space-y-8 min-w-0">
          <section>
            <h3 className="text-lg font-semibold mb-3">Description</h3>
            <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {pkg.description ?? "No description available."}
            </p>
          </section>

          <ItemList
            title="Included Components"
            icon={Puzzle}
            items={pkg.components.map((c: any) => ({
              id: c.id, name: c.displayName, description: c.description,
              badges: [c.tier, c.category].filter(Boolean),
            }))}
          />

          <ItemList
            title="Included Skills"
            icon={Wrench}
            items={pkg.skills.map((s: any) => ({
              id: s.id, name: s.name, description: s.description,
            }))}
          />

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

        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Test Install</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              <p className="text-xs text-muted-foreground">
                Install this draft service on a running deployment to test it before submitting.
              </p>

              <DeploymentPicker
                selectedId={selectedDeployment}
                onSelect={(id) => {
                  setSelectedDeployment(id);
                  setTestState("idle");
                  setTestError(null);
                }}
              />

              {isSelfHostedOrHybrid && (pkg as any).creatorDeploymentId && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 p-2.5">
                  <Server className="size-4 text-muted-foreground shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    This service will run on:{" "}
                    <span className="font-medium text-foreground">{(pkg as any).creatorDeploymentId}</span>
                  </p>
                </div>
              )}

              <Separator />

              {testState === "installed" || isInstalled ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle2 className="size-4" />
                    Test Installed
                  </div>
                  <Button variant="outline" className="w-full" onClick={handleTestUninstall} disabled={testUninstallMutation.isPending}>
                    {testUninstallMutation.isPending ? "Uninstalling..." : "Test Uninstall"}
                  </Button>
                </div>
              ) : (
                <Button className="w-full" disabled={!selectedDeployment || testState === "installing"} onClick={handleTestInstall}>
                  {testState === "installing" ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Installing...
                    </>
                  ) : (
                    "Test Install"
                  )}
                </Button>
              )}

              {testErrorMessage && (
                <p className="text-sm text-destructive text-center">{testErrorMessage}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Pricing</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <span className="text-2xl font-bold">
                {pkg.pricingModel === "free" || (pkg.priceUsdCents ?? 0) === 0
                  ? "Free"
                  : `$${((pkg.priceUsdCents ?? 0) / 100).toFixed(2)}`}
              </span>
              {pkg.pricingModel !== "free" && (
                <span className="ml-2 text-xs text-muted-foreground capitalize">({pkg.pricingModel})</span>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

interface ItemListProps {
  title: string;
  icon: typeof Puzzle;
  items: Array<{ id: string; name: string; description?: string | null; badges?: string[] }>;
}

function ItemList({ title, icon: Icon, items }: ItemListProps): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="text-lg font-semibold mb-3">{title} ({items.length})</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <Icon className="size-4 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{item.name}</p>
              {item.description && <p className="text-xs text-muted-foreground truncate">{item.description}</p>}
            </div>
            {item.badges && item.badges.length > 0 && (
              <div className="flex items-center gap-1.5">
                {item.badges.map((badge) => (
                  <Badge key={badge} variant="outline" className="text-[10px]">{badge}</Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function DraftDetailSkeleton(): React.ReactElement {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-full rounded-lg" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-6 w-20 rounded-md" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8">
        <div className="space-y-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
        <div className="space-y-5">
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function ServiceNotFound(): React.ReactElement {
  return (
    <Empty className="py-20 border border-dashed border-border rounded-xl">
      <EmptyMedia variant="icon">
        <Package />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>Service not found</EmptyTitle>
        <EmptyDescription>This service may have been removed or does not exist.</EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" size="sm" asChild>
        <Link href="/marketplace">Browse Marketplace</Link>
      </Button>
    </Empty>
  );
}

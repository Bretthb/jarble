"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth0 } from "@auth0/auth0-react";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  CheckCircle2,
  LogIn,
  Image as ImageIcon,
  Calendar,
  Tag,
  User,
  Package,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import { StarRating } from "@/components/marketplace/StarRating";
import { CategoryBadge } from "@/components/marketplace/CategoryBadge";
import { TierBadge } from "@/components/marketplace/TierBadge";
import type {
  MarketplaceComponent,
  MarketplaceReview,
} from "@/components/marketplace/types";
import DeploymentPicker from "@/components/marketplace/DeploymentPicker";
import { trpc } from "@/lib/trpc";
import ProfileDropdown from "@/components/ProfileDropdown";

export default function MarketplaceDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { isAuthenticated, loginWithRedirect, isLoading: authLoading } = useAuth0();

  const [selectedDeployment, setSelectedDeployment] = useState<string | null>(null);
  const [installState, setInstallState] = useState<"idle" | "installing" | "installed">("idle");

  // tRPC queries -- gracefully handle missing router.
  // Using `as any` because the marketplace router doesn't exist on AppRouter yet.
  const componentQuery = (trpc as any).marketplace?.getById?.useQuery?.(
    { id },
    { enabled: !!id }
  );
  const reviewsQuery = (trpc as any).marketplace?.getReviews?.useQuery?.(
    { componentId: id },
    { enabled: !!id }
  );

  // Mutations -- will be no-ops until the API exists
  const installMutation = (trpc as any).marketplace?.install?.useMutation?.();
  const uninstallMutation = (trpc as any).marketplace?.uninstall?.useMutation?.();

  const component: MarketplaceComponent | undefined = componentQuery?.data;
  const reviews: MarketplaceReview[] | undefined = reviewsQuery?.data;
  const isLoading = componentQuery?.isLoading ?? false;
  const hasData = component !== undefined;

  const handleInstall = async () => {
    if (!selectedDeployment || !installMutation) return;
    setInstallState("installing");
    try {
      await installMutation.mutateAsync({
        componentId: id,
        deploymentId: selectedDeployment,
      });
      setInstallState("installed");
    } catch {
      setInstallState("idle");
    }
  };

  const handleUninstall = async () => {
    if (!selectedDeployment || !uninstallMutation) return;
    try {
      await uninstallMutation.mutateAsync({
        componentId: id,
        deploymentId: selectedDeployment,
      });
      setInstallState("idle");
    } catch {
      // Silently fail -- error shown via tRPC error handling
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="fixed inset-x-0 top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <Link
            href="/"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <h1 className="font-serif font-bold text-2xl tracking-tight">
              Jarble
            </h1>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/marketplace"
              className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
            >
              Marketplace
            </Link>
            {!authLoading && isAuthenticated ? (
              <>
                <Link
                  href="/dashboard"
                  className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors hidden sm:inline"
                >
                  Dashboard
                </Link>
                <ProfileDropdown />
              </>
            ) : (
              !authLoading && (
                <Button
                  size="sm"
                  asChild
                  className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 font-medium"
                >
                  <Link href="/login">Sign in</Link>
                </Button>
              )
            )}
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {/* Back link */}
        <Link
          href="/marketplace"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="size-4" />
          Back to Marketplace
        </Link>

        {isLoading ? (
          <DetailSkeleton />
        ) : !hasData ? (
          <DetailNotFound />
        ) : (
          <>
            {/* Component header */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-8">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                    {component.displayName}
                  </h2>
                  <TierBadge tier={component.tier} />
                </div>
                <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                  <StarRating
                    rating={component.rating}
                    count={component.reviewCount}
                    size="md"
                  />
                  <span className="flex items-center gap-1">
                    <Download className="size-3.5" />
                    {component.installs.toLocaleString()} installs
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
                    {component.description}
                  </p>
                </section>

                {/* Preview placeholder */}
                <section>
                  <h3 className="text-lg font-semibold mb-3">Preview</h3>
                  {component.previewImageUrl ? (
                    <div className="rounded-lg border border-border overflow-hidden bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={component.previewImageUrl}
                        alt={`${component.displayName} preview`}
                        className="w-full h-auto"
                      />
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-muted/30 flex items-center justify-center h-48 text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <ImageIcon className="size-8" />
                        <span className="text-sm">No preview available</span>
                      </div>
                    </div>
                  )}
                </section>

                {/* Props Schema */}
                {component.propsSchema &&
                  Object.keys(component.propsSchema).length > 0 && (
                    <section>
                      <h3 className="text-lg font-semibold mb-3">
                        Props Schema
                      </h3>
                      <pre className="rounded-lg border border-border bg-muted/50 p-4 overflow-x-auto text-sm text-foreground">
                        <code>
                          {JSON.stringify(component.propsSchema, null, 2)}
                        </code>
                      </pre>
                    </section>
                  )}

                {/* Example prompts */}
                {component.examplePrompts &&
                  component.examplePrompts.length > 0 && (
                    <section>
                      <h3 className="text-lg font-semibold mb-3">
                        Example Prompts
                      </h3>
                      <div className="space-y-2">
                        {component.examplePrompts.map((prompt, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3"
                          >
                            <MessageSquare className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                            <p className="text-sm text-foreground">{prompt}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                {/* README */}
                {component.readme && (
                  <section>
                    <h3 className="text-lg font-semibold mb-3">README</h3>
                    <div className="rounded-lg border border-border bg-muted/30 p-4 prose prose-sm dark:prose-invert max-w-none">
                      <pre className="whitespace-pre-wrap text-sm text-foreground font-sans">
                        {component.readme}
                      </pre>
                    </div>
                  </section>
                )}

                {/* Reviews */}
                <section>
                  <h3 className="text-lg font-semibold mb-4">
                    Reviews ({component.reviewCount})
                  </h3>
                  {!reviews || reviews.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No reviews yet. Be the first to leave a review after
                      installing this component.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {reviews.map((review) => (
                        <ReviewCard key={review.id} review={review} />
                      ))}
                    </div>
                  )}
                </section>
              </div>

              {/* Right column - sidebar */}
              <div className="space-y-5">
                {/* Install card */}
                <Card className="border border-border">
                  <CardContent className="pt-5 space-y-4">
                    {/* Price */}
                    <div className="text-center">
                      <span className="text-3xl font-bold">
                        {component.pricingModel === "free" ||
                        component.priceUsdCents === 0
                          ? "Free"
                          : `$${(component.priceUsdCents / 100).toFixed(2)}`}
                      </span>
                      {component.pricingModel === "subscription" && (
                        <span className="text-muted-foreground text-sm">
                          /month
                        </span>
                      )}
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
                        {/* Deployment picker */}
                        <DeploymentPicker
                          selectedId={selectedDeployment}
                          onSelect={setSelectedDeployment}
                        />

                        <Button
                          className="w-full"
                          disabled={
                            !selectedDeployment ||
                            installState === "installing" ||
                            !installMutation
                          }
                          onClick={handleInstall}
                        >
                          {installState === "installing" ? (
                            "Installing..."
                          ) : (
                            <>
                              <Download className="size-4 mr-2" />
                              Install
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Creator card */}
                <Card className="border border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">
                      Creator
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="size-8 rounded-full bg-muted flex items-center justify-center">
                        <User className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {component.creatorName}
                        </p>
                        {component.creatorBio && (
                          <p className="text-xs text-muted-foreground truncate">
                            {component.creatorBio}
                          </p>
                        )}
                      </div>
                    </div>
                    {component.creatorUrl && (
                      <a
                        href={component.creatorUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <ExternalLink className="size-3" />
                        Website
                      </a>
                    )}
                  </CardContent>
                </Card>

                {/* Component info card */}
                <Card className="border border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">
                      Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <dl className="space-y-3 text-sm">
                      <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground flex items-center gap-1.5">
                          <Package className="size-3.5" />
                          Version
                        </dt>
                        <dd className="font-mono text-xs">
                          {component.version}
                        </dd>
                      </div>

                      <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground flex items-center gap-1.5">
                          <Tag className="size-3.5" />
                          Category
                        </dt>
                        <dd>
                          <CategoryBadge category={component.category} />
                        </dd>
                      </div>

                      <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground flex items-center gap-1.5">
                          <Calendar className="size-3.5" />
                          Updated
                        </dt>
                        <dd className="text-xs">
                          {new Date(component.updatedAt).toLocaleDateString()}
                        </dd>
                      </div>

                      {component.tags && component.tags.length > 0 && (
                        <div>
                          <dt className="text-muted-foreground mb-1.5">Tags</dt>
                          <dd className="flex flex-wrap gap-1">
                            {component.tags.map((tag) => (
                              <Badge
                                key={tag}
                                variant="secondary"
                                className="text-[10px]"
                              >
                                {tag}
                              </Badge>
                            ))}
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
      </main>
    </div>
  );
}

// ── Review Card ───────────────────────────────────────────────────────────

function ReviewCard({ review }: { review: MarketplaceReview }) {
  return (
    <Card className="border border-border">
      <CardContent className="pt-4 pb-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-6 rounded-full bg-muted flex items-center justify-center">
              <User className="size-3 text-muted-foreground" />
            </div>
            <span className="text-sm font-medium">{review.userName}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {new Date(review.createdAt).toLocaleDateString()}
          </span>
        </div>
        <StarRating rating={review.rating} size="sm" />
        <h4 className="font-medium text-sm">{review.title}</h4>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {review.body}
        </p>
      </CardContent>
    </Card>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="space-y-8">
      {/* Header skeleton */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-6 w-20 rounded-md" />
        </div>
        <div className="flex items-center gap-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>

      {/* Two-column skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8">
        <div className="space-y-6">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
          <Skeleton className="h-48 w-full rounded-lg" />
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

// ── Not Found ─────────────────────────────────────────────────────────────

function DetailNotFound() {
  return (
    <Empty className="py-20 border border-dashed border-border rounded-xl">
      <EmptyMedia variant="icon">
        <Package />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>Component not found</EmptyTitle>
        <EmptyDescription>
          This component may have been removed or does not exist yet.
          The marketplace is still being built.
        </EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" size="sm" asChild>
        <Link href="/marketplace">Browse Marketplace</Link>
      </Button>
    </Empty>
  );
}

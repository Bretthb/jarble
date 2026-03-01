"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useAuth0 } from "@auth0/auth0-react";
import { Search, SlidersHorizontal, Package, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import { ComponentCard } from "@/components/marketplace/ComponentCard";
import type { MarketplaceComponentData } from "@/components/marketplace/ComponentCard";
import {
  MARKETPLACE_CATEGORIES,
  SORT_OPTIONS,
} from "@/components/marketplace/types";
import ProfileDropdown from "@/components/ProfileDropdown";
import { trpc } from "@/lib/trpc";

const PAGE_SIZE = 20;

export default function MarketplaceBrowsePage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth0();

  // Filter state
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [tier, setTier] = useState("all");
  const [pricing, setPricing] = useState("all");
  const [sort, setSort] = useState("popular");
  const [page, setPage] = useState(0);

  // tRPC query -- will fail gracefully until the API router exists.
  // Using `as any` because the marketplace router doesn't exist on AppRouter yet.
  const browseQuery = (trpc as any).marketplace?.browse?.useQuery?.(
    {
      category: category === "all" ? undefined : category,
      tier: tier === "all" ? undefined : tier,
      pricing: pricing === "all" ? undefined : pricing,
      sort,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    },
    { enabled: false }
  );

  // The data from the query, or undefined if the router doesn't exist yet
  const components: MarketplaceComponentData[] | undefined = browseQuery?.data?.components;
  const totalCount: number = browseQuery?.data?.totalCount ?? 0;
  const isLoading = browseQuery?.isLoading ?? false;
  const hasData = components !== undefined;
  const isEmpty = hasData && components.length === 0;
  const hasActiveFilters = category !== "all" || tier !== "all" || pricing !== "all" || search !== "";

  const clearFilters = useCallback(() => {
    setSearch("");
    setCategory("all");
    setTier("all");
    setPricing("all");
    setPage(0);
  }, []);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

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
              href="/"
              className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors hidden sm:inline"
            >
              Home
            </Link>
            <Link
              href="/pricing"
              className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors hidden sm:inline"
            >
              Pricing
            </Link>
            <Link
              href="/marketplace"
              className="text-sm font-medium text-primary transition-colors"
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
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Component Marketplace
          </h2>
          <p className="mt-2 text-muted-foreground text-lg">
            Discover and install community-built UI components for your bots.
          </p>
        </div>

        {/* Search bar */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search components..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="pl-10 h-11 text-base"
          />
          {search && (
            <button
              onClick={() => {
                setSearch("");
                setPage(0);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-3 mb-8">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <SlidersHorizontal className="size-4" />
            <span className="hidden sm:inline">Filters:</span>
          </div>

          {/* Category */}
          <Select
            value={category}
            onValueChange={(v) => {
              setCategory(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {MARKETPLACE_CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat === "all" ? "All Categories" : cat.charAt(0).toUpperCase() + cat.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Tier */}
          <Select
            value={tier}
            onValueChange={(v) => {
              setTier(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tiers</SelectItem>
              <SelectItem value="template">Template</SelectItem>
              <SelectItem value="sandbox">Sandbox</SelectItem>
            </SelectContent>
          </Select>

          {/* Pricing */}
          <Select
            value={pricing}
            onValueChange={(v) => {
              setPricing(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Price" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Prices</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>

          {/* Sort */}
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Clear filters */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5 mr-1" />
              Clear
            </Button>
          )}
        </div>

        {/* Component grid */}
        {isLoading ? (
          <ComponentGridSkeleton />
        ) : !hasData ? (
          <MarketplaceEmptyState type="not-connected" />
        ) : isEmpty ? (
          <MarketplaceEmptyState
            type="no-results"
            hasFilters={hasActiveFilters}
            onClearFilters={clearFilters}
          />
        ) : (
          <>
            {/* Results count */}
            <p className="text-sm text-muted-foreground mb-4">
              {totalCount} component{totalCount !== 1 ? "s" : ""} found
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {components.map((comp) => (
                <ComponentCard key={comp.id} component={comp} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-10">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground px-3">
                  Page {page + 1} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ── Skeleton loading state ────────────────────────────────────────────────

function ComponentGridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border bg-card p-5 space-y-3"
        >
          <div className="flex items-start justify-between">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-12" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16 rounded-md" />
            <Skeleton className="h-5 w-14 rounded-md" />
          </div>
          <div className="flex items-center justify-between pt-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Empty states ──────────────────────────────────────────────────────────

function MarketplaceEmptyState({
  type,
  hasFilters,
  onClearFilters,
}: {
  type: "not-connected" | "no-results";
  hasFilters?: boolean;
  onClearFilters?: () => void;
}) {
  if (type === "not-connected") {
    return (
      <Empty className="py-20 border border-dashed border-border rounded-xl">
        <EmptyMedia variant="icon">
          <Package />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>Marketplace Coming Soon</EmptyTitle>
          <EmptyDescription>
            The component marketplace is being built. Soon you will be able to
            browse, install, and share community-built components for your bots.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Empty className="py-20 border border-dashed border-border rounded-xl">
      <EmptyMedia variant="icon">
        <Search />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>No components found</EmptyTitle>
        <EmptyDescription>
          {hasFilters
            ? "Try adjusting your filters or search query."
            : "No components are available yet. Check back soon!"}
        </EmptyDescription>
      </EmptyHeader>
      {hasFilters && onClearFilters && (
        <Button variant="outline" size="sm" onClick={onClearFilters}>
          Clear all filters
        </Button>
      )}
    </Empty>
  );
}

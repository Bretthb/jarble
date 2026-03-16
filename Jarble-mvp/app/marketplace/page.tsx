"use client";

import { useState, useCallback, useRef } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { Search, SlidersHorizontal, Package, X, Puzzle, Wrench } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ComponentCard } from "@/components/marketplace/ComponentCard";
import type { MarketplaceComponentData } from "@/components/marketplace/ComponentCard";
import { ServiceList } from "@/components/marketplace/ServiceList";
import { ServicePublishForm } from "@/components/marketplace/ServicePublishForm";
import { MyServicesList } from "@/components/marketplace/MyServicesList";
import {
  MARKETPLACE_CATEGORIES,
  SORT_OPTIONS,
} from "@/components/marketplace/types";
import { trpc } from "@/lib/trpc";

const PAGE_SIZE = 20;

export default function MarketplaceBrowsePage() {
  const { isAuthenticated } = useAuth0();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [tier, setTier] = useState("all");
  const [pricing, setPricing] = useState("all");
  const [sort, setSort] = useState("popular");

  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const cursorHistory = useRef<(string | undefined)[]>([]);
  const [pageIndex, setPageIndex] = useState(0);

  const browseQuery = trpc.marketplace.browse.useQuery({
    category: category === "all" ? undefined : category,
    tier: tier === "all" ? undefined : (tier as "template" | "sandbox"),
    pricing: pricing === "all" ? undefined : (pricing as "free" | "paid"),
    sort: sort as "popular" | "newest" | "top_rated" | "trending",
    search: search || undefined,
    limit: PAGE_SIZE,
    cursor,
  });

  const components: MarketplaceComponentData[] | undefined = browseQuery.data?.items;
  const nextCursor = browseQuery.data?.nextCursor;
  const isLoading = browseQuery.isLoading;
  const hasData = components !== undefined;
  const isEmpty = hasData && components.length === 0;
  const hasActiveFilters = category !== "all" || tier !== "all" || pricing !== "all" || search !== "";

  const resetPagination = useCallback(() => {
    setCursor(undefined);
    cursorHistory.current = [];
    setPageIndex(0);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch("");
    setCategory("all");
    setTier("all");
    setPricing("all");
    resetPagination();
  }, [resetPagination]);

  return (
    <>
      <div className="mb-8">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Marketplace
          </h2>
          <p className="mt-2 text-muted-foreground text-lg">
            Discover and install community-built components and services for your bots.
          </p>
        </div>

        {/* Tabs: Components | Services | My Services | Create */}
        <Tabs defaultValue="components" className="mb-8">
          <TabsList>
            <TabsTrigger value="components" className="gap-1.5">
              <Puzzle className="size-4" />
              Components
            </TabsTrigger>
            <TabsTrigger value="services" className="gap-1.5">
              <Package className="size-4" />
              Services
            </TabsTrigger>
            {isAuthenticated && (
              <TabsTrigger value="my-services" className="gap-1.5">
                <Wrench className="size-4" />
                My Services
              </TabsTrigger>
            )}
            {isAuthenticated && (
              <TabsTrigger value="create" className="gap-1.5">
                Create
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="services">
            <ServiceList />
          </TabsContent>

          {isAuthenticated && (
            <TabsContent value="my-services">
              <MyServicesList />
            </TabsContent>
          )}

          {isAuthenticated && (
            <TabsContent value="create">
              <ServicePublishForm />
            </TabsContent>
          )}

          <TabsContent value="components">

        {/* Search bar */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search components..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPagination();
            }}
            className="pl-10 h-11 text-base"
          />
          {search && (
            <button
              onClick={() => {
                setSearch("");
                resetPagination();
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
              resetPagination();
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
              resetPagination();
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
              resetPagination();
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {components.map((comp) => (
                <ComponentCard key={comp.id} component={comp} />
              ))}
            </div>

            {/* Cursor-based pagination */}
            {(pageIndex > 0 || nextCursor) && (
              <div className="flex items-center justify-center gap-2 mt-10">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pageIndex === 0}
                  onClick={() => {
                    const prevCursor = cursorHistory.current.pop();
                    setCursor(prevCursor);
                    setPageIndex((p) => p - 1);
                  }}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground px-3">
                  Page {pageIndex + 1}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!nextCursor}
                  onClick={() => {
                    cursorHistory.current.push(cursor);
                    setCursor(nextCursor);
                    setPageIndex((p) => p + 1);
                  }}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}

          </TabsContent>
        </Tabs>
    </>
  );
}

// ── Skeleton loading state ────────────────────────────────────────────────

function ComponentGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

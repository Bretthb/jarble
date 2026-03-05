"use client";

import { useState, useCallback, useRef } from "react";
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
import { PackageCard } from "./PackageCard";
import type { PackageCardData } from "./PackageCard";
import { trpc } from "@/lib/trpc";

const PAGE_SIZE = 20;

export function PackageList() {
  const [search, setSearch] = useState("");
  const [hostingModel, setHostingModel] = useState("all");
  const [pricing, setPricing] = useState("all");

  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const cursorHistory = useRef<(string | undefined)[]>([]);
  const [pageIndex, setPageIndex] = useState(0);

  const packagesQuery = trpc.packages.list.useQuery({
    search: search || undefined,
    hostingModel: hostingModel === "all" ? undefined : (hostingModel as "self_hosted" | "remote" | "hybrid"),
    pricingModel: pricing === "all" ? undefined : (pricing as "free" | "paid" | "freemium"),
    cursor,
    limit: PAGE_SIZE,
  });

  const packages: PackageCardData[] | undefined = packagesQuery.data?.items;
  const nextCursor = packagesQuery.data?.nextCursor;
  const isLoading = packagesQuery.isLoading;
  const hasData = packages !== undefined;
  const isEmpty = hasData && packages.length === 0;
  const hasActiveFilters = hostingModel !== "all" || pricing !== "all" || search !== "";

  const resetPagination = useCallback(() => {
    setCursor(undefined);
    cursorHistory.current = [];
    setPageIndex(0);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch("");
    setHostingModel("all");
    setPricing("all");
    resetPagination();
  }, [resetPagination]);

  return (
    <div>
      {/* Search bar */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search packages..."
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

        {/* Hosting Model */}
        <Select
          value={hostingModel}
          onValueChange={(v) => {
            setHostingModel(v);
            resetPagination();
          }}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Hosting" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Hosting</SelectItem>
            <SelectItem value="self_hosted">Self-hosted</SelectItem>
            <SelectItem value="remote">Hosted</SelectItem>
            <SelectItem value="hybrid">Hybrid</SelectItem>
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
            <SelectItem value="freemium">Freemium</SelectItem>
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

      {/* Package grid */}
      {isLoading ? (
        <PackageGridSkeleton />
      ) : !hasData ? (
        <PackageEmptyState type="error" />
      ) : isEmpty ? (
        <PackageEmptyState
          type="no-results"
          hasFilters={hasActiveFilters}
          onClearFilters={clearFilters}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {packages.map((pkg) => (
              <PackageCard key={pkg.id} pkg={pkg} />
            ))}
          </div>

          {/* Pagination */}
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
    </div>
  );
}

// -- Skeleton ---------------------------------------------------------------

function PackageGridSkeleton() {
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

// -- Empty states -----------------------------------------------------------

function PackageEmptyState({
  type,
  hasFilters,
  onClearFilters,
}: {
  type: "error" | "no-results";
  hasFilters?: boolean;
  onClearFilters?: () => void;
}) {
  if (type === "error") {
    return (
      <Empty className="py-20 border border-dashed border-border rounded-xl">
        <EmptyMedia variant="icon">
          <Package />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>Unable to load packages</EmptyTitle>
          <EmptyDescription>
            Something went wrong loading the package list. Please try again later.
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
        <EmptyTitle>No packages found</EmptyTitle>
        <EmptyDescription>
          {hasFilters
            ? "Try adjusting your filters or search query."
            : "No packages are available yet. Check back soon!"}
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

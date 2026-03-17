"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { DeploymentCard } from "@/components/explore/DeploymentCard";
import type { DeploymentCardData } from "@/components/explore/DeploymentCard";
import { LeaderboardTable } from "@/components/explore/LeaderboardTable";
import type { LeaderboardEntry } from "@/components/explore/LeaderboardTable";
import { DomainSelector } from "@/components/explore/DomainSelector";
import { ServiceMetricsBadge } from "@/components/explore/ServiceMetricsBadge";
import { Search, Trophy, TrendingUp, Server } from "lucide-react";

// ---------- helpers ----------

function toDeploymentCards(data: unknown): DeploymentCardData[] {
  if (!Array.isArray(data)) return [];
  return data.map((d: Record<string, unknown>) => ({
    id: String(d.id ?? ""),
    name: String(d.name ?? "Untitled"),
    description: d.description != null ? String(d.description) : null,
    specialties: Array.isArray(d.specialties) ? d.specialties.map(String) : [],
    forkCount: typeof d.forkCount === "number" ? d.forkCount : 0,
    overallScore: typeof d.overallScore === "number" ? d.overallScore : 0,
    ratingCount: typeof d.ratingCount === "number" ? d.ratingCount : 0,
  }));
}

function toLeaderboardEntries(data: unknown): LeaderboardEntry[] {
  if (!Array.isArray(data)) return [];
  return data.map((d: Record<string, unknown>) => ({
    id: String(d.id ?? ""),
    name: String(d.name ?? "Untitled"),
    description: d.description != null ? String(d.description) : null,
    score: typeof d.score === "number" ? d.score : 0,
    ratingCount: typeof d.ratingCount === "number" ? d.ratingCount : 0,
  }));
}

// ---------- skeleton grids ----------

function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className="border border-border bg-card">
          <CardContent className="pt-5 pb-4 space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16 rounded-md" />
              <Skeleton className="h-5 w-16 rounded-md" />
            </div>
            <div className="flex items-center justify-between pt-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-16 rounded-md" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function LeaderboardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="grid grid-cols-[2.5rem_1fr_6rem_4rem] gap-2 items-center px-3 py-2"
        >
          <Skeleton className="h-4 w-6" />
          <div className="space-y-1">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-4 w-12 ml-auto" />
          <Skeleton className="h-3 w-8 ml-auto" />
        </div>
      ))}
    </div>
  );
}

// ---------- page ----------

export default function ExplorePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("general");
  const [serviceMetricTab, setServiceMetricTab] = useState("reliability");

  // --- tRPC queries (gracefully handle missing endpoints) ---

  const featuredQuery = trpc.benchmarks.leaderboard.useQuery(
    { domainSlug: "general", metric: "overall", limit: 6 },
    { retry: false, refetchOnWindowFocus: false }
  );

  const domainLeaderboardQuery = trpc.benchmarks.leaderboard.useQuery(
    { domainSlug: selectedDomain, metric: "overall", limit: 10 },
    { retry: false, refetchOnWindowFocus: false }
  );

  const serviceReliabilityQuery = trpc.benchmarks.serviceLeaderboard.useQuery(
    { metric: "reliability", limit: 10 },
    { retry: false, refetchOnWindowFocus: false }
  );

  const serviceSpeedQuery = trpc.benchmarks.serviceLeaderboard.useQuery(
    { metric: "speed", limit: 10 },
    { retry: false, refetchOnWindowFocus: false }
  );

  const servicePopularQuery = trpc.benchmarks.serviceLeaderboard.useQuery(
    { metric: "popularity", limit: 10 },
    { retry: false, refetchOnWindowFocus: false }
  );

  const trendingQuery = trpc.benchmarks.leaderboard.useQuery(
    { domainSlug: "general", metric: "overall", limit: 6 },
    { retry: false, refetchOnWindowFocus: false }
  );

  // --- derived data ---

  const featured = toDeploymentCards(featuredQuery.data);
  const domainEntries = toLeaderboardEntries(domainLeaderboardQuery.data);
  const trending = toDeploymentCards(trendingQuery.data);

  const serviceLeaderboards: Record<string, LeaderboardEntry[]> = {
    reliability: toLeaderboardEntries(serviceReliabilityQuery.data),
    speed: toLeaderboardEntries(serviceSpeedQuery.data),
    popular: toLeaderboardEntries(servicePopularQuery.data),
  };

  // --- simple client-side search filter ---

  const filteredFeatured = searchQuery
    ? featured.filter(
        (d) =>
          d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          d.description?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : featured;

  const filteredTrending = searchQuery
    ? trending.filter(
        (d) =>
          d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          d.description?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : trending;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-10">
        {/* ====== Header ====== */}
        <div className="space-y-4">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Explore
          </h1>
          <p className="text-muted-foreground text-sm max-w-lg">
            Discover top-performing bots, browse domain leaderboards, and fork
            deployments to get started quickly.
          </p>

          {/* Search */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search deployments..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* ====== Featured Deployments ====== */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Trophy className="size-5 text-amber-400" />
            <h2 className="text-xl font-semibold text-foreground">
              Featured Deployments
            </h2>
          </div>

          {featuredQuery.isLoading ? (
            <CardGridSkeleton count={6} />
          ) : filteredFeatured.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredFeatured.map((deployment) => (
                <DeploymentCard
                  key={deployment.id}
                  deployment={deployment}
                />
              ))}
            </div>
          ) : (
            <Card className="border border-dashed border-border">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {searchQuery
                  ? "No featured deployments match your search."
                  : "No featured deployments available yet."}
              </CardContent>
            </Card>
          )}
        </section>

        {/* ====== Domain Leaderboard ====== */}
        <section className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Trophy className="size-5 text-primary" />
              <h2 className="text-xl font-semibold text-foreground">
                Domain Leaderboard
              </h2>
            </div>
            <DomainSelector
              value={selectedDomain}
              onChange={setSelectedDomain}
            />
          </div>

          <Card className="border border-border">
            <CardContent className="pt-4 pb-4">
              {domainLeaderboardQuery.isLoading ? (
                <LeaderboardSkeleton rows={5} />
              ) : (
                <LeaderboardTable
                  entries={domainEntries}
                  metric="score"
                />
              )}
            </CardContent>
          </Card>
        </section>

        {/* ====== Service Leaderboard ====== */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Server className="size-5 text-primary" />
            <h2 className="text-xl font-semibold text-foreground">
              Service Leaderboard
            </h2>
          </div>

          <Card className="border border-border">
            <CardContent className="pt-4 pb-4">
              <Tabs
                value={serviceMetricTab}
                onValueChange={setServiceMetricTab}
              >
                <TabsList>
                  <TabsTrigger value="reliability">Reliability</TabsTrigger>
                  <TabsTrigger value="speed">Speed</TabsTrigger>
                  <TabsTrigger value="popular">Popular</TabsTrigger>
                </TabsList>

                <TabsContent value="reliability">
                  {serviceReliabilityQuery.isLoading ? (
                    <LeaderboardSkeleton />
                  ) : (
                    <LeaderboardTable
                      entries={serviceLeaderboards.reliability}
                      metric="reliability"
                    />
                  )}
                </TabsContent>

                <TabsContent value="speed">
                  {serviceSpeedQuery.isLoading ? (
                    <LeaderboardSkeleton />
                  ) : (
                    <LeaderboardTable
                      entries={serviceLeaderboards.speed}
                      metric="latency"
                    />
                  )}
                </TabsContent>

                <TabsContent value="popular">
                  {servicePopularQuery.isLoading ? (
                    <LeaderboardSkeleton />
                  ) : (
                    <LeaderboardTable
                      entries={serviceLeaderboards.popular}
                      metric="installs"
                    />
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </section>

        {/* ====== Trending (Most Forked) ====== */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-5 text-emerald-500" />
            <h2 className="text-xl font-semibold text-foreground">
              Trending
            </h2>
          </div>

          {trendingQuery.isLoading ? (
            <CardGridSkeleton count={6} />
          ) : filteredTrending.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTrending.map((deployment) => (
                <DeploymentCard
                  key={deployment.id}
                  deployment={deployment}
                />
              ))}
            </div>
          ) : (
            <Card className="border border-dashed border-border">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {searchQuery
                  ? "No trending deployments match your search."
                  : "No trending deployments available yet."}
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

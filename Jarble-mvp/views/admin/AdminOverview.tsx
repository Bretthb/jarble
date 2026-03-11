"use client";

import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Server, Activity, DollarSign } from "lucide-react";
import { Loader2 } from "lucide-react";

function formatDollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

const STAT_CARDS = [
  { key: "totalUsers", label: "Total Users", icon: Users },
  { key: "totalDeployments", label: "Total Deployments", icon: Server },
  { key: "activeDeployments", label: "Active Pods", icon: Activity },
  { key: "totalRevenueCents", label: "Revenue", icon: DollarSign },
] as const;

export default function AdminOverview() {
  const stats = trpc.admin.getStats.useQuery();

  if (stats.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Overview</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {STAT_CARDS.map((card) => {
          const value = stats.data?.[card.key] ?? 0;
          const display =
            card.key === "totalRevenueCents"
              ? formatDollars(value)
              : value.toLocaleString();
          return (
            <Card key={card.key}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.label}
                </CardTitle>
                <card.icon className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{display}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

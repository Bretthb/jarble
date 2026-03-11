"use client";

import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Loader2 } from "lucide-react";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default",
  stopped: "secondary",
  failed: "destructive",
  creating: "outline",
  pending: "outline",
};

export default function AdminSystem() {
  const health = trpc.admin.getSystemHealth.useQuery();

  if (health.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">System Health</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {health.data?.statusCounts.map(
          (entry: { status: string; count: number }) => (
            <Card key={entry.status}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  <Badge
                    variant={STATUS_VARIANT[entry.status] ?? "outline"}
                    className="capitalize"
                  >
                    {entry.status}
                  </Badge>
                </CardTitle>
                <Activity className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{entry.count}</p>
                <p className="text-xs text-muted-foreground">pods</p>
              </CardContent>
            </Card>
          ),
        )}
        {health.data?.statusCounts.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No deployments found.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

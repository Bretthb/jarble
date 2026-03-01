"use client";

import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DeploymentPickerProps {
  selectedId: string | null;
  onSelect: (deploymentId: string) => void;
}

/**
 * DeploymentPicker -- dropdown for selecting which deployment to install a
 * marketplace component on. Only shows running/active deployments.
 *
 * Used on marketplace detail pages to pick a target deployment before install.
 */
export default function DeploymentPicker({ selectedId, onSelect }: DeploymentPickerProps) {
  // Fetch user's deployments. The procedure may be `deployment.list` or
  // `deployment.getAll` -- handle gracefully if not available yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const deploymentsQuery = trpcAny.deployment?.list?.useQuery?.(undefined, {
    staleTime: 30_000,
  }) ?? trpcAny.deployment?.getAll?.useQuery?.(undefined, {
    staleTime: 30_000,
  }) ?? { data: undefined, isLoading: false, isError: false };

  const deployments = deploymentsQuery.data as
    | Array<{
        id: string;
        name: string;
        status: string;
        runtime?: string;
      }>
    | undefined;

  // Only show running/active deployments
  const activeDeployments = (deployments ?? []).filter(
    (d) => d.status === "running"
  );

  if (deploymentsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading deployments...
      </div>
    );
  }

  if (deploymentsQuery.isError || !deployments) {
    return (
      <p className="text-sm text-muted-foreground">
        Unable to load deployments. Please try again later.
      </p>
    );
  }

  if (activeDeployments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No running deployments available. Start a deployment first.
      </p>
    );
  }

  return (
    <Select
      value={selectedId ?? undefined}
      onValueChange={onSelect}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select a deployment" />
      </SelectTrigger>
      <SelectContent>
        {activeDeployments.map((dep) => (
          <SelectItem key={dep.id} value={dep.id}>
            <div className="flex items-center gap-2">
              <span className="truncate">{dep.name}</span>
              <StatusBadge status={dep.status} compact />
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

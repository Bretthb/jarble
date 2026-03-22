"use client";

import { Loader2, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

interface DeploymentComponentBrowserProps {
  deploymentId: string;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export default function DeploymentComponentBrowser({
  deploymentId,
  selectedIds,
  onSelectionChange,
}: DeploymentComponentBrowserProps) {
  const query = trpc.services.listDeploymentComponents.useQuery(
    { deploymentId },
    { staleTime: 30_000 },
  );

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="size-4 animate-spin" />
        Loading components...
      </div>
    );
  }

  if (query.isError) {
    return (
      <p className="text-sm text-destructive py-2">
        Failed to load components. {query.error.message}
      </p>
    );
  }

  const components = query.data ?? [];

  if (components.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <Package className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No marketplace components installed on this deployment.
          Install some from the Components tab first.
        </p>
      </div>
    );
  }

  const allSelected = components.every((c) => selectedIds.includes(c.id));

  const toggleAll = () => {
    if (allSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(components.map((c) => c.id));
    }
  };

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((s) => s !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {selectedIds.length} of {components.length} selected
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={toggleAll} className="h-7 text-xs">
          {allSelected ? "Deselect all" : "Select all"}
        </Button>
      </div>
      <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-2">
        {components.map((comp) => (
          <label
            key={comp.id}
            className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
          >
            <Checkbox
              checked={selectedIds.includes(comp.id)}
              onCheckedChange={() => toggle(comp.id)}
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{comp.displayName}</span>
                <Badge variant="outline" className="text-xs shrink-0">{comp.category}</Badge>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-1">{comp.description}</p>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

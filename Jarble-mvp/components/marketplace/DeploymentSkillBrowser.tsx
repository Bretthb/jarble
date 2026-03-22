"use client";

import { Loader2, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

interface DeploymentSkillBrowserProps {
  deploymentId: string;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export default function DeploymentSkillBrowser({
  deploymentId,
  selectedIds,
  onSelectionChange,
}: DeploymentSkillBrowserProps) {
  const query = trpc.services.listDeploymentSkills.useQuery(
    { deploymentId },
    { staleTime: 30_000 },
  );

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="size-4 animate-spin" />
        Loading skills...
      </div>
    );
  }

  if (query.isError) {
    return (
      <p className="text-sm text-destructive py-2">
        Failed to load skills. {query.error.message}
      </p>
    );
  }

  const skills = query.data ?? [];

  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <Zap className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No skills installed on this deployment.
        </p>
      </div>
    );
  }

  const allSelected = skills.every((s) => selectedIds.includes(s.id));

  const toggleAll = () => {
    if (allSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(skills.map((s) => s.id));
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
          {selectedIds.length} of {skills.length} selected
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={toggleAll} className="h-7 text-xs">
          {allSelected ? "Deselect all" : "Select all"}
        </Button>
      </div>
      <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-2">
        {skills.map((skill) => (
          <label
            key={skill.id}
            className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
          >
            <Checkbox
              checked={selectedIds.includes(skill.id)}
              onCheckedChange={() => toggle(skill.id)}
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{skill.name}</span>
                {skill.isOfficial && (
                  <Badge variant="secondary" className="text-xs shrink-0">Official</Badge>
                )}
              </div>
              {skill.description && (
                <p className="text-xs text-muted-foreground line-clamp-1">{skill.description}</p>
              )}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

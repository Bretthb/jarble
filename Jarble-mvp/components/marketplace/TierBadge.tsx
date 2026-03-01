"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FileCode, Box } from "lucide-react";

const TIER_STYLES: Record<string, string> = {
  template: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",
  sandbox: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/20",
};

interface TierBadgeProps {
  tier: string;
  className?: string;
}

export function TierBadge({ tier, className }: TierBadgeProps) {
  const style = TIER_STYLES[tier] ?? "bg-secondary text-secondary-foreground border-border";
  const Icon = tier === "sandbox" ? Box : FileCode;

  return (
    <Badge
      variant="outline"
      className={cn("text-[11px] capitalize gap-1", style, className)}
    >
      <Icon className="size-3" />
      {tier}
    </Badge>
  );
}

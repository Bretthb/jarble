"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const CATEGORY_COLORS: Record<string, string> = {
  dashboard: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",
  chart: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  form: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20",
  media: "bg-pink-500/15 text-pink-700 dark:text-pink-400 border-pink-500/20",
  utility: "bg-gray-500/15 text-gray-700 dark:text-gray-400 border-gray-500/20",
  game: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
  visualization: "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/20",
  layout: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/20",
  social: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
};

interface CategoryBadgeProps {
  category: string;
  className?: string;
}

export function CategoryBadge({ category, className }: CategoryBadgeProps) {
  const colorClass = CATEGORY_COLORS[category] ?? "bg-secondary text-secondary-foreground border-border";

  return (
    <Badge
      variant="outline"
      className={cn("text-[11px] capitalize", colorClass, className)}
    >
      {category}
    </Badge>
  );
}
